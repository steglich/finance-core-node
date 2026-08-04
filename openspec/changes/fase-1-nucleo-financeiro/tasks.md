## 1. Fundação — Domínio Compartilhado

- [ ] 1.1 Criar `src/shared/domain/` com classes base: `Entity<TId>`, `ValueObject`, `AggregateRoot<TId>`, `DomainEvent`
- [ ] 1.2 Criar `src/shared/domain/DomainError.ts` — classe de erro de domínio com código e mensagem
- [ ] 1.3 Criar `src/shared/domain/DomainEventBus.ts` — barramento de eventos in-process tipado com `publish()` e `subscribe()`
- [ ] 1.4 Criar `src/shared/domain/BaseRepository.ts` — interface genérica de repositório com filtro automático por `companyId`
- [ ] 1.5 Criar `src/shared/infrastructure/` — implementações base (conexão de banco, logger)

## 2. Banco de Dados e Migrations

> **⚠️ Bloqueado até resolver Open Question #1 do design.md (banco de dados + query builder)**

- [ ] 2.1 Configurar conexão com banco de dados e variáveis de ambiente (`DATABASE_URL`)
- [ ] 2.2 Criar sistema de migrations
- [ ] 2.3 Migration: `users`, `companies`, `company_users`, `profiles`, `permissions`, `profile_permissions`
- [ ] 2.4 Migration: `wallets`, `accounts`, `categories`
- [ ] 2.5 Migration: `transactions`, `installments`, `transaction_tags`, `transaction_attachments`
- [ ] 2.6 Migration: `recurrences`
- [ ] 2.7 Migration: `audit_entries`, `domain_event_logs`, `access_logs`
- [ ] 2.8 Criar seed de categorias padrão para novas empresas

## 3. Identity — Domínio

- [ ] 3.1 Implementar value objects: `Email`, `Password` (com hash/verificação), `CPF`, `CNPJ`, `CompanyType`
- [ ] 3.2 Implementar entidade `User` (id, name, email, passwordHash, status, timestamps)
- [ ] 3.3 Implementar entidade `Company` (id, name, type, defaultCurrency, timestamps)
- [ ] 3.4 Implementar entidade `Profile` (id, companyId, name, permissions[])
- [ ] 3.5 Implementar entidade `Permission` (resource, action)
- [ ] 3.6 Implementar `User.create()` com validação de email único e hash de senha
- [ ] 3.7 Implementar `Company.create()` com geração de categorias padrão
- [ ] 3.8 Implementar `Company.addUser(userId, profileId)` e `Company.removeUser(userId)`
- [ ] 3.9 Implementar eventos de domínio: `UserRegistered`, `UserAddedToCompany`

## 4. Identity — Infraestrutura

- [ ] 4.1 Implementar `UserRepository` (create, findByEmail, findById, update)
- [ ] 4.2 Implementar `CompanyRepository` (create, findById, findByUserId, addUser, removeUser)
- [ ] 4.3 Implementar `ProfileRepository` (create, findById, findByCompanyId, update, delete)
- [ ] 4.4 Implementar `JwtTokenService` (generateAccessToken, generateRefreshToken, verify, decode)
- [ ] 4.5 Implementar `PasswordService` (hash com bcrypt/argon2, verify)

## 5. Identity — API

