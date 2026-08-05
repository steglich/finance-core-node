## 1. Dependências

- [ ] 1.1 Atualizar `bcrypt` para 6.0.0 com `npm install --save-exact bcrypt@6.0.0` e `@types/bcrypt` para a versão correspondente
- [ ] 1.2 Validar instalação limpa do binário nativo do bcrypt (`rm -rf node_modules && npm ci`) — a v6 troca `node-pre-gyp` por `node-gyp-build`
- [ ] 1.3 Confirmar que hashes bcrypt existentes continuam verificando após o bump (teste com hash gerado na 5.1.1)
- [ ] 1.4 Atualizar `fastify` para 5.11.2 com `npm install --save-exact fastify@5.11.2`
- [ ] 1.5 Rodar `npm audit --omit=dev` e confirmar zero advisories high/critical; resolver o que sobrar sem introduzir ranges
- [ ] 1.6 Rodar `npm test` e `npm run typecheck` — baseline verde antes de qualquer mudança de código

## 2. Correções sem efeito de protocolo

- [ ] 2.1 Neutralizar fórmula em `escapeCsvField` (`src/financeiro/api/csv.ts`): campo iniciado por `=`, `+`, `-`, `@`, tab ou CR recebe prefixo de apóstrofo e é emitido entre aspas
- [ ] 2.2 Testar a neutralização: payload de fórmula sai como texto, valor permanece recuperável, arquivo continua CSV válido, e campos normais não são alterados
- [ ] 2.3 Testar que a neutralização se aplica ao exportar relatório com nome de categoria/pessoa/conta contendo fórmula, ponta a ponta
- [ ] 2.4 Criar migration que traduz as linhas de `permissions` para o vocabulário do domínio (`create`/`update` → `WRITE`, `read` → `READ`, `delete` → `DELETE`) e adiciona o recurso `audit` com ação `MANAGE`, com `down` restaurando o vocabulário anterior
- [ ] 2.5 Reescrever `src/seeds/01_default_data.ts` usando `PermissionResource`/`PermissionAction` tipados, de modo que um valor fora do vocabulário quebre a compilação
- [ ] 2.6 Testar que um perfil semeado por padrão passa em `requirePermission("audit", "MANAGE")` — hoje falha
- [ ] 2.7 Validar força do `JWT_SECRET` em `createJwtTokenService`: mínimo de 32 bytes, erro explícito de configuração na inicialização
- [ ] 2.8 Configurar TLS explícito na conexão Postgres (`src/shared/infrastructure/database-connection.ts`), com verificação de certificado governada por variável de ambiente
- [ ] 2.9 Documentar as novas variáveis de ambiente no `.env.example` e na tabela de variáveis do `AGENTS.md`

## 3. Defesas de borda

- [ ] 3.1 Instalar `@fastify/rate-limit@11.2.0`, `@fastify/helmet@13.1.0` e `@fastify/cors@11.3.0` com `--save-exact`
- [ ] 3.2 Ler `trustProxy` de variável de ambiente (default `false`) e passá-lo na construção da instância Fastify em `AppServer`
- [ ] 3.3 Testar resolução de IP: com `trustProxy` ligado o IP encaminhado prevalece; com ele desligado o header forjado é ignorado
- [ ] 3.4 Registrar `@fastify/helmet` na raiz com HSTS, `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`
- [ ] 3.5 Testar que os headers de segurança aparecem numa resposta de API e também na resposta de download de relatório CSV
- [ ] 3.6 Substituir o hook manual de CORS em `registerHooks` por `@fastify/cors` com allowlist vinda de variável de ambiente; lista vazia significa nenhuma origem permitida
- [ ] 3.7 Testar CORS: origem na allowlist recebe permissão, origem ausente não recebe, e nenhuma origem é permitida por valor hardcoded
- [ ] 3.8 Registrar `@fastify/rate-limit` na raiz com o limite global, lido de variável de ambiente
- [ ] 3.9 Registrar o limite estrito dentro do plugin de rotas `/auth`, usando a encapsulação do Fastify
- [ ] 3.10 Testar rate limiting: excesso em `/auth` retorna 429 com indicação de retry e sem executar verificação de senha; excesso global retorna 429; tráfego dentro do limite passa; limite de um cliente não afeta outro

## 4. Autenticação

- [ ] 4.1 Adicionar `NOT_IMPLEMENTED` a `DomainErrorCode` e mapeá-lo para 501 em `toHttpStatusCode`
- [ ] 4.2 Fazer `resetPassword` responder 501 em vez de 200, sem alterar senha alguma
- [ ] 4.3 Emitir tokens com `typ` (`access`/`refresh`), `iss` e `aud` em `JwtTokenService`, lendo emissor e audiência de variável de ambiente
- [ ] 4.4 Verificar `issuer`, `audience` e `typ` em `verifyAccessToken` e `verifyRefreshToken`, rejeitando o token de tipo errado
- [ ] 4.5 Testar a separação: refresh token rejeitado como bearer em rota protegida; access token rejeitado na renovação; token com issuer ou audience divergente rejeitado; token correto no papel correto aceito
- [ ] 4.6 Unificar o caminho de falha em `UserService.authenticate`: saída de erro única com `UNAUTHORIZED` e mensagem "Email ou senha incorretos", sem o e-mail submetido no corpo
- [ ] 4.7 Comparar contra um hash bcrypt de descarte, gerado uma vez na inicialização com o mesmo custo, quando o e-mail não existir
- [ ] 4.8 Fazer o caso de usuário inativo convergir para a mesma resposta das demais falhas
- [ ] 4.9 Testar que e-mail inexistente e senha errada produzem status e mensagem idênticos, que o e-mail não aparece na resposta, e que o caminho de e-mail inexistente executa a verificação de senha
- [ ] 4.10 Revalidar em `refresh` que o usuário continua ativo e continua vinculado à empresa do token antes de emitir credenciais; emitir refresh novo a cada renovação
- [ ] 4.11 Testar a revalidação: usuário desativado e usuário removido da empresa têm a renovação recusada; usuário íntegro recebe par novo de tokens
- [ ] 4.12 Confirmar que o log de acesso continua registrando `LOGIN_FAILED` e `LOGIN_SUCCESS` com o IP resolvido corretamente após a unificação do caminho de erro

## 5. Fechamento

- [ ] 5.1 Rodar `npm test` e `npm run typecheck` com tudo integrado
- [ ] 5.2 Rodar `npm audit --omit=dev` e confirmar que segue limpo após as três dependências novas
- [ ] 5.3 Subir o servidor e verificar manualmente: login uniforme, 429 sob repetição, headers de segurança presentes, CORS restrito, export CSV neutralizado
- [ ] 5.4 Confirmar que o servidor recusa iniciar com `JWT_SECRET` fraco ou ausente
- [ ] 5.5 Revisar `openspec/changes/security-hardening-sweep/design.md` — Migration Plan e registrar os valores de rate limit escolhidos por ambiente
