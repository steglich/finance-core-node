# AGENTS.md — Guia para Agentes

Este documento define as regras, convenções e padrões que todo agente de IA deve seguir ao implementar neste projeto.

---

## Visão Geral

- **Projeto:** `finance-core-node` — API de core financeiro
- **Runtime:** Node.js (ESM)
- **Linguagem:** TypeScript 7.x (strict mode)
- **Licença:** AGPL-3.0

---

## Stack e Ferramentas

| Ferramenta | Uso |
|---|---|
| `tsx` | Dev server com hot-reload (`npm run dev`) |
| `tsc` | Compilação TypeScript (`npm run build`) |
| `node` | Execução em produção (`npm start`) |

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
├── index.ts          # Entry point — apenas inicializa o AppServer
├── app.server.ts     # Classe AppServer — toda a implementação do servidor
└── ...
dist/                 # Output compilado (gerado pelo tsc — NUNCA edite manualmente)
```

### Padrão: Separação de Entry Point e Implementação

- **`index.ts`**: responsabilidade única — instanciar e iniciar o servidor. O mais enxuto possível.
- **`app.server.ts`**: classe `AppServer` com toda a lógica de configuração, rotas e middlewares. Novos recursos devem ser adicionados aqui ou em arquivos importados por ele.

### Para Novos Recursos
- Crie módulos em `src/` com nomes descritivos
- Use classes ou funções puras — seja consistente com o que já existe no módulo
- Sempre exporte tipos/interfaces relevantes

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
npm run dev     # Desenvolvimento com hot-reload (porta 3000)
npm run build   # Compilar TypeScript para dist/
npm start       # Rodar em produção (compilado)
```

A porta padrão do servidor é `3000`.