- [ ] 5.1 Criar `POST /api/v1/auth/register` — registro de usuário (retorna tokens)
- [ ] 5.2 Criar `POST /api/v1/auth/login` — autenticação (retorna tokens + lista de empresas)
- [ ] 5.3 Criar `POST /api/v1/auth/refresh` — renovação de access token via refresh token
- [ ] 5.4 Criar `POST /api/v1/auth/recover-password` — solicitação de recuperação de senha
- [ ] 5.5 Criar `POST /api/v1/auth/reset-password` — redefinição de senha com token
- [ ] 5.6 Criar middleware `authMiddleware` — extrai e valida JWT, injeta `userId` e `companyId` no request context
- [ ] 5.7 Criar middleware `requirePermission(permission)` — verifica permissão do perfil ativo
- [ ] 5.8 Criar `POST /api/v1/companies` — criar empresa
- [ ] 5.9 Criar `GET /api/v1/companies` — listar empresas do usuário
- [ ] 5.10 Criar `PUT /api/v1/companies/:id/switch` — alternar empresa ativa (atualiza token)
- [ ] 5.11 Criar `POST /api/v1/companies/:id/users` — convidar usuário
- [ ] 5.12 Criar `DELETE /api/v1/companies/:id/users/:userId` — remover usuário
- [ ] 5.13 Criar `GET /api/v1/profiles` — listar perfis da empresa
- [ ] 5.14 Criar `POST /api/v1/profiles` — criar perfil
- [ ] 5.15 Criar `PUT /api/v1/profiles/:id` — editar perfil
- [ ] 5.16 Criar `DELETE /api/v1/profiles/:id` — excluir perfil

## 6. Financeiro — Domínio (Value Objects e Entidades Base)

- [ ] 6.1 Implementar value object `Money` (amount: Decimal, currency: string) — imutável, com operações aritméticas, validação de moeda ISO 4217
- [ ] 6.2 Implementar value object `ExchangeRate` (sourceCurrency, targetCurrency, rate, date) — imutável
- [ ] 6.3 Implementar value object `Period` (startDate, endDate) — com validação startDate <= endDate
- [ ] 6.4 Implementar value object `Percent` (value: 0-100) — imutável
- [ ] 6.5 Implementar entidade `Wallet` (id, companyId, name, institution)
- [ ] 6.6 Implementar entidade `Account` como Aggregate Root — com `credit()`, `debit()`, `reconcile()`, `deactivate()`
- [ ] 6.7 Implementar `Account.create()` — valida moeda suportada, gera transação de ajuste para saldo inicial, publica evento
- [ ] 6.8 Implementar invariante RN-03 (toda transação vinculada a conta) e RN-02 (saldo derivado) no agregado `Account`

## 7. Financeiro — Domínio (Categorias)

- [ ] 7.1 Implementar entidade `Category` — com hierarquia (parentId), tipo (EXPENSE/INCOME), cor, ícone
- [ ] 7.2 Implementar `Category.moveTo(newParentId)` — validação de não-circularidade
- [ ] 7.3 Implementar `Category.delete()` — bloqueia se houver transações ou subcategorias vinculadas
- [ ] 7.4 Implementar invariante RN-06 (categorias não alteram comportamento financeiro)

## 8. Financeiro — Domínio (Transações)

- [ ] 8.1 Implementar entidade `Transaction` como Aggregate Root — com campos: type, status, grossAmount, discount, interest, penalty, netAmount, currency, exchangeRate, date, competence, description
- [ ] 8.2 Implementar `Transaction.confirm()` — transição Pendente → Confirmada, publica `TransactionPosted`
- [ ] 8.3 Implementar `Transaction.cancel()` — transição Pendente → Cancelada, publica `TransactionCancelled`
- [ ] 8.4 Implementar `Transaction.refund()` — transição Confirmada → Estornada, publica `TransactionRefunded`
- [ ] 8.5 Implementar validação da máquina de estados (transições proibidas lançam `DomainError`)
- [ ] 8.6 Implementar cálculo de valor líquido: `netAmount = grossAmount - discount + interest + penalty`
- [ ] 8.7 Implementar `Transaction.edit()` — apenas campos permitidos, apenas se Pendente, registra auditoria

## 9. Financeiro — Domínio (Parcelamentos)

