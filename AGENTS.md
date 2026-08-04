# AGENTS.md — Guia para Agentes

Este documento define as regras, convenções e padrões que todo agente de IA deve seguir ao implementar neste projeto.

---

## Visão Geral

- **Projeto:** `finance-core-node` — API de core financeiro
- **Runtime:** Node.js (ESM)
- **Linguagem:** TypeScript 7.x (strict mode)
- **Licença:** AGPL-3.0
- **Arquitetura:** DDD por bounded context, sem framework HTTP e sem container de DI
- **Persistência:** PostgreSQL via Knex (query builder + migrations + seeds)

---

## Stack e Ferramentas

| Ferramenta | Uso |
|---|---|
| `tsx` | Dev server com hot-reload (`npm run dev`) |
| `tsc` | Compilação TypeScript (`npm run build`) |
| `node` | Execução em produção (`npm start`) |
| `knex` | Migrations e seeds (`npm run db:*`) — client `pg` |
| `bcrypt` | Hash de senha (`PasswordService`) |
| `jsonwebtoken` | Access/refresh tokens (`JwtTokenService`) |
| `dotenv` | Carrega `.env` no `src/index.ts` |

Não há framework HTTP (Express/Fastify), ORM, biblioteca de validação (Zod) nem
test runner. O servidor usa `node:http` puro, as queries usam Knex direto e a
validação de entrada é feita à mão em `dtos.ts`. Mantenha esse padrão.

**Nenhuma dependência externa** deve ser adicionada sem antes perguntar.
- **Sempre instale dependências com versão exata** (fixa, sem `^` ou `~`). Isso trava a versão usada e previne Supply Chain Attacks — uma dependência comprometida não será atualizada silenciosamente.
  ```bash
  # ✅ Correto — versão exata
  npm install --save-exact dotenv

  # ❌ Errado — salva com ^ por padrão (range)
  npm install dotenv
  ```
- No `package.json`, toda dependência deve usar versão fixa: `"pkg": "1.2.3"`, nunca `"pkg": "^1.2.3"` ou `"pkg": "~1.2.3"`.
- Para atualizar uma dependência fixa para uma versão específica, use `npm install --save-exact pkg@1.2.4`.

---

## Convenções do TypeScript

O `tsconfig.json` é **restritivo por design**. Siga estas regras:

### Módulos (ESM + NodeNext)
- Sempre use `import`/`export` (nunca `require`)
- **Importe com extensão `.js`** nos imports relativos (exigido pelo `module: "nodenext"`):
  ```ts
  // ✅ Correto
  import { AppServer } from "./app.server.js";

  // ❌ Errado
  import { AppServer } from "./app.server";
  import { AppServer } from "./app.server.ts";
  ```

### Strictness
- `strict: true` — tudo deve ser tipado, sem `any` implícito
- `noUncheckedIndexedAccess: true` — acessos a índices retornam `T | undefined`
- `exactOptionalPropertyTypes: true` — `undefined` só é permitido em propriedades explicitamente opcionais
- `verbatimModuleSyntax: true` — use `import type` para imports de tipos; `export type` para re-exports de tipos
- `isolatedModules: true` — cada arquivo deve ser compilável isoladamente

### Tipos
- Use `import type { Foo } from "./foo.js"` para imports apenas de tipos
- Prefira `interface` para objetos e `type` para unions/primitives
- Evite `any`; use `unknown` quando o tipo for realmente desconhecido

---

## Estrutura do Projeto

```
src/
├── index.ts            # Entry point — carrega .env e sobe o AppServer
├── app.server.ts       # AppServer — composition root + servidor node:http
├── knexfile.ts         # Config do Knex (migrations/, seeds/, DATABASE_URL)
├── migrations/         # Migrations Knex (identity → finance → transaction → audit)
├── seeds/              # Dados padrão e categorias padrão
├── routes/             # Roteador próprio + definição de rotas por contexto
├── shared/             # Primitivas de domínio e infraestrutura transversal
│   ├── domain/         # Entity, AggregateRoot, ValueObject, Result, DomainError, DomainEventBus
│   └── infrastructure/ # DatabaseConnection (Knex), Logger
├── identity/           # Bounded context: usuários, empresas, perfis, auth
│   ├── domain/         # Entidades, VOs (Email, Cpf, Cnpj, Password) e services
│   ├── infrastructure/ # Interfaces de repositório + implementações Knex, JwtTokenService
│   └── api/            # Controllers, DTOs/validação, middlewares
└── financeiro/         # Bounded context: categorias (em construção)
    ├── domain/
    └── infrastructure/
dist/                   # Output compilado (gerado pelo tsc — NUNCA edite manualmente)
openspec/               # Specs e mudanças (fluxo spec-driven; fase atual em changes/)
```

### Camadas de um Bounded Context

Cada contexto (`identity/`, `financeiro/`) segue a mesma divisão. A dependência
aponta sempre para dentro: `api` → `domain` ← `infrastructure`.

- **`domain/`** — entidades, aggregate roots, value objects e domain services.
  Sem Knex, sem `node:http`, sem env. É onde as regras de negócio vivem.
- **`infrastructure/`** — a *interface* do repositório (`user-repository.ts`) e a
  implementação Knex (`knex-user-repository.ts`) ficam lado a lado. O domínio e
  os controllers dependem da interface, nunca da implementação.
