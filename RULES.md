# RULES.md — Regras do OpenCode

Este documento define as regras de comportamento, permissões e restrições que o OpenCode deve seguir ao operar neste projeto.

---

## 1. Permissões e Restrições

### 1.1 Operações Permitidas

- Ler qualquer arquivo do projeto (exceto secrets e `.env*`)
- Editar e criar arquivos dentro de `src/`
- Executar comandos Node.js (`npm`, `tsx`, `tsc`, `node`) e utilitários padrão (`git`, `ls`, `mkdir`)
- Usar ferramentas MCP configuradas (Context7)
- Fazer buscas com grep e glob
- Fazer perguntas ao usuário quando houver ambiguidade

### 1.2 Operações Proibidas

- **Nunca** editar arquivos em `dist/`, `node_modules/`, `.git/` ou qualquer diretório listado no `.gitignore`
- **Nunca** ler ou expor arquivos `.env`, `.env.*` (exceto `.env.example`)
- **Nunca** instalar dependências (`npm install ...`) sem aprovação explícita
- **Nunca** executar comandos destrutivos (`rm -rf`, `git push --force`, `git reset --hard`)
- **Nunca** modificar configurações globais do sistema ou do git (`git config`, `/etc/*`)
- **Nunca** fazer deploy, publicar pacotes ou interagir com serviços externos não autorizados

---

## 2. Restrições de Arquivos e Diretórios

### 2.1 Somente Leitura

| Diretório/Arquivo | Motivo |
|---|---|
| `dist/` | Output compilado — sobrescrito pelo `tsc` |
| `node_modules/` | Gerenciado pelo npm |
| `.git/` | Repositório — apenas via comandos `git` |
| `package-lock.json` | Gerenciado pelo npm |

### 2.2 Edição Permitida

| Diretório/Arquivo | Condição |
|---|---|
| `src/**/*.ts` | Código fonte — seguir convenções do `AGENTS.md` |
| `tsconfig.json` | Apenas com aprovação explícita |
| `package.json` | Apenas para atualizar scripts; nunca adicionar/remover dependências sem aprovação |
| `opencode.json` | Configuração do OpenCode — apenas quando solicitado |
| `.gitignore` | Apenas quando necessário e justificado |
| `*.md` na raiz | Documentação do projeto — apenas quando solicitado |

**Regra adicional para `package.json`:** ao adicionar ou atualizar dependências, **sempre use versão exata** (fixa, sem `^` ou `~`). Nunca adicione dependências com version range. Isso previne Supply Chain Attacks ao garantir que uma versão comprometida não seja puxada automaticamente em futuras instalações.

### 2.3 Arquivos Bloqueados

- `AGENTS.md` — editável apenas quando solicitado explicitamente
- `RULES.md` (este arquivo) — editável apenas quando solicitado explicitamente

---

## 3. Regras de Git

### 3.1 Commits

- **Não faça commits sem autorização explícita.** Sempre pergunte antes de commitar.
- Mensagens de commit em **português**, seguindo o padrão [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — nova funcionalidade
  - `fix:` — correção de bug
  - `refactor:` — refatoração sem mudança de comportamento
  - `chore:` — tarefas de manutenção (deps, config, build)
  - `docs:` — documentação
  - `test:` — testes
- Commits devem ser atômicos e focados em uma única mudança
- Sempre verifique `git status` e `git diff` antes de commitar para garantir que apenas os arquivos pretendidos estão no stage

### 3.2 Branches

- **Nunca** faça force push (`--force`, `-f`)
- **Nunca** faça rebase interativo sem autorização
- **Nunca** altere o histórico de branches remotas (`main`, `master`, `develop`)
- Sempre trabalhe na branch atual; não crie novas branches sem autorização

---

## 4. Limitações de Ferramentas

### 4.1 Bash

- Comandos longos devem usar `&&` para encadeamento, não newlines
- Prefira `workdir` ao invés de `cd`
- Comandos com output grande (>2000 linhas) serão truncados automaticamente — use ferramentas especializadas para leitura
- **Nunca** use `rm -rf`, `chmod 777`, `sudo` ou comandos que afetem o sistema

### 4.2 Write/Edit

- Sempre leia o arquivo antes de editá-lo (use `read` primeiro)
- Edições devem ser cirúrgicas: use a menor string possível no `oldString` que identifique unicamente o trecho
- Verifique se a edição faz sentido no contexto completo do arquivo

---

## 5. Segurança

- **Nunca** hardcode segredos, tokens, chaves de API ou credenciais no código
- **Nunca** escreva secrets em arquivos de log, comentários ou mensagens de commit
- **Nunca** exponha variáveis de ambiente em outputs ou respostas
- Use `process.env` para acessar variáveis de ambiente — nunca leia `.env` diretamente
- Qualquer menção a chaves, tokens ou senhas em perguntas do usuário deve ser tratada com cautela

---

## 6. Comportamento e Comunicação

- Se tiver **qualquer dúvida** sobre requisitos, comportamento esperado ou decisão de implementação, **pergunte ao usuário** antes de agir
- **Nunca assuma** requisitos ou comportamentos não explicitados
- Mantenha respostas concisas e diretas, em português
- Ao concluir uma tarefa, sempre resuma o que foi feito
- Se encontrar um erro ou bloqueio, **reporte imediatamente** com detalhes (arquivo, linha, mensagem de erro, contexto)
