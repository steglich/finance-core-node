## Why

Uma varredura de segurança sobre o código das fases 1 a 4 encontrou dez achados,
dois deles críticos: o access token e o refresh token são criptograficamente
indistinguíveis (um refresh de 7 dias passa em `verifyAccessToken`, anulando a
premissa de token de acesso curto), e o login expõe dois oráculos independentes
de enumeração de contas — código HTTP distinto (404 vs 400) e diferença de
timing de ~250ms, porque o caminho de e-mail inexistente nem chega a executar
bcrypt. O spec de `identity` já exige resposta genérica ("Email ou senha
incorretos"); a implementação divergiu dele.

Além disso a API não tem nenhuma defesa de borda — sem rate limiting, sem
headers de segurança, com CORS `*` marcado como "for development" mas sem
ramificação por ambiente — e `npm audit` acusa 5 vulnerabilidades (4 high, 1
critical). O sistema guarda dados financeiros multi-tenant; essa superfície
precisa fechar antes de qualquer exposição pública.

## What Changes

**Autenticação (crítico)**

- Access e refresh tokens passam a ser distinguíveis: claims `typ`, `iss` e
  `aud`, verificados na validação. Um refresh token deixa de ser aceito como
  access token e vice-versa. **BREAKING**: todo token emitido antes da mudança
  passa a ser rejeitado — clientes precisam reautenticar.
- O login responde 401 com mensagem única para e-mail inexistente e para senha
  errada, e executa uma comparação bcrypt de descarte quando o usuário não
  existe, equalizando o tempo de resposta. O e-mail digitado sai da mensagem de
  erro.
- `refresh` valida que o usuário continua ativo e continua vinculado à empresa
  do token antes de emitir novas credenciais.
- `JWT_SECRET` passa a ser validado na inicialização (mínimo de 32 bytes); o
  processo falha ao subir com segredo fraco em vez de aceitá-lo em silêncio.
- `resetPassword` deixa de responder `200 "Password has been reset
  successfully"` sem fazer nada. Passa a devolver `501 NOT_IMPLEMENTED` até o
  fluxo real de token de recuperação existir. **BREAKING** para qualquer cliente
  que confie no 200 atual.

**Defesa de borda (nova capability)**

- Rate limiting por IP, com limite agressivo em `/auth/*` e um limite global
  mais frouxo. Fecha brute force e o DoS assimétrico que bcrypt cost 12
  viabiliza (250ms de CPU do servidor por requisição de um atacante).
- `trustProxy` configurável, para que `request.ip` — usado pelo rate limit e
  pelo log de acesso — seja o IP real do cliente atrás de load balancer, e não
  o do proxy.
- Headers de segurança (HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`) em toda resposta.
- CORS com allowlist de origens por variável de ambiente, substituindo o `*`
  hardcoded. **BREAKING** para frontends cuja origem não estiver na allowlist.
- Conexão Postgres com TLS explícito e verificação de certificado configurável,
  em vez de depender do que estiver na `DATABASE_URL`.

**Exportação e permissões**

- A serialização CSV neutraliza injeção de fórmula: campos iniciados por
  `=`, `+`, `-`, `@`, tab ou CR são prefixados. Hoje um nome de categoria,
  pessoa, conta ou centro de custo — input livre do usuário — carrega fórmula
  intacta para dentro do arquivo que outro usuário da mesma empresa abre no
  Excel.
- As permissões semeadas passam a usar o vocabulário do domínio
  (`READ`/`WRITE`/`DELETE`/`MANAGE`), não `create`/`read` minúsculos que não
  existem em `PermissionAction`. Hoje o descasamento deixa os endpoints de
  auditoria inacessíveis para todo perfil padrão, e é uma armadilha para o dia
  em que `requirePermission` for aplicado às demais rotas.

**Dependências**

- `bcrypt` sobe para a linha 6.x, que abandonou `@mapbox/node-pre-gyp` e com ele
  a cadeia crítica do `tar`. `fastify` sobe para a versão que corrige
  `find-my-way` (DoS HTTP/2) e `fast-uri` (host confusion). `npm audit` fica
  limpo.
- Entram três dependências novas, todas do escopo oficial `@fastify/*`:
  `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/cors` — instaladas com
  versão exata, conforme a política do projeto.

**Fora de escopo**

- Aplicar `requirePermission` às 25 rotas que hoje só exigem autenticação. O
  modelo de perfis existe mas está inerte; ativá-lo é decisão de produto sobre
  quem pode o quê, não hardening. Esta change apenas conserta o vocabulário para
  que a ativação futura não caia numa armadilha.
- Implementar o fluxo real de recuperação de senha (envio de e-mail, token de
  reset persistido). Aqui o endpoint apenas para de mentir.
- Revogação de refresh token por denylist persistida. A change adota rotação e
  validação de vínculo; uma denylist exige armazenamento e política de expiração
  que merecem change própria.

## Capabilities

### New Capabilities
- `api-hardening`: defesas de borda da API HTTP — rate limiting, headers de
  segurança, política de CORS, resolução confiável do IP do cliente e transporte
  seguro até o banco. Cobre o que protege toda rota independentemente do
  contexto de negócio que ela serve.

### Modified Capabilities
- `identity`: separação criptográfica entre access e refresh token; resposta de
  falha de autenticação uniforme em código, corpo e tempo; revalidação do
  usuário no refresh; exigência de força mínima do segredo de assinatura;
  endpoint de reset de senha declarado não implementado; vocabulário de
  permissões alinhado ao domínio.
- `relatorios`: a exportação CSV passa a neutralizar fórmula além de escapar
  separadores — o requisito atual cobre só a validade sintática do arquivo, não
  o que ele faz ao ser aberto.

## Impact

**Código**

- `src/identity/infrastructure/jwt-token-service.ts` — claims, verificação,
  validação do segredo
- `src/identity/domain/user-service.ts` — caminho de autenticação uniforme
- `src/identity/api/auth-controller.ts` — refresh revalidado, reset-password
- `src/app.server.ts` — registro dos plugins de borda, remoção dos hooks
  manuais de CORS, `trustProxy` na construção do Fastify
- `src/shared/infrastructure/database-connection.ts` — TLS
- `src/financeiro/api/csv.ts` — neutralização de fórmula
- `src/seeds/01_default_data.ts` — vocabulário de permissões

**API**

- Tokens anteriores à mudança param de funcionar; clientes reautenticam
- Falha de login passa de 404/400 para 401 uniforme
- `POST /auth/reset-password` passa de 200 para 501
- Origens fora da allowlist passam a ser bloqueadas pelo CORS
- Respostas 429 passam a ser possíveis em qualquer rota

**Dependências**

- Novas: `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/cors`
- Atualizadas: `bcrypt`, `fastify` (e transitivas de `npm audit fix`)

**Configuração**

- Novas variáveis de ambiente: allowlist de CORS, `trustProxy`, modo TLS do
  banco, emissor/audiência do JWT
- Deploy passa a falhar rápido se `JWT_SECRET` for fraco — verificar antes de
  subir
