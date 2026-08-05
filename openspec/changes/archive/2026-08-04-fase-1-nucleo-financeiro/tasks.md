## 1. Fundação — Domínio Compartilhado

- [x] 1.1 Criar `src/shared/domain/` com classes base: `Entity<TId>`, `ValueObject`, `AggregateRoot<TId>`, `DomainEvent`
- [x] 1.2 Criar `src/shared/domain/DomainError.ts` — classe de erro de domínio com código e mensagem
- [x] 1.3 Criar `src/shared/domain/DomainEventBus.ts` — barramento de eventos in-process tipado com `publish()` e `subscribe()`
- [x] 1.4 Criar `src/shared/domain/BaseRepository.ts` — interface genérica de repositório com filtro automático por `companyId`
- [x] 1.5 Criar `src/shared/infrastructure/` — implementações base (conexão de banco, logger)

## 2. Banco de Dados e Migrations

> **✅ Concluído:** PostgreSQL + Knex.js aprovado como solução para banco de dados e migrations.

- [x] 2.1 Configurar conexão com banco de dados e variáveis de ambiente (`DATABASE_URL`)
- [x] 2.2 Criar sistema de migrations (Knex.js migrations + seeds)
- [x] 2.3 Migration: `users`, `companies`, `company_users`, `profiles`, `permissions`, `profile_permissions`
- [x] 2.4 Migration: `wallets`, `accounts`, `categories`
- [x] 2.5 Migration: `transactions`, `installments`, `transaction_tags`, `transaction_attachments`
- [x] 2.6 Migration: `recurrences`
- [x] 2.7 Migration: `audit_entries`, `domain_event_logs`, `access_logs`
- [x] 2.8 Criar seed de categorias padrão para novas empresas

## 3. Identity — Domínio

- [x] 3.1 Implementar value objects: `Email`, `Password` (com hash/verificação), `CPF`, `CNPJ`, `CompanyType`
- [x] 3.2 Implementar entidade `User` (id, name, email, passwordHash, status, timestamps)
- [x] 3.3 Implementar entidade `Company` (id, name, type, defaultCurrency, timestamps)
- [x] 3.4 Implementar entidade `Profile` (id, companyId, name, permissions[])
- [x] 3.5 Implementar entidade `Permission` (resource, action)
- [x] 3.6 Implementar `User.create()` com validação de email único e hash de senha
- [x] 3.7 Implementar `Company.create()` com geração de categorias padrão
- [x] 3.8 Implementar `Company.addUser(userId, profileId)` e `Company.removeUser(userId)`
- [x] 3.9 Implementar eventos de domínio: `UserRegistered`, `UserAddedToCompany`

## 4. Identity — Infraestrutura

- [x] 4.1 Implementar `UserRepository` (create, findByEmail, findById, update)
- [x] 4.2 Implementar `CompanyRepository` (create, findById, findByUserId, addUser, removeUser)
- [x] 4.3 Implementar `ProfileRepository` (create, findById, findByCompanyId, update, delete)
- [x] 4.4 Implementar `JwtTokenService` (generateAccessToken, generateRefreshToken, verify, decode)
- [x] 4.5 Implementar `PasswordService` (hash com bcrypt/argon2, verify)

## 5. Identity — API

