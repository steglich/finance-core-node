## Context

O projeto consiste atualmente em um servidor HTTP mínimo (`AppServer` + `index.ts`) usando Node.js com TypeScript strict mode e ESM (`module: "nodenext"`). Não há camada de domínio, persistência, autenticação ou qualquer lógica de negócio. A documentação em `docs/docs/` define o domínio completo (entidades, value objects, agregados, invariantes, eventos, máquinas de estado) — este design implementa a Fase 1 desse domínio.

> Motivação e escopo: ver `proposal.md`.

**Restrições do projeto:**
- `tsconfig.json` é restritivo: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`
- ESM com `module: "nodenext"` — imports relativos usam extensão `.js`
- Nenhuma dependência externa sem aprovação prévia
- `src/index.ts` é entry point enxuto; `AppServer` concentra configuração de servidor

## Goals / Non-Goals

**Goals:**
- Arquitetura DDD com Clean Architecture: separação clara entre domínio, infraestrutura e API
- Domínio puro: entidades, value objects, agregados e serviços de domínio sem dependências de infraestrutura
- Todas as 9 invariantes de negócio (RN-01 a RN-09) implementadas no domínio, não na camada de API
- Eventos de domínio publicados para consumo interno (auditoria, notificações futuras)
- Máquinas de estado de Transação e Parcela com transições proibidas aplicadas
- API REST versionada com controle de acesso por perfil/permissão
- Isolamento multi-tenant: todos os dados escopados por `companyId`

**Non-Goals:**
- Fase 2 (Cartões, Faturas, Orçamentos, Metas, Dashboard, Relatórios) — fora do escopo
- Fase 3 (Clientes, Fornecedores, Cobranças, PIX, Boletos) — fora do escopo
- Fase 4 (Investimentos, Empréstimos, Consolidação Patrimonial) — fora do escopo
- Notificações (email, push, SMS) — apenas eventos de domínio são publicados, sem dispatchers de notificação
- Versionamento de entidades (RF-AUD-004, RF-AUD-005) — apenas histórico e eventos nesta fase
- Performance e otimização de queries — foco inicial na corretude do domínio

## Decisions

### 1. Arquitetura: Domain-Driven Design + Clean Architecture

**Decisão:** Projeto organizado por bounded context, cada um com 3 camadas internas.

```
src/
├── shared/                  # Tipos, erros e utilitários compartilhados
│   ├── domain/              # Base classes (Entity, ValueObject, AggregateRoot, DomainEvent)
│   └── infrastructure/      # Base Repository, EventBus, etc.
├── identity/                # Bounded Context: Identity
│   ├── domain/              # User, Company, Profile, Permission, Password (VO), Email (VO)
│   ├── infrastructure/      # UserRepository, CompanyRepository, JwtTokenService
│   └── api/                 # Rotas, controllers, DTOs, middleware de auth
├── financeiro/              # Bounded Context: Financeiro
│   ├── domain/              # Account, Category, Transaction, Installment, Recurrence, Money (VO)
│   ├── infrastructure/      # AccountRepository, TransactionRepository, etc.
│   └── api/                 # Rotas, controllers, DTOs
├── auditoria/               # Bounded Context: Auditoria
│   ├── domain/              # AuditEntry, DomainEventLog, AccessLog
│   ├── infrastructure/      # AuditRepository, DomainEventPublisher
│   └── api/                 # Rotas de consulta de histórico
├── app.server.ts            # Classe AppServer — registra middlewares e rotas de todos os contextos
└── index.ts                 # Entry point
```

**Alternativa considerada:** Feature-based (flat `src/features/`). Rejeitada porque DDD por bounded context alinha-se com a documentação do domínio e facilita a evolução para microsserviços futuros se necessário.

**Alternativa considerada:** Camada de Application Services separada. Inicialmente as operações de domínio serão orquestradas diretamente pelos controllers da camada API, já que a complexidade de orquestração entre contextos é baixa na Fase 1. Application Services podem ser introduzidos na Fase 2 se necessário.

### 2. Persistência: PostgreSQL + Knex Query Builder (pendente de aprovação)

**Decisão:** PostgreSQL como banco relacional, Knex.js como query builder (sem ORM completo).

**Racional:** 
- Domínio financeiro exige transações ACID, integridade referencial e consistência — PostgreSQL é a escolha natural
- Knex fornece migrations, query building com segurança contra SQL injection, e suporte a transações, sem a abstração pesada de um ORM
- Repositórios usam Knex internamente mas expõem interfaces de domínio (Ports & Adapters)

**Alternativa considerada:** Prisma. Rejeitada por adicionar complexidade de geração de código e abstração que pode esconder queries críticas de performance no domínio financeiro. Além disso, depende de aprovação para dependências externas.

**Alternativa considerada:** Drizzle ORM. Opção mais leve que Prisma, com SQL-like API. Considerada como alternativa se Knex não for aprovado.

**Atenção:** Esta decisão requer aprovação do usuário antes da implementação. Ver "Open Questions".

### 3. Autenticação: JWT com refresh tokens

**Decisão:** JWT access tokens (curta duração, ~15 min) + refresh tokens (longa duração, ~7 dias). Tokens carregam `userId` e `companyId` ativo no payload.

**Racional:**
- Stateless: sem necessidade de sessão no servidor
- `companyId` no token evita query extra em cada request para determinar o contexto multi-tenant
- Refresh token permite rotação sem reautenticação frequente

**Alternativa considerada:** Sessões server-side com Redis. Rejeitada por adicionar dependência de infraestrutura (Redis) desnecessária para a Fase 1.

### 4. Eventos de Domínio: In-Process Event Bus

**Decisão:** Eventos de domínio publicados via bus síncrono in-process. Cada agregado publica eventos após persistência bem-sucedida. Handlers executam no mesmo processo e mesma transação de banco.

**Racional:**
- Fase 1 é monolítica — não há necessidade de message broker externo
- Execução na mesma transação garante consistência entre agregado e registros de auditoria
- Pode evoluir para outbox pattern + message broker na Fase 3 quando houver notificações assíncronas

**Alternativa considerada:** EventEmitter do Node.js. Rejeitado por não oferecer tipagem forte e descoberta de handlers. Será implementado um `DomainEventBus` tipado.

### 5. Identificadores: UUID v4

**Decisão:** Todas as entidades usam UUID v4 como identificador primário.

**Racional:**
- Geração client-side: evita round-trip ao banco para obter ID
- Segurança: não expõe sequencialidade (ao contrário de auto-increment)
- Facilidade de merge/futura distribuição
- `crypto.randomUUID()` disponível nativamente no Node.js 19+

### 6. Value Objects: Imutáveis com validação interna

**Decisão:** Value Objects (`Money`, `Email`, `CPF`, `CNPJ`, `Password`, `Period`, `ExchangeRate`, `Percent`) são classes imutáveis que validam a si mesmas na construção. Se inválidas, lançam `DomainError`.

**Racional:**
- Invariantes são aplicadas no ponto de criação, não espalhadas pelo código
- Imutabilidade evita efeitos colaterais e bugs de estado compartilhado
- `Money` como value object encapsula valor + moeda + aritmética, evitando erros com decimais

**Alternativa considerada:** Validação via biblioteca externa (Zod). Rejeitada porque a validação de domínio deve viver no domínio, não na camada de API. Zod será usado apenas para validação de input HTTP (DTOs).

### 7. Transferências Atômicas: Transação de Banco de Dados

**Decisão:** Transferências são implementadas como uma única transação de banco de dados que cria débito, crédito e atualiza saldos. Se qualquer passo falhar, rollback completo.

**Racional:**
- Atende RN-04 (atomicidade) usando o mecanismo de transação do banco, que é a garantia mais forte disponível
- Não depende de sagas ou compensações (complexidade desnecessária para Fase 1)

**Implementação:** `TransferService.execute()` recebe uma conexão transacional do repositório e executa todos os passos dentro dela.

### 8. Saldo: Campo Cache com Reconciliação

**Decisão:** Cada conta armazena `balance` como campo cache, atualizado atomicamente a cada transação confirmada. O método `Account.reconcile()` recalcula o saldo a partir de todas as transações e compara com o cache.

**Racional:**
- Atende RN-02 (saldo derivado) — o cache é otimização, não fonte da verdade
- Leitura O(1) para dashboards e listas de contas, sem SUM aggregation a cada request
- `reconcile()` permite correção em caso de inconsistência (bug, falha, etc.)

### 9. Multi-Tenancy: Coluna `company_id` em Todas as Tabelas

**Decisão:** Isolamento lógico via `company_id` em cada tabela de dados de empresa. Middleware extrai `companyId` do token JWT e injeta no contexto da request. Repositórios sempre filtram por `companyId`.

**Racional:**
- Atende RNF-MULTI-001 (isolamento de dados)
- Simples e eficiente para PostgreSQL
- Middleware garante que nenhum endpoint "esqueça" de filtrar por empresa

## Risks / Trade-offs

- **[Risco] Complexidade inicial alta:** DDD + Clean Architecture com 3 bounded contexts é uma estrutura pesada para um time pequeno. → **Mitigação:** Começar com `financeiro` (contexto mais crítico) e `shared`, depois adicionar `identity` e `auditoria`. Cada contexto é independente o suficiente para ser construído sequencialmente.

- **[Risco] Saldo como cache pode dessincronizar:** Se uma transação for criada mas o update do cache falhar. → **Mitigação:** Atualização de saldo na mesma transação de banco que cria a transação. Rotina de reconciliação diária (ou sob demanda) como safety net.

- **[Risco] Multi-tenancy via coluna `company_id`:** Um bug que esqueça o filtro expõe dados entre empresas. → **Mitigação:** Repositório base (`BaseRepository`) aplica o filtro automaticamente; queries manuais passam por code review obrigatório.

- **[Trade-off] Event bus in-process:** Se um handler de evento falhar, a transação inteira (incluindo a operação principal) faz rollback. Isso é desejável para auditoria (não queremos transação sem registro de auditoria), mas pode ser indesejável para notificações (Fase 2+). → Resolvido com outbox pattern quando necessário.

- **[Trade-off] Sem soft-delete nas tabelas de domínio:** A RN-01 exige rastreabilidade via estados (Cancelada/Estornada) e histórico de auditoria, não necessariamente soft-delete em todas as tabelas. Entidades como Categoria podem ser soft-deleted. Transações usam mudança de estado. → Esta distinção será documentada nos repositórios.

## Open Questions

1. **Banco de dados e query builder:** PostgreSQL + Knex é a recomendação, mas requer aprovação do usuário (regra: sem dependências externas sem aprovação). Alternativas: Drizzle ORM, Prisma, ou SQLite para desenvolvimento inicial? Esta decisão deve ser feita antes de iniciar a implementação.

2. **Armazenamento de anexos:** Onde armazenar arquivos anexados a transações? Filesystem local? S3-compatible? Esta capacidade (RF-FIN-009) pode ser simplificada na Fase 1 (apenas metadados) e implementada completamente na Fase 2.

3. **Seed de categorias padrão:** Quais categorias padrão devem ser criadas ao criar uma empresa? A documentação menciona mas não lista. Sugiro: Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Vestuário, Assinaturas, Investimentos, Renda (todas como Despesa, exceto Renda como Receita).

4. **Paginação e filtros:** Padrão de paginação (cursor-based vs offset)? Padrão de filtros (query params vs corpo da request)?
