## 1. Banco de Dados

- [x] 1.1 Criar migration `20240101000006_create_phase2_tables.ts` com a tabela `cards` (id, company_id, account_id, name, type, brand, bank, credit_limit, closing_day, due_day, is_active, timestamps) e FKs para `companies`/`accounts`
- [x] 1.2 Adicionar na mesma migration a tabela `invoices` (id, company_id, card_id, cycle_start, closing_date, due_date, status, total_amount, paid_amount, currency, closed_at, closed_by, timestamps) com índice único em (`card_id`, `closing_date`)
- [x] 1.3 Adicionar a tabela `invoice_payments` (id, invoice_id, transaction_id, account_id, amount, paid_at)
- [x] 1.4 Adicionar a tabela `budgets` (id, company_id, category_id, period_start, period_end, planned_amount, currency, status, exceeded_notified, closed_at, timestamps)
- [x] 1.5 Adicionar as tabelas `goals` (id, company_id, account_id, name, target_amount, current_amount, currency, deadline, status, achieved_at, timestamps) e `goal_contributions` (id, goal_id, transaction_id, amount, contributed_at)
- [x] 1.6 Adicionar as colunas nullable `card_id` e `invoice_id` em `transactions`, com FKs
- [x] 1.7 Criar os índices de agregação: `transactions(company_id, status, date)`, `transactions(company_id, category_id, status, date)`, `transactions(card_id, invoice_id)`, `invoices(company_id, status, due_date)`
- [x] 1.8 Implementar o `down()` da migration revertendo colunas e tabelas na ordem inversa; validar `db:migrate` e `db:migrate:rollback`

## 2. Cartões — Domínio

- [x] 2.1 Implementar `src/financeiro/domain/card.ts` — entidade `Card` com `CardType` (CREDIT/DEBIT/PREPAID), `Card.create()` validando conta da mesma empresa, limite > 0 para CREDIT/PREPAID e `closingDay`/`dueDay` entre 1 e 31
- [x] 2.2 Implementar `Card.availableLimit(committed: Money): Money` — limite menos o comprometido; retorna erro/ausente para cartão DEBIT
- [x] 2.3 Implementar `Card.edit()` — name, brand, bank, limit, closingDay, dueDay mutáveis; type e accountId imutáveis; rejeitar limite abaixo do valor já comprometido
- [x] 2.4 Implementar `Card.deactivate(openInvoiceCount, unpaidInvoiceCount)` — bloqueia com fatura aberta ou não paga
- [x] 2.5 Implementar `src/financeiro/domain/card-events.ts` — `CardCreated`, `CardLimitChanged`, `CardDeactivated`
- [x] 2.6 Escrever testes de `Card` em `card.test.ts` cobrindo os cenários de `specs/cartoes/spec.md` (criação inválida, limite derivado, edição proibida, inativação bloqueada)

## 3. Ciclo de Fatura — Domínio

- [x] 3.1 Implementar `src/financeiro/domain/invoice-cycle.ts` — funções puras `closingDateFor(date, closingDay)` e `dueDateFor(closingDate, dueDay)`, normalizando dias 29–31 para o último dia do mês via `date-math.ts`
- [x] 3.2 Escrever `invoice-cycle.test.ts` cobrindo fevereiro, meses de 30 dias, compra antes/depois do fechamento e `dueDay` menor que `closingDay`
- [x] 3.3 Implementar `src/financeiro/domain/invoice.ts` — aggregate root `Invoice` com `InvoiceStatus` (OPEN/CLOSED/PARTIALLY_PAID/PAID/OVERDUE), `Invoice.open()`, `total`, `paidAmount`, `outstanding`
- [x] 3.4 Implementar `Invoice.close(purchaseTotal, transactionIds)` — só a partir de OPEN; total zero fecha como PAID; levanta `InvoiceClosed`
- [x] 3.5 Implementar `Invoice.registerPayment(amount)` — rejeita valor <= 0, valor acima do saldo em aberto e fatura OPEN ou PAID; transiciona para PARTIALLY_PAID ou PAID; levanta `InvoicePaid` na quitação
- [x] 3.6 Implementar `Invoice.markOverdue(referenceDate)` — só de CLOSED/PARTIALLY_PAID com vencimento passado; levanta `InvoiceOverdue` com dias de atraso
- [x] 3.7 Implementar `Invoice.adjustForRefund(amount)` — reduz total e saldo em aberto de fatura fechada e não paga
- [x] 3.8 Implementar `src/financeiro/domain/invoice-events.ts` — `InvoiceClosed`, `InvoicePaid`, `InvoiceOverdue` com os payloads de `docs/docs/eventos-dominio.md`
- [x] 3.9 Escrever `invoice.test.ts` cobrindo a máquina de estados de `specs/faturas/spec.md`, incluindo as transições proibidas (sair de PAID, CLOSED → OPEN)