- [x] 5.1 Criar `POST /api/v1/auth/register` — registro de usuário (retorna tokens)
- [x] 5.2 Criar `POST /api/v1/auth/login` — autenticação (retorna tokens + lista de empresas)
- [x] 5.3 Criar `POST /api/v1/auth/refresh` — renovação de access token via refresh token
- [x] 5.4 Criar `POST /api/v1/auth/recover-password` — solicitação de recuperação de senha
- [x] 5.5 Criar `POST /api/v1/auth/reset-password` — redefinição de senha com token
- [x] 5.6 Criar middleware `authMiddleware` — extrai e valida JWT, injeta `userId` e `companyId` no request context
- [x] 5.7 Criar middleware `requirePermission(permission)` — verifica permissão do perfil ativo
- [x] 5.8 Criar `POST /api/v1/companies` — criar empresa
- [x] 5.9 Criar `GET /api/v1/companies` — listar empresas do usuário
- [x] 5.10 Criar `PUT /api/v1/companies/:id/switch` — alternar empresa ativa (atualiza token)
- [x] 5.11 Criar `POST /api/v1/companies/:id/users` — convidar usuário
- [x] 5.12 Criar `DELETE /api/v1/companies/:id/users/:userId` — remover usuário
- [x] 5.13 Criar `GET /api/v1/profiles` — listar perfis da empresa
- [x] 5.14 Criar `POST /api/v1/profiles` — criar perfil
- [x] 5.15 Criar `PUT /api/v1/profiles/:id` — editar perfil
- [x] 5.16 Criar `DELETE /api/v1/profiles/:id` — excluir perfil

## 6. Financeiro — Domínio (Value Objects e Entidades Base)

- [x] 6.1 Implementar value object `Money` (amount: Decimal, currency: string) — imutável, com operações aritméticas, validação de moeda ISO 4217
- [x] 6.2 Implementar value object `ExchangeRate` (sourceCurrency, targetCurrency, rate, date) — imutável
- [x] 6.3 Implementar value object `Period` (startDate, endDate) — com validação startDate <= endDate
- [x] 6.4 Implementar value object `Percent` (value: 0-100) — imutável
- [x] 6.5 Implementar entidade `Wallet` (id, companyId, name, institution)
- [x] 6.6 Implementar entidade `Account` como Aggregate Root — com `credit()`, `debit()`, `reconcile()`, `deactivate()`
- [x] 6.7 Implementar `Account.create()` — valida moeda suportada, gera transação de ajuste para saldo inicial, publica evento
- [x] 6.8 Implementar invariante RN-03 (toda transação vinculada a conta) e RN-02 (saldo derivado) no agregado `Account`

## 7. Financeiro — Domínio (Categorias)

- [x] 7.1 Implementar entidade `Category` — com hierarquia (parentId), tipo (EXPENSE/INCOME), cor, ícone
- [x] 7.2 Implementar `Category.moveTo(newParentId)` — validação de não-circularidade
- [x] 7.3 Implementar `Category.delete()` — bloqueia se houver transações ou subcategorias vinculadas
- [x] 7.4 Implementar invariante RN-06 (categorias não alteram comportamento financeiro)

## 8. Financeiro — Domínio (Transações)

- [x] 8.1 Implementar entidade `Transaction` como Aggregate Root — com campos: type, status, grossAmount, discount, interest, penalty, netAmount, currency, exchangeRate, date, competence, description
- [x] 8.2 Implementar `Transaction.confirm()` — transição Pendente → Confirmada, publica `TransactionPosted`
- [x] 8.3 Implementar `Transaction.cancel()` — transição Pendente → Cancelada, publica `TransactionCancelled`
- [x] 8.4 Implementar `Transaction.refund()` — transição Confirmada → Estornada, publica `TransactionRefunded`
- [x] 8.5 Implementar validação da máquina de estados (transições proibidas lançam `DomainError`)
- [x] 8.6 Implementar cálculo de valor líquido: `netAmount = grossAmount - discount + interest + penalty`
- [x] 8.7 Implementar `Transaction.edit()` — apenas campos permitidos, apenas se Pendente, registra auditoria

## 9. Financeiro — Domínio (Parcelamentos)