- **`api/`** — controllers que recebem `IncomingMessage` e retornam
  `{ statusCode, body }`; DTOs com funções `validateXRequest`; middlewares.
  Controllers não escrevem na resposta — quem faz isso é a rota.

### Padrões Obrigatórios

- **`Result<T>` em vez de exceptions no domínio.** Use `Result.success(v)` /
  `Result.failed(DomainError.create("VALIDATION_ERROR", "..."))`. Só use
  `throw` em boundaries de infraestrutura. Os códigos válidos estão em
  `DomainErrorCode` — adicione um novo lá antes de usar.
- **Multi-tenancy é invariante de repositório.** `BaseRepository` expõe
  `readonly companyId` e toda implementação **deve** filtrar por ele. Nunca
  confie no controller para aplicar o escopo de empresa.
- **Aggregate roots acumulam eventos** via `raiseEvent()`; quem persiste publica
  e chama `clearEvents()`.
- **Value objects são imutáveis** e implementam `compareValues()` + `toJSON()`.
- **Validação de entrada é manual**, em `api/dtos.ts`, retornando
  `ApiResult<T>` (`{ success: true, data }` | `{ success: false, error }`).

### Composition Root

Não existe container de DI. Tudo é instanciado à mão em
`AppServer.initialize()`, na ordem: `DatabaseConnection` → repositórios (recebem
o `Knex`) → services → controllers. Ao criar um recurso novo, registre-o ali e
injete via construtor.

### Rotas

O roteador é próprio (`src/routes/index.ts`): `createRoutes()` monta o array e
`handleRoute()` percorre em ordem, casando `method` + `matchPath()` (suporta
`:param`, mas **não** extrai os valores — o controller lê o `req.url`).

- **A ordem importa:** rotas mais específicas primeiro.
- Rotas novas vão em `src/routes/<contexto>-routes.ts`, com uma factory
  `createXRoutes(controller)`, e são registradas em `createRoutes()`.
- Prefixo padrão: `/api/v1/...`.
- Rotas protegidas usam `AuthMiddleware`, que valida o Bearer token e injeta
  `RequestContext { userId, companyId }`.

### Para Novos Recursos
- Novo conceito de negócio → comece pelo `domain/` do contexto correspondente
- Precisa de tabela → crie uma migration em `src/migrations/` (nunca edite uma já aplicada)
- Use classes ou funções puras — seja consistente com o que já existe no módulo
- Sempre exporte tipos/interfaces relevantes (`shared/domain/index.ts` é o barrel das primitivas)

---

## Segurança e Performance

- Nunca hardcode segredos, chaves ou credenciais — use variáveis de ambiente (`.env` lido por `process.env`)
- Valide inputs externos (headers, query params, body, etc.)
- Evite bloqueios na event loop (uso síncrono de `fs`, `crypto`, etc.)
- Use streams para operações com arquivos grandes
- Sempre feche conexões e libere recursos

---

## Boas Práticas de Código

- Funções pequenas e com responsabilidade única
- Nomes em inglês, descritivos e consistentes com o domínio financeiro
- Sempre trate erros — nunca ignore promises rejeitadas ou callbacks de erro
- Use `try/catch` em boundaries (handlers HTTP, entrada de jobs, etc.)
- Prefira composição a herança
- Documente decisões não-óbvias com comentários, não o que o código já diz

---

## Antes de Implementar

1. **Se tiver dúvida, pergunte.** Nunca assuma requisitos ou comportamentos.
2. **Use o MCP Context7** para consultar documentação de bibliotecas — incluso as conhecidas. Sempre comece com `resolve-library-id`.
3. **Leia os arquivos relevantes** antes de editar. Nunca edite um arquivo sem lê-lo primeiro.
4. **Mantenha a consistência** com o código existente (padrões, nomes, estrutura).

---

## Fluxo de Trabalho

```bash
npm run dev                  # Desenvolvimento com hot-reload (porta 3000)
npm run build                # Compilar TypeScript para dist/
npm start                    # Rodar em produção (compilado)

npm run db:migrate           # Aplicar migrations pendentes
npm run db:migrate:rollback  # Reverter o último batch
npm run db:seed              # Rodar os seeds de src/seeds/
```

A porta padrão do servidor é `3000`.

### Variáveis de Ambiente

Lidas de `.env` (carregado por `dotenv` no `src/index.ts`):

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão Postgres — obrigatória para o servidor e para os comandos `db:*` |
| `PORT` | Porta HTTP (default `3000`) |
| `NODE_ENV` | Ambiente |
| `JWT_SECRET` | Assinatura dos tokens (access 15m, refresh 7d) |

### Testes

**Ainda não há test runner configurado** — `npm test` é um stub que falha. Não
invente comandos de teste; se um teste for necessário, pergunte antes qual
runner adotar.

---

## Fluxo Spec-Driven (OpenSpec)

Mudanças são planejadas em `openspec/` antes de virar código. Cada mudança tem
`proposal.md`, `design.md`, `tasks.md` e specs por capability em
`specs/<capability>/spec.md`. Ao implementar, siga as tasks da mudança ativa e
mantenha as specs coerentes com o que foi construído.
