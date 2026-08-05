## Context

Ver `proposal.md` — Why para a motivação. O que importa aqui é o estado atual que
condiciona o desenho:

- O HTTP é Fastify 5 **sem plugins externos** por decisão de projeto: CORS, auth e
  tratamento de erro são hooks próprios em `app.server.ts`. Esta change abre uma
  exceção deliberada a essa regra para três plugins do escopo oficial `@fastify/*`.
- Não há container de DI. Tudo é instanciado à mão em `AppServer.build()`, e é lá
  que os plugins de borda precisam entrar — antes de `registerRoutes()`.
- A encapsulação de plugin do Fastify é a ferramenta que permite limite de taxa
  diferente em `/auth` sem inventar lógica de rota: um hook registrado dentro de um
  plugin só vale naquele escopo. O mesmo mecanismo que `authenticate` já usa.
- `DomainErrorCode` é fechado e mapeado para HTTP em `toHttpStatusCode`. Não existe
  código para 501, e a regra do projeto é adicionar o código ao union antes de usá-lo.
- Há test runner (`node --test` via `--import tsx`) e suítes de API por contexto. Os
  comportamentos desta change são testáveis sem infraestrutura nova.
- O banco pode já ter linhas de permissão semeadas com o vocabulário errado. Corrigir
  só o arquivo de seed não conserta uma instalação existente.

## Goals / Non-Goals

**Goals:**

- Que a distinção access/refresh seja garantida pela verificação da assinatura, não
  por convenção de uso — um token no papel errado deve ser rejeitado pela biblioteca,
  não por um `if` no controller.
- Que o caminho de falha de login seja **um só** no código, não dois convergindo na
  mesma mensagem: caminhos distintos voltam a divergir na primeira manutenção.
- Que toda configuração de segurança tenha origem em variável de ambiente com default
  seguro, de modo que "esqueci de configurar" falhe fechado.
- Que a correção de permissões alcance bancos já existentes, não só instalações novas.

**Non-Goals:**

- Reescrever a validação manual de entrada para schema AJV. A validação em `dtos.ts` é
  o padrão declarado do projeto e está bem feita; trocá-la é refactor, não hardening.
- Unificar `UNAUTHORIZED_ACCESS` e `UNAUTHORIZED`, que hoje são redundantes (ambos 401).
  Limpeza legítima, fora do escopo desta change.
- Qualquer armazenamento de estado de sessão. A rotação de refresh adotada aqui é
  stateless por escolha (ver Decisão 2).

## Decisions

### 1. Distinção de token por claims verificadas, não por segredos separados

Access e refresh passam a carregar `typ` (`"access"` / `"refresh"`), `iss` e `aud`.
A verificação usa as opções nativas de `jsonwebtoken` (`issuer`, `audience`) e checa
`typ` explicitamente após decodificar.

**Alternativa considerada:** dois segredos distintos, um por tipo de token. Garante a
separação sem depender de claim nenhuma e é conceitualmente mais forte. Rejeitada por
custo operacional: dobra o material secreto a gerenciar, rotacionar e distribuir, para
um ganho marginal sobre `typ` + `aud` verificados — se o atacante tem o segredo, os
dois desenhos caem junto. Fica registrada como caminho de evolução se o refresh vier a
ser emitido por outro serviço.

`iss` e `aud` entram junto porque são o que impede um token de outro ambiente (staging,
por exemplo, se o segredo vazar entre ambientes) valer aqui — problema que a separação
por tipo sozinha não cobre.

### 2. Rotação de refresh sem denylist, com revalidação no uso

Cada renovação emite um refresh novo e revalida que o usuário está ativo e ainda
vinculado à empresa do token. Não há denylist persistida: um refresh roubado continua
válido até expirar ou até o vínculo cair.

**Alternativa considerada:** denylist ou tabela de refresh tokens emitidos, que permite
revogação imediata e detecção de reuso. Rejeitada **para esta change** porque exige
tabela, política de expiração de registros e decisão sobre o que fazer ao detectar reuso
— desenho suficiente para change própria. A revalidação adotada cobre o caso que mais
importa aqui, que é usuário removido da empresa continuar operando por até 7 dias.

Isto é uma redução consciente de escopo, não um esquecimento: está declarado em
"Fora de escopo" na proposta.

### 3. Falha de login com caminho único e trabalho constante

