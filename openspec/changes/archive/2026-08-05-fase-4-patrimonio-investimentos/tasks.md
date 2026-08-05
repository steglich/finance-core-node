## 1. Primitivas e Banco de Dados

- [x] 1.1 Adicionar em `DomainErrorCode` os códigos ainda inexistentes para as novas regras (conferir antes de usar; não criar código redundante)
- [x] 1.2 Criar migration `20240101000008_create_phase4_tables.ts` com `investments` (id, company_id, account_id, name, investment_type, symbol, currency, expense_category_id, income_category_id, status, closed_at, timestamps) e índice (`company_id`, `status`)
- [x] 1.3 Adicionar `investment_operations` (com `transaction_id`, `quantity decimal(20,8)`, `unit_price decimal(20,8)`, `fees`, `amount`, `operated_at`) e índice (`investment_id`, `operated_at`)
- [x] 1.4 Adicionar `investment_quotes` (investment_id, quote_date, unit_price decimal(20,8), source) com único em (`investment_id`, `quote_date`)
- [x] 1.5 Adicionar `loans` e `loan_installments` conforme a decisão 14 do design, com único em (`loan_id`, `number`) e índice (`company_id`, `status`, `due_date`)
- [x] 1.6 Adicionar `loan_payments` (payment_type INSTALLMENT | EXTRA_AMORTIZATION, transaction_id, amount, principal_amount, paid_at)
- [x] 1.7 Adicionar `exchange_rates` (company_id, source_currency, target_currency, `rate decimal(18,8)`, rate_date, source) com único em (`company_id`, `source_currency`, `target_currency`, `rate_date`)
- [x] 1.8 Adicionar as colunas nullable `investment_operation_id` e `loan_installment_id` em `transactions`, com FKs, e garantir o índice `transactions(company_id, account_id, status, date)` exigido pela reconstrução de saldo a uma data
- [x] 1.9 Implementar o `down()` revertendo colunas, índices e tabelas na ordem inversa; validar `npm run db:migrate` e `npm run db:migrate:rollback`
- [x] 1.10 Adicionar a categoria de **despesa** "Investimentos" em `src/seeds/02_default_categories.ts` (hoje só existe a de receita)

## 2. Câmbio

- [x] 2.1 Criar `src/financeiro/infrastructure/exchange-rate-repository.ts` (interface) com `upsert`, `findForDate(source, target, date)`, `findByCompany` (filtros de par e intervalo)
- [x] 2.2 Implementar `knex-exchange-rate-repository.ts` com filtro obrigatório por `companyId` e `onConflict().merge()` no registro da mesma data
- [x] 2.3 Implementar `src/financeiro/domain/exchange-service.ts` — `rateFor(source, target, date)` com a taxa mais recente `≤ date`, fallback para o par inverso (`1/rate`), fator 1 para a mesma moeda e `Result.failed` com par e data quando não há taxa (design, decisão 9)
- [x] 2.4 Implementar `convert(money, targetCurrency, date)` devolvendo `{ amount, originalAmount, originalCurrency, rate, rateDate }`, arredondando a centavos por `Money`
- [x] 2.5 Implementar `src/financeiro/domain/exchange-rate-events.ts` — `ExchangeRateRegistered`
- [x] 2.6 Escrever `exchange-service.test.ts` cobrindo os cenários de `specs/cambio/spec.md` (taxa da data do fato, par inverso, ausência de taxa, mesma moeda, substituição da taxa de uma data)

## 3. Investimentos — Domínio