## 4. Fatura — Serviços de Domínio

- [x] 4.1 Implementar `src/financeiro/domain/invoice-closing-service.ts` — consolida as compras do ciclo, calcula o total e fecha a fatura; idempotente por estado
- [x] 4.2 Implementar `src/financeiro/domain/invoice-payment-service.ts` — valida saldo disponível da conta, cria a transação de despesa confirmada, debita a conta, registra o pagamento e transiciona a fatura, tudo em uma transação de banco
- [x] 4.3 Implementar a atribuição de compra ao ciclo — dado cartão e data, localizar ou abrir a fatura do ciclo e vincular a transação
- [x] 4.4 Escrever `invoice-services.test.ts` cobrindo pagamento total, parcial, saldo insuficiente, pagamento acima do saldo em aberto e pagamento de fatura já paga

## 5. Cartões e Faturas — Infraestrutura

- [x] 5.1 Criar `src/financeiro/infrastructure/card-repository.ts` — interface com `create`, `findById`, `findByCompany`, `findByAccount`, `update`, `committedAmount`
- [x] 5.2 Implementar `knex-card-repository.ts` com filtro obrigatório por `companyId` e `SELECT ... FOR UPDATE` na checagem de limite
- [x] 5.3 Criar `invoice-repository.ts` — interface com `findOpenByCard`, `findById`, `findByCard`, `findDueForClosing(date)`, `findOverdue(date)`, `create`, `update`, `linkTransaction`, `registerPayment`
- [x] 5.4 Implementar `knex-invoice-repository.ts` respeitando o índice único por (`card_id`, `closing_date`)
- [x] 5.5 Estender `knex-transaction-repository.ts` para persistir e ler `card_id` e `invoice_id`

## 6. Transações com Cartão

- [x] 6.1 Estender `Transaction` com `cardId?` e `invoiceId?` em `TransactionProps`, `CreateTransactionInput` e `toJSON()`
- [x] 6.2 Implementar a regra de confirmação: compra em cartão CREDIT não chama `Account.debit()`; cartão DEBIT segue o fluxo de despesa existente
- [x] 6.3 Bloquear edição e cancelamento de transação vinculada a fatura fechada; permitir estorno com ajuste da fatura via `Invoice.adjustForRefund()`
- [x] 6.4 Validar no registro: cartão ativo, da mesma empresa e com limite disponível suficiente
- [x] 6.5 Atualizar `invariants.test.ts` / `state-machines.test.ts` com os cenários de `specs/transacoes/spec.md` (compra em crédito não move saldo, transação faturada protegida)

## 7. Orçamentos — Domínio

- [x] 7.1 Implementar `src/financeiro/domain/budget.ts` — aggregate root `Budget` com categoria, `Period`, `plannedAmount`, `status`, `exceededNotified`; `Budget.create()` validando valor > 0, categoria de despesa e período válido
- [x] 7.2 Implementar `Budget.progress(actual: Money)` — retorna valor gasto, `Percent` de uso e valor restante
- [x] 7.3 Implementar `Budget.evaluate(actual)` — marca como excedido e levanta `BudgetExceeded` na primeira ultrapassagem; rearma quando volta abaixo de 100%
- [x] 7.4 Implementar `Budget.closePeriod(actual, referenceDate)` — congela o valor, bloqueia edição e levanta `BudgetPeriodClosed` com a variação
- [x] 7.5 Implementar `Budget.edit()` e `Budget.deactivate()` — edição bloqueada em período fechado
- [x] 7.6 Implementar `src/financeiro/domain/budget-events.ts` — `BudgetCreated`, `BudgetExceeded`, `BudgetPeriodClosed`
- [x] 7.7 Implementar `src/financeiro/domain/budget-service.ts` — resolve as categorias descendentes via `CategoryHierarchy` e orquestra `evaluate()`
- [x] 7.8 Escrever `budget.test.ts` cobrindo os cenários de `specs/orcamentos/spec.md` (progresso, rollup de subcategoria, alerta único, rearme, período fechado)