- [x] 9.1 Implementar entidade `Installment` — com: number, amount, dueDate, status (Pendente/Paga/Atrasada), paymentDate, parentTransactionId
- [x] 9.2 Implementar máquina de estados da Parcela: Pendente → Paga, Pendente → Atrasada, Atrasada → Paga
- [x] 9.3 Implementar `Installment.pay(paymentDate, accountId)` — publica `InstallmentPaid`
- [x] 9.4 Implementar `Installment.markOverdue()` — publica `InstallmentOverdue`
- [x] 9.5 Implementar `Installment.changeDueDate(newDate)` — apenas se Pendente, registra auditoria
- [x] 9.6 Implementar invariante RN-05 (parcelas com vida própria, origem comum)

## 10. Financeiro — Domínio (Transferências)

- [x] 10.1 Implementar serviço de domínio `TransferService` — orquestra débito + crédito atômicos
- [x] 10.2 Implementar validação de saldo antes da transferência
- [x] 10.3 Implementar suporte a transferência entre moedas diferentes com `ExchangeRate`
- [x] 10.4 Implementar invariante RN-04 (atomicidade: débito e crédito vinculados por `transferId`)
- [x] 10.5 Implementar invariante RN-07 (transações multimoeda exigem taxa de câmbio registrada)
- [x] 10.6 Implementar `TransferService.reverse()` — estorna transferência, publica `TransferReversed`

## 11. Financeiro — Domínio (Recorrências)

- [x] 11.1 Implementar entidade `Recurrence` — com: description, amount, accountId, categoryId, periodicity, startDate, endDate?, maxOccurrences?, status
- [x] 11.2 Implementar `Recurrence.pause()` e `Recurrence.resume()`
- [x] 11.3 Implementar `Recurrence.cancel()` — interrompe geração futura, mantém transações existentes
- [x] 11.4 Implementar `RecurrenceService` — calcula próxima data de ocorrência para cada periodicidade
- [x] 11.5 Implementar tratamento de edge cases de datas (dia 31, fevereiro, anos bissextos)

## 12. Financeiro — Infraestrutura

- [x] 12.1 Implementar `WalletRepository`
- [x] 12.2 Implementar `AccountRepository` com atualização atômica de saldo
- [x] 12.3 Implementar `CategoryRepository` com queries hierárquicas
- [x] 12.4 Implementar `TransactionRepository` com suporte a transações atômicas (para transferências)
- [x] 12.5 Implementar `InstallmentRepository`
- [x] 12.6 Implementar `RecurrenceRepository`

## 13. Financeiro — API

- [x] 13.1 Criar `POST /api/v1/accounts` — criar conta
- [x] 13.2 Criar `GET /api/v1/accounts` — listar contas
- [x] 13.3 Criar `GET /api/v1/accounts/:id` — detalhe da conta com saldo
- [x] 13.4 Criar `PUT /api/v1/accounts/:id` — editar conta
- [x] 13.5 Criar `POST /api/v1/accounts/:id/deactivate` — inativar conta
- [x] 13.6 Criar `POST /api/v1/categories` — criar categoria
- [x] 13.7 Criar `GET /api/v1/categories` — listar categorias (hierárquico)
- [x] 13.8 Criar `PUT /api/v1/categories/:id` — editar categoria
- [x] 13.9 Criar `DELETE /api/v1/categories/:id` — excluir categoria
- [x] 13.10 Criar `POST /api/v1/categories/:id/move` — mover categoria na hierarquia
- [x] 13.11 Criar `POST /api/v1/transactions` — registrar transação (simples e parcelada)
- [x] 13.12 Criar `GET /api/v1/transactions` — listar transações com filtros (data, categoria, conta, tipo, status)
- [x] 13.13 Criar `GET /api/v1/transactions/:id` — detalhe da transação
- [x] 13.14 Criar `PUT /api/v1/transactions/:id` — editar transação pendente
- [x] 13.15 Criar `POST /api/v1/transactions/:id/confirm` — confirmar transação
- [x] 13.16 Criar `POST /api/v1/transactions/:id/cancel` — cancelar transação
- [x] 13.17 Criar `POST /api/v1/transactions/:id/refund` — estornar transação
- [x] 13.18 Criar `POST /api/v1/transactions/:id/attachments` — anexar arquivo
- [x] 13.19 Criar `GET /api/v1/transactions/:id/attachments/:attachmentId` — baixar anexo
- [x] 13.20 Criar `GET /api/v1/installments` — listar parcelas com filtros
- [x] 13.21 Criar `PUT /api/v1/installments/:id/due-date` — alterar vencimento
- [x] 13.22 Criar `POST /api/v1/installments/:id/pay` — pagar parcela individual
- [x] 13.23 Criar `POST /api/v1/installments/pay` — pagamento em lote
- [x] 13.24 Criar `POST /api/v1/transfers` — realizar transferência
- [x] 13.25 Criar `POST /api/v1/recurrences` — criar recorrência
- [x] 13.26 Criar `GET /api/v1/recurrences` — listar recorrências
- [x] 13.27 Criar `PUT /api/v1/recurrences/:id` — editar recorrência
- [x] 13.28 Criar `POST /api/v1/recurrences/:id/pause` — pausar recorrência
- [x] 13.29 Criar `POST /api/v1/recurrences/:id/resume` — retomar recorrência
- [x] 13.30 Criar `POST /api/v1/recurrences/:id/cancel` — cancelar recorrência