- [ ] 9.1 Implementar entidade `Installment` — com: number, amount, dueDate, status (Pendente/Paga/Atrasada), paymentDate, parentTransactionId
- [ ] 9.2 Implementar máquina de estados da Parcela: Pendente → Paga, Pendente → Atrasada, Atrasada → Paga
- [ ] 9.3 Implementar `Installment.pay(paymentDate, accountId)` — publica `InstallmentPaid`
- [ ] 9.4 Implementar `Installment.markOverdue()` — publica `InstallmentOverdue`
- [ ] 9.5 Implementar `Installment.changeDueDate(newDate)` — apenas se Pendente, registra auditoria
- [ ] 9.6 Implementar invariante RN-05 (parcelas com vida própria, origem comum)

## 10. Financeiro — Domínio (Transferências)

- [ ] 10.1 Implementar serviço de domínio `TransferService` — orquestra débito + crédito atômicos
- [ ] 10.2 Implementar validação de saldo antes da transferência
- [ ] 10.3 Implementar suporte a transferência entre moedas diferentes com `ExchangeRate`
- [ ] 10.4 Implementar invariante RN-04 (atomicidade: débito e crédito vinculados por `transferId`)
- [ ] 10.5 Implementar invariante RN-07 (transações multimoeda exigem taxa de câmbio registrada)
- [ ] 10.6 Implementar `TransferService.reverse()` — estorna transferência, publica `TransferReversed`

## 11. Financeiro — Domínio (Recorrências)

- [ ] 11.1 Implementar entidade `Recurrence` — com: description, amount, accountId, categoryId, periodicity, startDate, endDate?, maxOccurrences?, status
- [ ] 11.2 Implementar `Recurrence.pause()` e `Recurrence.resume()`
- [ ] 11.3 Implementar `Recurrence.cancel()` — interrompe geração futura, mantém transações existentes
- [ ] 11.4 Implementar `RecurrenceService` — calcula próxima data de ocorrência para cada periodicidade
- [ ] 11.5 Implementar tratamento de edge cases de datas (dia 31, fevereiro, anos bissextos)

## 12. Financeiro — Infraestrutura

- [ ] 12.1 Implementar `WalletRepository`
- [ ] 12.2 Implementar `AccountRepository` com atualização atômica de saldo
- [ ] 12.3 Implementar `CategoryRepository` com queries hierárquicas
- [ ] 12.4 Implementar `TransactionRepository` com suporte a transações atômicas (para transferências)
- [ ] 12.5 Implementar `InstallmentRepository`
- [ ] 12.6 Implementar `RecurrenceRepository`

## 13. Financeiro — API

- [ ] 13.1 Criar `POST /api/v1/accounts` — criar conta
- [ ] 13.2 Criar `GET /api/v1/accounts` — listar contas
- [ ] 13.3 Criar `GET /api/v1/accounts/:id` — detalhe da conta com saldo
- [ ] 13.4 Criar `PUT /api/v1/accounts/:id` — editar conta
- [ ] 13.5 Criar `POST /api/v1/accounts/:id/deactivate` — inativar conta
- [ ] 13.6 Criar `POST /api/v1/categories` — criar categoria
- [ ] 13.7 Criar `GET /api/v1/categories` — listar categorias (hierárquico)
- [ ] 13.8 Criar `PUT /api/v1/categories/:id` — editar categoria
- [ ] 13.9 Criar `DELETE /api/v1/categories/:id` — excluir categoria
- [ ] 13.10 Criar `POST /api/v1/categories/:id/move` — mover categoria na hierarquia
- [ ] 13.11 Criar `POST /api/v1/transactions` — registrar transação (simples e parcelada)
- [ ] 13.12 Criar `GET /api/v1/transactions` — listar transações com filtros (data, categoria, conta, tipo, status)
- [ ] 13.13 Criar `GET /api/v1/transactions/:id` — detalhe da transação
- [ ] 13.14 Criar `PUT /api/v1/transactions/:id` — editar transação pendente
- [ ] 13.15 Criar `POST /api/v1/transactions/:id/confirm` — confirmar transação
- [ ] 13.16 Criar `POST /api/v1/transactions/:id/cancel` — cancelar transação
- [ ] 13.17 Criar `POST /api/v1/transactions/:id/refund` — estornar transação
- [ ] 13.18 Criar `POST /api/v1/transactions/:id/attachments` — anexar arquivo
- [ ] 13.19 Criar `GET /api/v1/transactions/:id/attachments/:attachmentId` — baixar anexo
- [ ] 13.20 Criar `GET /api/v1/installments` — listar parcelas com filtros
- [ ] 13.21 Criar `PUT /api/v1/installments/:id/due-date` — alterar vencimento
- [ ] 13.22 Criar `POST /api/v1/installments/:id/pay` — pagar parcela individual
- [ ] 13.23 Criar `POST /api/v1/installments/pay` — pagamento em lote
- [ ] 13.24 Criar `POST /api/v1/transfers` — realizar transferência
- [ ] 13.25 Criar `POST /api/v1/recurrences` — criar recorrência
- [ ] 13.26 Criar `GET /api/v1/recurrences` — listar recorrências
- [ ] 13.27 Criar `PUT /api/v1/recurrences/:id` — editar recorrência
- [ ] 13.28 Criar `POST /api/v1/recurrences/:id/pause` — pausar recorrência
- [ ] 13.29 Criar `POST /api/v1/recurrences/:id/resume` — retomar recorrência
- [ ] 13.30 Criar `POST /api/v1/recurrences/:id/cancel` — cancelar recorrência