- [x] 3.1 Implementar `src/financeiro/domain/investment.ts` — aggregate root `Investment` com `InvestmentType` (STOCK/REIT/TREASURY/CD/CRYPTO/ETF/FUND/PENSION), `InvestmentStatus` (ACTIVE/CLOSED) e `Investment.create()` validando tipo, conta ativa da mesma empresa, moeda igual à da conta e categorias de tipo compatível
- [x] 3.2 Implementar `Investment.edit()` (nome, símbolo, categorias) e `Investment.close(positionQuantity)` — só permitido com posição zero; moeda, tipo e conta imutáveis
- [x] 3.3 Implementar `src/financeiro/domain/investment-operation.ts` — entidade `InvestmentOperation` com `OperationType` (BUY/SELL/DIVIDEND/INTEREST/AMORTIZATION), validando data não futura, valor > 0 e quantidade/preço unitário > 0 em BUY e SELL
- [x] 3.4 Implementar `src/financeiro/domain/investment-position.ts` — módulo puro que recebe as operações ordenadas e devolve `{ quantity, averageCost, investedAmount, realizedResult, incomeReceived }`, com custo médio (não FIFO) e venda maior que a posição rejeitada
- [x] 3.5 Implementar o cálculo de valor atual e rentabilidade — `(valor atual + realizado + proventos − investido) ÷ investido`, com rentabilidade zero quando o investido é zero e fallback para o custo quando não há cotação, sinalizado por `quoted: false`
- [x] 3.6 Implementar `src/financeiro/domain/investment-events.ts` — `InvestmentCreated`, `InvestmentOperationRegistered`, `InvestmentClosed`
- [x] 3.7 Escrever `investment-position.test.ts` cobrindo os cenários numéricos de `specs/investimentos/spec.md` (100 PETR4 a R$ 32,50 → R$ 3.250; custo médio após duas compras; venda parcial com resultado realizado; venda maior que a posição; rentabilidade +15%; rentabilidade com dividendos)
- [x] 3.8 Escrever `investment.test.ts` cobrindo criação inválida (tipo, conta de outra empresa, conta inativa, moeda divergente), operação em investimento fechado e fechamento com posição aberta

## 4. Investimentos — Liquidação e Infraestrutura

- [x] 4.1 Implementar `src/financeiro/domain/investment-operation-service.ts` como **serviço puro**, na assinatura de `ChargeReceiptService` — recebe `{ investment, operations, account, input }`, valida, constrói a transação confirmada (despesa em BUY, receita nas demais) com a categoria correta e devolve `{ operation, payment, events }`; não recebe repositório e não abre transação de banco
- [x] 4.2 Criar `investment-repository.ts` (interface) com `create`, `findById`, `findByIdForUpdate`, `findByCompany`, `update`, `listOperations`, `createOperation`, `positionSummary`, `portfolio(referenceDate)`
- [x] 4.3 Implementar `knex-investment-repository.ts` com filtro obrigatório por `companyId`; `findByIdForUpdate` emite `select … for update` (design, decisão 4) e `portfolio()` agrega em SQL sem hidratar operações
- [x] 4.4 Criar `investment-quote-repository.ts` (interface) e `knex-investment-quote-repository.ts` com upsert por (`investment_id`, `quote_date`) e busca da cotação mais recente `≤` data de referência
- [x] 4.5 Escrever `investment-operation-service.test.ts` sem banco (como `invoice-services.test.ts`), cobrindo compra, venda, dividendos, conta inativa, moeda divergente e saldo insuficiente

## 5. Investimentos — API e Rotas

- [x] 5.1 Implementar `src/financeiro/api/investment-controller.ts` (registrar, listar, consultar, editar, fechar); o registro de operação faz `transactionRepository.runAtomic()` com `findByIdForUpdate` → recálculo da posição → `create(payment)` → `applyMovement` → `createOperation()`
- [x] 5.2 Implementar o endpoint de portfólio (`GET /investments/portfolio`) com posição, valor atual, resultado e distribuição por tipo, incluindo a flag `quoted`
- [x] 5.3 Implementar os endpoints de cotação (registrar e listar) com validação de preço > 0
- [x] 5.4 Implementar a validação manual em `src/financeiro/api/dtos.ts` — `validateCreateInvestmentRequest`, `validateUpdateInvestmentRequest`, `validateInvestmentOperationRequest`, `validateInvestmentQuoteRequest`
- [x] 5.5 Criar `src/routes/investment-routes.ts` (design, decisão 15), registrá-lo em `registerRoutes()` e instanciar tudo em `AppServer.build()`