## 8. Orçamentos — Infraestrutura e Integração

- [x] 8.1 Criar `budget-repository.ts` — interface com `create`, `findById`, `findByCompanyAndPeriod`, `findActiveByCategory`, `findPeriodsToClose(date)`, `update`, `actualAmount(budget)`
- [x] 8.2 Implementar `knex-budget-repository.ts`, com `actualAmount` somando `net_amount` das despesas confirmadas da categoria e descendentes no período
- [x] 8.3 Implementar handler no `DomainEventBus` assinando `TransactionPosted`, `TransactionRefunded` e `TransactionCancelled` para reavaliar os orçamentos ativos da categoria afetada
- [x] 8.4 Bloquear a criação de orçamento duplicado para a mesma categoria com período sobreposto

## 9. Metas — Domínio e Infraestrutura

- [x] 9.1 Implementar `src/financeiro/domain/goal.ts` — aggregate root `Goal` com `GoalStatus` (CREATED/IN_PROGRESS/ACHIEVED/CANCELLED); `Goal.create()` validando valor alvo > 0, prazo futuro e conta ativa da mesma empresa; levanta `GoalCreated`
- [x] 9.2 Implementar `Goal.contribute(amount, date)` — valida valor > 0, moeda igual à da meta e teto `currentAmount <= targetAmount`; transiciona CREATED → IN_PROGRESS e levanta `ContributionMade`
- [x] 9.3 Implementar a transição para ACHIEVED ao atingir o alvo, com `GoalAchieved`; bloquear qualquer transição a partir de ACHIEVED/CANCELLED
- [x] 9.4 Implementar `Goal.cancel()` e `Goal.edit()` (nome, valor alvo, prazo) apenas para metas não alcançadas nem canceladas
- [x] 9.5 Implementar `Goal.progress(): Percent` e a entidade filha `GoalContribution`
- [x] 9.6 Implementar `src/financeiro/domain/goal-events.ts` — `GoalCreated`, `ContributionMade`, `GoalAchieved`
- [x] 9.7 Criar `goal-repository.ts` e `knex-goal-repository.ts` (`create`, `findById`, `findByCompany`, `update`, `addContribution`, `findContributions`), com filtro por `companyId`
- [x] 9.8 Escrever `goal.test.ts` cobrindo os cenários de `specs/metas/spec.md`

## 10. Dashboard e Relatórios — Camada de Leitura

- [x] 10.1 Criar `src/financeiro/infrastructure/reporting-repository.ts` — interface e DTOs planos (`PeriodIndicators`, `CategoryBreakdownRow`, `MonthlySeriesRow`, `CashFlowRow`, `IncomeStatementRow`, `SpendingRow`)
- [x] 10.2 Implementar em `knex-reporting-repository.ts` os indicadores do período: receita, despesa, resultado e patrimônio líquido, excluindo canceladas e estornadas
- [x] 10.3 Implementar gastos por categoria com rollup de subcategorias e percentual sobre o total
- [x] 10.4 Implementar a série de evolução mensal de 12 meses, preenchendo com zero os meses sem movimento
- [x] 10.5 Implementar os resumos de Fase 2: orçamentos (quantidade, planejado, realizado, excedidos), metas (ativas, alvo, atual, progresso) e cartões (limite, disponível, fatura em aberto, próximo vencimento)
- [x] 10.6 Implementar o relatório de Fluxo de Caixa (entradas, saídas, resultado e saldo acumulado por mês, mais os totais)
- [x] 10.7 Implementar o relatório de DRE Simplificada (receitas e despesas agrupadas por categoria e resultado)
- [x] 10.8 Implementar os relatórios de gastos por categoria, por cartão e por conta
- [x] 10.9 Aplicar o filtro por conta e o escopo por `companyId` em todas as consultas de leitura
- [x] 10.10 Escrever testes de integração das queries de agregação cobrindo os cenários de `specs/dashboard/spec.md` e `specs/relatorios/spec.md`