## 14. Auditoria — Domínio

- [ ] 14.1 Implementar entidade `AuditEntry` — entityType, entityId, operation, field, oldValue, newValue, userId, timestamp
- [ ] 14.2 Implementar entidade `DomainEventLog` — eventType, entityId, payload, userId, timestamp
- [ ] 14.3 Implementar entidade `AccessLog` — eventType (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGE), userId?, email, ipAddress, timestamp

## 15. Auditoria — Infraestrutura

- [ ] 15.1 Implementar `AuditRepository` com método `append()` append-only
- [ ] 15.2 Implementar `DomainEventLogRepository` com método `persist()` append-only
- [ ] 15.3 Implementar `AccessLogRepository`
- [ ] 15.4 Implementar handlers de eventos de domínio que persistem em `AuditEntry` e `DomainEventLog`
- [ ] 15.5 Registrar handlers no `DomainEventBus` para todos os eventos da Fase 1

## 16. Auditoria — API

- [ ] 16.1 Criar `GET /api/v1/audit/entities/:entityType/:entityId` — histórico de alterações de uma entidade
- [ ] 16.2 Criar `GET /api/v1/audit/events` — listar eventos de domínio com filtros
- [ ] 16.3 Criar `GET /api/v1/audit/access-logs` — listar logs de acesso (admin apenas)

## 17. Integração e Wiring

- [ ] 17.1 Configurar `AppServer` para registrar todas as rotas dos 3 bounded contexts
- [ ] 17.2 Configurar injeção de dependências (repositórios → serviços → controllers)
- [ ] 17.3 Implementar tratamento global de erros (domain errors → HTTP 4xx, unexpected → HTTP 500)
- [ ] 17.4 Implementar logging estruturado de requests/responses
- [ ] 17.5 Implementar validação de schemas de entrada (Zod) para todos os endpoints
- [ ] 17.6 Criar script scheduler para processamento de recorrências e verificação de parcelas vencidas

## 18. Testes

- [ ] 18.1 Testes unitários dos value objects: `Money`, `Email`, `Password`, `ExchangeRate`, `Period`, `Percent`
- [ ] 18.2 Testes unitários das máquinas de estado: `Transaction` e `Installment`
- [ ] 18.3 Testes unitários dos serviços de domínio: `TransferService`, `ParcelamentoService`, `RecorrenciaService`
- [ ] 18.4 Testes unitários das invariantes de negócio (RN-01 a RN-09)
- [ ] 18.5 Testes de integração da API (happy path + error cases para cada endpoint)