## 6. Empréstimos — Domínio

- [x] 6.1 Implementar `src/financeiro/domain/loan-math.ts` — `buildSchedule()` com `interest_i = round(saldo × taxa)`, `principal_i = parcela − interest_i` e a última parcela absorvendo o arredondamento (design, decisão 6), reusando `date-math.ts` para os vencimentos mensais
- [x] 6.2 Escrever `loan-math.test.ts` cobrindo o caso do backlog (R$ 10.000, 24×, R$ 520, 1,5% a.m.), empréstimo sem juros, soma dos principais igual ao contratado ao centavo e vencimento em fim de mês (31 → fevereiro)
- [x] 6.3 Implementar `src/financeiro/domain/loan.ts` — aggregate root `Loan` com `LoanStatus` (CONTRACTED/IN_PROGRESS/DELINQUENT/SETTLED) e `Loan.contract()` validando principal > 0, taxa entre 0 e 100, parcelas > 0 e `parcelas × valor ≥ principal`
- [x] 6.4 Implementar as transições `Loan.start()`, `Loan.markDelinquent()`, `Loan.regularize()` e `Loan.settle()` conforme a máquina de estados de `specs/emprestimos/spec.md`, incluindo as proibidas (sair de SETTLED, ir de CONTRACTED direto a SETTLED)
- [x] 6.5 Implementar `src/financeiro/domain/loan-installment.ts` — entidade com `number`, vencimento, valor, porções de juros e principal, `InstallmentStatus` (PENDING/OVERDUE/PAID), `markOverdue(referenceDate)` e `registerPayment(amount, paidAt)`
- [x] 6.6 Implementar o cálculo derivado do saldo devedor (`principal − Σ principal pago − Σ amortizações`), parcelas restantes e juros pagos
- [x] 6.7 Implementar `src/financeiro/domain/loan-events.ts` — `LoanCreated`, `LoanSettled`, `LoanPaymentMissed` com o payload já catalogado em `docs/docs/eventos-dominio.md`
- [x] 6.8 Escrever `loan.test.ts` cobrindo a máquina de estados, o saldo após pagar a 5ª parcela (19 restantes) e as transições proibidas

## 7. Empréstimos — Liquidação e Infraestrutura

- [x] 7.1 Implementar `src/financeiro/domain/loan-payment-service.ts` como **serviço puro** — recebe `{ loan, installment, account, amount, paidAt }`, valida empresa, conta ativa, moeda, saldo e valor, constrói a transação de despesa confirmada, transiciona parcela e empréstimo (incluindo regularização) e devolve as peças
- [x] 7.2 Implementar `src/financeiro/domain/loan-amortization-service.ts` — valida valor ≤ saldo devedor, quita as parcelas pendentes a partir da última, reduz o principal da última pendente com o resto e quita o empréstimo quando cobre todo o saldo
- [x] 7.3 Criar `loan-repository.ts` (interface) com `create` (empréstimo + cronograma), `findById`, `findByIdForUpdate`, `findByCompany` (filtros de status e credor), `update`, `outstandingBalance`, `registerPayment`
- [x] 7.4 Implementar `knex-loan-repository.ts` e `knex-loan-installment-repository.ts` com filtro obrigatório por `companyId`; o `update()` da parcela emite `UPDATE … WHERE id = ? AND company_id = ? AND status IN ('PENDING','OVERDUE')` exigindo `rowCount === 1` (design, decisão 7), e `findOverdueCandidates(date)` para o scheduler
- [x] 7.5 Escrever `loan-services.test.ts` sem banco, cobrindo pagamento no prazo, pagamento que quita o empréstimo, pagamento que regulariza, amortização extra (R$ 8.000 − R$ 2.000 = R$ 6.000), amortização maior que o saldo, conta inativa, moeda divergente e saldo insuficiente