## 11. API — DTOs e Controllers

- [x] 11.1 Estender `src/financeiro/api/dtos.ts` com `validateCreateCardRequest`, `validateEditCardRequest`, `validateInvoicePaymentRequest`, `validateCreateBudgetRequest`, `validateEditBudgetRequest`, `validateCreateGoalRequest`, `validateEditGoalRequest`, `validateContributionRequest`, `validateDashboardQuery` e `validateReportQuery`, retornando `ApiResult<T>`
- [x] 11.2 Implementar `card-controller.ts` — create, list, detail (com limite disponível), edit, deactivate
- [x] 11.3 Implementar `invoice-controller.ts` — listar faturas do cartão, detalhar fatura com compras e pagamentos, fechar manualmente, registrar pagamento
- [x] 11.4 Implementar `budget-controller.ts` — create, list por período com progresso, detail, edit, deactivate
- [x] 11.5 Implementar `goal-controller.ts` — create, list, detail com histórico de contribuições, edit, contribute, cancel
- [x] 11.6 Implementar `dashboard-controller.ts` — indicadores, gastos por categoria, evolução mensal e resumos de Fase 2, com filtros de período e conta e agregações em `Promise.all`
- [x] 11.7 Implementar `report-controller.ts` — despacho por tipo de relatório e validação de período
- [x] 11.8 Implementar `src/financeiro/api/csv.ts` — serialização RFC 4180 com escape de aspas, vírgulas e quebras de linha, e o endpoint de exportação respondendo `text/csv` com `Content-Disposition`

## 12. Rotas e Composition Root

- [x] 12.1 Criar em `src/routes/finance-routes.ts` as factories `createCardRoutes`, `createInvoiceRoutes`, `createBudgetRoutes`, `createGoalRoutes`, `createDashboardRoutes` e `createReportRoutes`, todas com o hook `authenticate` e `getCompanyId(request)`
- [x] 12.2 Estender `FinanceRoutesDependencies` e `RouteDependencies` com os novos controllers
- [x] 12.3 Registrar os novos plugins em `registerRoutes()` sob `/api/v1` nos prefixos definidos no design
- [x] 12.4 Instanciar em `AppServer.build()` os novos repositórios, serviços de domínio e controllers, e assinar o handler de orçamento no `DomainEventBus`

## 13. Scheduler

- [x] 13.1 Adicionar a passada de fechamento de fatura — varre as faturas com `closing_date` alcançada, fecha cada uma em sua própria transação de banco e segue o lote em caso de erro
- [x] 13.2 Adicionar a passada de fatura atrasada — marca como OVERDUE as faturas vencidas com saldo em aberto e publica `InvoiceOverdue`
- [x] 13.3 Adicionar a passada de encerramento de período de orçamento — fecha os períodos terminados e publica `BudgetPeriodClosed`
- [x] 13.4 Registrar os novos eventos nos handlers de auditoria e verificar que rodar o scheduler duas vezes no mesmo dia não duplica efeito nem evento

## 14. Fechamento

- [x] 14.1 Exportar as novas entidades, VOs, eventos e serviços em `src/financeiro/domain/index.ts`
- [x] 14.2 Rodar `npm run typecheck` e `npm test` com tudo verde
- [x] 14.3 Conferir cada cenário das 8 specs da mudança contra o código, incluindo os deltas de `contas-financeiras` e `transacoes`
- [x] 14.4 Validar os RNFs de performance com dados de volume (dashboard < 3s para 10.000 transações; relatório de 12 meses < 10s) e ajustar índices se necessário