## 14. Auditoria — Domínio

- [x] 14.1 Implementar entidade `AuditEntry` — entityType, entityId, operation, field, oldValue, newValue, userId, timestamp
- [x] 14.2 Implementar entidade `DomainEventLog` — eventType, entityId, payload, userId, timestamp
- [x] 14.3 Implementar entidade `AccessLog` — eventType (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGE), userId?, email, ipAddress, timestamp

## 15. Auditoria — Infraestrutura

- [x] 15.1 Implementar `AuditRepository` com método `append()` append-only
- [x] 15.2 Implementar `DomainEventLogRepository` com método `persist()` append-only
- [x] 15.3 Implementar `AccessLogRepository`
- [x] 15.4 Implementar handlers de eventos de domínio que persistem em `AuditEntry` e `DomainEventLog`
- [x] 15.5 Registrar handlers no `DomainEventBus` para todos os eventos da Fase 1

## 16. Auditoria — API

- [x] 16.1 Criar `GET /api/v1/audit/entities/:entityType/:entityId` — histórico de alterações de uma entidade
- [x] 16.2 Criar `GET /api/v1/audit/events` — listar eventos de domínio com filtros
- [x] 16.3 Criar `GET /api/v1/audit/access-logs` — listar logs de acesso (admin apenas)

## 17. Integração e Wiring

- [x] 17.1 Configurar `AppServer` para registrar todas as rotas dos 3 bounded contexts
- [x] 17.2 Configurar injeção de dependências (repositórios → serviços → controllers)
- [x] 17.3 Implementar tratamento global de erros (domain errors → HTTP 4xx, unexpected → HTTP 500)
- [x] 17.4 Implementar logging estruturado de requests/responses
- [x] 17.5 Implementar validação de schemas de entrada para todos os endpoints — feita à mão em `api/dtos.ts` (o AGENTS.md proíbe adicionar Zod)
- [x] 17.6 Criar script scheduler para processamento de recorrências e verificação de parcelas vencidas

## 18. Testes

> Runner: `node:test` nativo + `tsx` (`npm test`), escolhido para não adicionar dependências.

- [x] 18.1 Testes unitários dos value objects: `Money`, `Email`, `Password`, `ExchangeRate`, `Period`, `Percent`
- [x] 18.2 Testes unitários das máquinas de estado: `Transaction` e `Installment`
- [x] 18.3 Testes unitários dos serviços de domínio: `TransferService`, `ParcelamentoService`, `RecorrenciaService`
- [x] 18.4 Testes unitários das invariantes de negócio (RN-01 a RN-09)
- [x] 18.5 Testes de integração da API (happy path + error cases para cada endpoint)