## 8. Empréstimos — API e Rotas

- [x] 8.1 Implementar `src/financeiro/api/loan-controller.ts` (contratar, listar, consultar com cronograma, editar); a contratação grava empréstimo e parcelas no mesmo `runAtomic`
- [x] 8.2 Implementar o pagamento de parcela e a amortização extra no controller, com `runAtomic` fazendo `create(payment)` → `applyMovement(DEBIT)` → `update` guardado da parcela → `update` do empréstimo → `registerPayment`
- [x] 8.3 Implementar a validação manual em `dtos.ts` — `validateContractLoanRequest`, `validateUpdateLoanRequest`, `validateLoanPaymentRequest` (com `paidAt` obrigatório), `validateAmortizationRequest`
- [x] 8.4 Criar `src/routes/loan-routes.ts`, registrá-lo em `registerRoutes()` e instanciar tudo em `AppServer.build()`

## 9. Integração com Transações

- [x] 9.1 Estender `Transaction` com `investmentOperationId?` e `loanInstallmentId?` em `TransactionProps`, `CreateTransactionInput` e `toJSON()`, e persistir/ler as colunas em `knex-transaction-repository.ts`
- [x] 9.2 Bloquear no `transaction-controller` a edição e o cancelamento/estorno de transações originadas de operação de investimento ou de pagamento de empréstimo, lendo as próprias colunas (design, decisão 10)
- [x] 9.3 Rejeitar requisições em que o cliente informa `investmentOperationId` ou `loanInstallmentId` diretamente
- [x] 9.4 Garantir a exigência de taxa de câmbio quando a moeda da transação difere da moeda da conta, com armazenamento do valor original, da taxa e do convertido, e imutabilidade da taxa (`specs/transacoes/spec.md`)
- [x] 9.5 Escrever/atualizar testes cobrindo os cenários novos de `specs/transacoes/spec.md`, incluindo a compra de $50 com cotação 5,20 → R$ 260,00

## 10. Patrimônio e Consolidação

- [x] 10.1 Criar `net-worth-repository.ts` (interface) e implementar `knex-net-worth-repository.ts` — `netWorthAt(companyId, referenceDate)` devolvendo os componentes `{ component, currency, amount }` (saldos de contas ativas, carteira, recebíveis em aberto, saldo devedor de empréstimos, faturas em aberto, contas a pagar em aberto)
- [x] 10.2 Implementar a reconstrução do saldo de conta a uma data passada (`sum` das entradas confirmadas com `date <= referenceDate`), não a partir do saldo atual
- [x] 10.3 Implementar a conversão dos componentes para a moeda de exibição em TypeScript, pelo `ExchangeService`, reportando par e data faltantes quando não há taxa (design, decisão 11)
- [x] 10.4 Implementar `netWorthEvolution(companyId, period)` com um ponto por fim de mês
- [x] 10.5 Implementar `knex-cross-company-repository.ts` — `netWorthByCompany(userId, referenceDate, displayCurrency)` resolvendo as empresas por `company_users`, **fora** de `BaseRepository` e recebendo `userId`, nunca uma lista do cliente (design, decisão 12)
- [x] 10.6 Implementar `src/financeiro/api/net-worth-controller.ts` e `exchange-rate-controller.ts`, com os DTOs correspondentes
- [x] 10.7 Criar `src/routes/net-worth-routes.ts` com `/net-worth`, `/net-worth/evolution`, `/net-worth/consolidated` e `/exchange-rates`, registrá-lo em `registerRoutes()` e instanciar tudo em `AppServer.build()`
- [x] 10.8 Escrever testes cobrindo os cenários de `specs/patrimonio/spec.md`, incluindo a consolidação das três empresas (R$ 50.000 + R$ 30.000 + R$ 20.000 = R$ 100.000), a conta inativa excluída, a data de referência passada e a taxa faltante

