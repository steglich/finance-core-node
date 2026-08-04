# finance-core-node

API de core financeiro construída com Node.js e TypeScript.

## Stack

- **Node.js** — runtime (ESM)
- **TypeScript 7.x** — linguagem (strict mode)
- **tsx** — dev server com hot-reload

## Estrutura

```
src/
├── index.ts          # Entry point — inicializa o servidor
├── app.server.ts     # Implementação do servidor HTTP
└── ...
dist/                 # Output compilado (gerado pelo tsc)
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Sobe o servidor em desenvolvimento com hot-reload |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda o servidor em produção (compilado) |

## Como rodar

```bash
# Instalar dependências
npm install

# Desenvolvimento (porta 3000, hot-reload)
npm run dev

# Produção
npm run build
npm start
```

O servidor roda em `http://localhost:3000`.

## Licença

AGPL-3.0 — veja [LICENSE](./LICENSE).
