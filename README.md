# finance-core-node

> ⚠️ **Projeto de estudos.** Este repositório existe para fins **educacionais e de
> experimentação**. Não é um produto, não tem garantia de estabilidade,
> segurança ou conformidade fiscal/contábil, e **não deve ser usado em produção**
> nem para gerir dinheiro real.

API de core financeiro construída com Node.js e TypeScript, usada como laboratório
para praticar **DDD (Domain-Driven Design)**, arquitetura em camadas e
desenvolvimento orientado a specs — sem frameworks pesados escondendo as decisões.

## Para que serve

O objetivo é exercitar, num domínio realista (financeiro), práticas que costumam
ficar abstratas em tutoriais:

- Modelar **bounded contexts** independentes (`identity`, `financeiro`) com
  entidades, aggregate roots e value objects próprios.
- Tratar erros de domínio com **`Result<T>`** em vez de exceptions.
- Garantir **multi-tenancy** como invariante de repositório (todo acesso é
  filtrado por empresa, nunca por confiança no controller).
- Montar tudo à mão num **composition root**, sem container de DI.
- Escrever **validação de entrada manual**, sem biblioteca de schema.
- Planejar mudanças antes do código, com um fluxo **spec-driven** (`openspec/`).

Por ser um projeto de estudo, várias escolhas são deliberadamente "cruas":
sem ORM, sem Zod, sem plugins de auth/CORS prontos. A ideia é entender o que
essas ferramentas fazem, não usá-las.

## Stack

| Ferramenta | Uso |
|---|---|
| **Node.js (ESM)** | Runtime |
| **TypeScript 7.x** | Linguagem, em `strict` mode |
| **Fastify 5** | Servidor HTTP e roteamento (sem plugins externos) |
| **Knex + PostgreSQL** | Query builder, migrations e seeds (sem ORM) |
| **bcrypt / jsonwebtoken** | Hash de senha e tokens JWT |
| **tsx** | Dev server com hot-reload |

Não há test runner configurado — `npm test` é um stub.

## Arquitetura

Cada bounded context segue a mesma divisão, com a dependência sempre apontando
para dentro: `api` → `domain` ← `infrastructure`.

```
src/
├── index.ts            # Entry point — carrega .env e sobe o AppServer
├── app.server.ts       # Composition root + instância Fastify (hooks, error handler)
├── knexfile.ts         # Config do Knex
├── migrations/         # Migrations (identity → finance → transaction → audit)
├── seeds/              # Dados e categorias padrão
├── routes/             # Plugins Fastify por contexto
├── shared/             # Entity, AggregateRoot, ValueObject, Result, DomainError...
├── identity/           # Usuários, empresas, perfis e autenticação
│   ├── domain/         # Entidades, VOs (Email, Cpf, Cnpj, Password), services
│   ├── infrastructure/ # Interfaces de repositório + implementações Knex
│   └── api/            # Controllers, DTOs/validação, middlewares
└── financeiro/         # Categorias e lançamentos (em construção)
dist/                   # Output compilado (gerado pelo tsc)
openspec/               # Specs e mudanças planejadas antes do código
```

## Como rodar

Requisitos: Node.js (versão com suporte a ESM/NodeNext) e um PostgreSQL acessível.

```bash
# 1. Instalar dependências
npm install

# 2. Criar o .env na raiz do projeto (veja a tabela abaixo)

# 3. Preparar o banco
npm run db:migrate
npm run db:seed

# 4. Desenvolvimento (porta 3000, hot-reload)
npm run dev
```

O servidor sobe em `http://localhost:3000` e as rotas ficam sob `/api/v1`.

### Variáveis de ambiente

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão Postgres — obrigatória para o servidor e para `db:*` |
| `PORT` | Porta HTTP (default `3000`) |
| `NODE_ENV` | Ambiente |
| `JWT_SECRET` | Assinatura dos tokens (access 15m, refresh 7d) |

Nunca versione o `.env` nem use os segredos de exemplo fora da sua máquina.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor em desenvolvimento com hot-reload |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda o servidor compilado |
| `npm run db:migrate` | Aplica migrations pendentes |
| `npm run db:migrate:rollback` | Reverte o último batch |
| `npm run db:seed` | Roda os seeds |

## Contribuindo

As convenções obrigatórias (imports com `.js`, `Result<T>`, multi-tenancy,
versões fixas de dependências, fluxo spec-driven) estão em
[AGENTS.md](./AGENTS.md) e [RULES.md](./RULES.md). Leia antes de abrir um PR ou
apontar um agente de IA para o repositório.

## Licença

AGPL-3.0 — veja [LICENSE](./LICENSE).