## 11. Scheduler

- [x] 11.1 Adicionar a passada de parcelas de empréstimo vencidas em `src/scheduler.ts` — varre `findOverdueCandidates`, marca a parcela como vencida, transiciona o empréstimo para Inadimplente, persiste pelo `update()` guardado por status e publica `LoanPaymentMissed`, com `try/catch` por registro
- [x] 11.2 Incluir `overdueLoanInstallments` no log final da passada e atualizar o comentário de cabeçalho do arquivo
- [x] 11.3 Escrever teste cobrindo a idempotência (segunda execução no mesmo dia não transiciona nem publica de novo) e que empréstimos quitados são ignorados

## 12. Dashboard e Relatórios

- [x] 12.1 Estender `knex-reporting-repository.ts` com `investmentsSummary()` e `debtSummary()` para o dashboard
- [x] 12.2 Reescrever o `netWorth` do `dashboard-controller` para ativos − passivos, usando o `net-worth-repository`, mantendo o filtro de contas e ignorando o filtro de centro de custo (`specs/dashboard/spec.md`)
- [x] 12.3 Adicionar o parâmetro `displayCurrency` ao dashboard e aos relatórios, com padrão na moeda da empresa
- [x] 12.4 Implementar o relatório `net-worth` (componentes, subtotais e evolução mensal quando o período cobre mais de um mês)
- [x] 12.5 Implementar o relatório `investments` (posição, valor atual, resultados, rentabilidade, distribuição por tipo, filtro por tipo, flag de ausência de cotação)
- [x] 12.6 Implementar o relatório `income-tax` (posições em 31/12 do ano e do anterior, proventos por investimento e por tipo, resultados realizados, saldos de contas e saldo devedor de empréstimos), rejeitando período que não seja um ano civil e sem apurar imposto
- [x] 12.7 Garantir a exportação CSV dos três relatórios novos, com blocos de cabeçalho por seção nos relatórios multi-seção
- [x] 12.8 Escrever testes de relatório e de dashboard cobrindo os cenários novos de `specs/relatorios/spec.md` e `specs/dashboard/spec.md`, incluindo o patrimônio com contas em duas moedas

## 13. Auditoria e Fechamento

- [x] 13.1 Registrar os eventos novos (`InvestmentCreated`, `InvestmentOperationRegistered`, `InvestmentClosed`, `LoanCreated`, `LoanSettled`, `LoanPaymentMissed`, `ExchangeRateRegistered`) nos handlers de auditoria, no `AppServer` e no `scheduler`
- [x] 13.2 Garantir registro de auditoria em criação, edição, operação, pagamento e mudança de estado de investimento e empréstimo (RN-09)
- [x] 13.3 Acrescentar ao catálogo `docs/docs/eventos-dominio.md` os eventos de investimento e de câmbio, com payload, produtor e consumidores, e atualizar a tabela-resumo
- [x] 13.4 Escrever testes de API de ponta a ponta cobrindo os fluxos principais, o isolamento por empresa e as duas invariantes de concorrência: **pagamento duplo da mesma parcela** (o segundo casa zero linhas, o `runAtomic` desfaz e nenhuma segunda transação fica gravada) e **venda concorrente maior que a posição** (a linha do investimento travada impede posição negativa)
- [x] 13.5 Escrever teste de API garantindo que `/net-worth/consolidated` ignora empresa informada pelo cliente fora do vínculo do usuário
- [x] 13.6 Rodar `npm run typecheck`, `npm test` e `npm run build`; corrigir o que aparecer
- [x] 13.7 Revisar cada spec da mudança contra o implementado e ajustar o que divergir antes de arquivar