`UserService.authenticate` passa a ter uma saída de erro só. Quando o e-mail não existe,
compara a senha submetida contra um hash bcrypt fixo, gerado uma vez na inicialização
com o mesmo custo do hash real, e descarta o resultado. O erro resultante usa
`UNAUTHORIZED` (401) e mensagem única, sem o e-mail.

**Alternativa considerada:** atraso artificial (`setTimeout` até um piso de latência).
Rejeitada por dois motivos: mantém a assimetria de CPU que o atacante explora (a
requisição barata continua barata para o servidor), e o piso vaza quando o hash real
demora mais que ele. O compare de descarte gasta exatamente o mesmo que o caminho real,
que é a propriedade desejada.

Consequência aceita: o login para e-mail inexistente fica ~250ms mais lento. Sob rate
limit isso é irrelevante; sem ele seria vetor de DoS — outra razão para os dois itens
virem na mesma change.

O cenário "usuário inativo" também converge para essa mesma resposta, o que **altera** o
spec existente, que hoje prevê mensagem própria ("Usuário desativado. Contate o
administrador"). A mensagem distinta é ela mesma um oráculo de enumeração. A troca está
registrada no delta de `identity`.

### 4. Limite de taxa em dois níveis pela encapsulação do Fastify

`@fastify/rate-limit` registrado uma vez na raiz com o limite global, e novamente dentro
do plugin de `/auth` com o limite estrito. É o mesmo mecanismo de escopo que
`authenticate` usa hoje, então não introduz conceito novo.

Armazenamento em memória do processo. **Alternativa considerada:** store Redis, que
compartilha o contador entre instâncias. Rejeitada por adicionar infraestrutura que o
projeto não tem hoje; com N instâncias o limite efetivo vira N×limite, o que é aceitável
enquanto o deploy for pequeno. Anotado como o primeiro item a revisar ao escalar
horizontalmente.

### 5. `trustProxy` explícito e obrigatório para o resto funcionar

Sem `trustProxy`, atrás de load balancer `request.ip` é o IP do balanceador: o rate limit
vira um balde único para todos os clientes e o log de acesso registra sempre o mesmo IP.
Isso torna o item 4 inútil e o trail de auditoria enganoso. Vem de variável de ambiente e
é `false` por default — ligar quando não há proxy permitiria ao cliente escolher o
próprio IP via header forjado, que é pior que o problema original.

### 6. CORS: allowlist por ambiente, sem fallback permissivo

`@fastify/cors` com origens de variável de ambiente. Lista vazia significa **nenhuma**
origem cross-origin permitida, não todas. O default atual (`*` hardcoded, comentado como
"for development") é exatamente o modo de falha que se quer eliminar: permissivo por
omissão. Chamadas server-to-server não são afetadas — CORS é restrição de navegador.

### 7. Neutralização de fórmula no CSV por prefixo

Campo cujo primeiro caractere seja `=`, `+`, `-`, `@`, tab ou CR passa a ser prefixado
com apóstrofo e emitido entre aspas.

**Trade-off assumido:** o valor deixa de ser byte-idêntico ao original. Planilhas exibem
e reimportam sem o apóstrofo; um parser CSV genérico o vê. O spec exige que o valor
permaneça **recuperável**, não idêntico — foi redigido assim de propósito.

**Alternativa considerada:** prefixar com tab em vez de apóstrofo. Menos visível em
alguns leitores, mas altera o valor do mesmo jeito e é pior em CSV puro. Apóstrofo é a
convenção reconhecida.

A neutralização entra em `escapeCsvField`, ponto único por onde todo campo já passa —
nenhum chamador precisa lembrar de aplicá-la.

### 8. Permissões: migration corrige dados, seed corrige o futuro

Editar `seeds/01_default_data.ts` só ajuda instalação nova. Uma migration nova traduz as
linhas existentes (`create`/`read`/... minúsculos) para o vocabulário do domínio
(`READ`/`WRITE`/`DELETE`/`MANAGE`) e adiciona o recurso `audit` que nunca foi semeado —
é por isso que hoje nenhum perfil padrão alcança os endpoints de auditoria.

Mapeamento: `create`/`update` → `WRITE`, `read` → `READ`, `delete` → `DELETE`. Migrations
já aplicadas não são editadas, conforme a regra do projeto.

### 9. 501 exige código de domínio novo

`resetPassword` precisa responder 501, e `DomainErrorCode` não tem entrada correspondente.
Entra `NOT_IMPLEMENTED` no union e no `switch` de `toHttpStatusCode`. É o procedimento
que o AGENTS.md determina; registrado aqui porque toca um tipo compartilhado por todos os
contextos.

### 10. Atualização de dependências

| Pacote | De | Para | Motivo |
|---|---|---|---|
| `bcrypt` | 5.1.1 | 6.0.0 | Abandona `@mapbox/node-pre-gyp`, e com ele a cadeia crítica do `tar` (12 advisories) |
| `fastify` | 5.10.0 | 5.11.2 | Corrige `find-my-way` (DoS HTTP/2) e `fast-uri` (host confusion) |
| `@fastify/rate-limit` | — | 11.2.0 | Decisão 4 |
| `@fastify/helmet` | — | 13.1.0 | Headers de segurança |
| `@fastify/cors` | — | 11.3.0 | Decisão 6 |

Todas com `--save-exact`, conforme a política de versão fixa do projeto. `bcrypt` 6 é
major: troca `node-pre-gyp` por `node-gyp-build`, o que muda como o binário nativo é
resolvido no build — precisa de verificação real de instalação limpa, não só de
typecheck. A API de `hash`/`compare` não muda, e hashes existentes seguem válidos (o
formato bcrypt não mudou).

## Risks / Trade-offs

**Deploy desloga toda a base ao mesmo tempo** → Tokens antigos não têm `typ`/`iss`/`aud`
e passam a ser rejeitados. Não há como evitar sem aceitar temporariamente tokens sem
claim — o que preservaria exatamente a brecha que a change fecha. Mitigação: avisar
clientes antes, e verificar que o front trata 401 reautenticando em vez de travar.

**Rate limit derruba tráfego legítimo** → Cliente que faz muitas chamadas por tela pode
bater no limite global. Mitigação: limites por variável de ambiente, ligar com valores
folgados e apertar depois observando os 429 no log de acesso.

**Allowlist de CORS incompleta quebra o front em produção** → Falha silenciosa do ponto
de vista do servidor (aparece como erro no navegador). Mitigação: registrar as origens de
cada ambiente antes do deploy e validar no primeiro ambiente não-produtivo.

**`trustProxy` ligado sem proxy de verdade** → Cliente forja `X-Forwarded-For` e escolhe
o IP contado pelo rate limit, contornando o limite e poluindo o trail. Mitigação: default
`false`; ligar apenas onde há proxy que sobrescreve o header.

**`bcrypt` 6 falha ao compilar no ambiente de deploy** → Mudança de toolchain nativo.
Mitigação: validar `npm ci` limpo no ambiente-alvo antes de promover. Rollback: voltar a
5.1.1 isoladamente — é a única alteração da change que não depende das outras.

**Migration de permissões sobre dados divergentes** → Instalações podem ter linhas fora
do mapeamento previsto. Mitigação: a migration traduz o que reconhece e a `down` restaura
o vocabulário anterior; conferir a tabela antes de aplicar em produção.

**Falso senso de conclusão** → A change fecha borda e autenticação, mas as 25 rotas que
só exigem `authenticate` continuam sem autorização granular. Quem autentica numa empresa
continua podendo tudo dentro dela. Está declarado como fora de escopo e permanece aberto
depois desta change.

## Migration Plan

1. Dependências primeiro, isoladas: bump de `bcrypt` e `fastify`, `npm audit` limpo,
   suíte passando. É o passo com maior chance de problema de ambiente e o único com
   rollback independente.
2. Correções sem efeito de protocolo: CSV, migration de permissões, validação do segredo
   de assinatura. Não quebram cliente nenhum.
3. Plugins de borda com valores permissivos: helmet e rate limit com limites altos, CORS
   com a allowlist real já preenchida. Observar os 429 antes de apertar.
4. Mudanças de protocolo por último, juntas, com aviso prévio: claims de token, falha de
   login uniforme, 501 no reset. É o deploy que invalida sessões.

**Rollback:** os passos 1 a 3 revertem isoladamente. O passo 4 é atômico — reverter
restabelece as sessões antigas apenas se o segredo não tiver mudado junto, então não
rotacionar `JWT_SECRET` no mesmo deploy.

## Open Questions

- Valores iniciais de limite de taxa (requisições por janela, global e em `/auth`).
  Podem ser ajustados por variável de ambiente sem tocar em spec, design ou tasks —
  a decisão é operacional e se resolve observando tráfego real.
- Se `NODE_ENV=development` deve relaxar a allowlist de CORS para `localhost`
  automaticamente ou exigir configuração explícita como qualquer outro ambiente.
  Afeta só conveniência local.
