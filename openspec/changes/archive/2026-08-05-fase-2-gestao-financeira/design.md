## Context

A Fase 1 está implementada e arquivada. O projeto já tem: `shared/domain` (Entity, AggregateRoot, ValueObject, Result, DomainError, DomainEventBus), o contexto `financeiro/` com `Account` (aggregate root), `Category`, `Transaction`, `Installment`, `Recurrence`, `Wallet` e os VOs `Money`, `Period`, `Percent`, `ExchangeRate`, `Currency`; repositórios Knex com filtro obrigatório por `companyId`; controllers retornando `ControllerResult`; rotas Fastify por contexto sob `/api/v1`; auditoria consumindo eventos do bus; e um `src/scheduler.ts` batch que hoje gera recorrências e marca parcelas atrasadas.

> Motivação e escopo: ver `proposal.md`. Requisitos observáveis: ver `specs/`.

**Restrições que moldam o desenho:**
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `nodenext` com extensão `.js` nos imports relativos
- Sem ORM, sem Zod, sem container de DI — Knex direto, validação manual em `api/dtos.ts`, composition root manual em `AppServer.build()`
- Nenhuma dependência externa nova sem aprovação — e esta fase não pede nenhuma
- `Result<T>` no domínio; `throw` só em boundary de infraestrutura
- Multi-tenancy é invariante de repositório (`BaseRepository.companyId`)
- Test runner: `node --test` via `tsx` (`npm test`), padrão já usado em `*.test.ts` no contexto financeiro

## Goals / Non-Goals

**Goals:**
- Fatura como agregado próprio, com a obrigação de pagamento distinta das compras (RN-08), sem duplicar o valor no saldo da conta
- Limite disponível do cartão e progresso de orçamento **derivados**, nunca campos editáveis — mesma disciplina do saldo derivado (RN-02)
- Fechamento de fatura e encerramento de período de orçamento idempotentes, para que o scheduler possa rodar mais de uma vez no mesmo dia sem efeito duplicado
- Dashboard e relatórios como consultas de leitura agregadas em SQL, fora do domínio, sem carregar entidades
- Reuso das primitivas existentes (`Money`, `Period`, `Percent`, `AggregateRoot`, `DomainEventBus`) — nenhum conceito novo de infraestrutura

**Non-Goals:**
- Cache ou materialização de agregados de dashboard/relatório — índices + queries diretas nesta fase
- Exportação PDF/Excel — só CSV (PDF/Excel exigiriam dependência externa)
- Fatura parcelada / rotativo do cartão com juros — a fatura desta fase aceita pagamento total ou parcial, sem encargos calculados
- Orçamento por centro de custo — Centro de Custo é entidade da Fase 3; o orçamento nasce por categoria com o campo de dimensão preparado
- Notificações e versionamento de entidades — ver "Fora de escopo" na proposal

## Decisions

### 1. `Card` como entidade filha do agregado `Account`, com repositório próprio

**Decisão:** `Card` é entidade (não aggregate root) pertencente ao agregado `Conta`, conforme o modelo conceitual. Na prática: `Card` carrega `accountId`, sua criação valida a conta pelo `AccountRepository`, e existe um `CardRepository` próprio para leitura/escrita — o agregado `Account` não carrega a coleção de cartões em memória.

**Racional:** carregar todos os cartões junto com a conta em toda operação de transação seria caro e desnecessário; a invariante que realmente importa ("cartão só existe vinculado a uma conta ativa da mesma empresa") é verificável no ponto de criação e de uso. É o mesmo compromisso já adotado em Fase 1 com `Installment`, que tem repositório próprio apesar de pertencer ao agregado `Transaction`.

**Alternativa considerada:** `Card` como aggregate root independente. Rejeitada por contrariar o modelo conceitual e por soltar a invariante de vínculo com a conta.

### 2. Limite disponível derivado, calculado no repositório

**Decisão:** `Card` não persiste `available_limit`. O `CardRepository` expõe `committedAmount(cardId)` — soma das compras confirmadas não faturadas mais o saldo em aberto das faturas não pagas — e o domínio calcula `availableLimit = limit - committed` em `Card.availableLimit(committed)`.

**Racional:** exatamente o raciocínio da RN-02 aplicado ao cartão. Um campo persistido viraria uma segunda fonte de verdade a reconciliar. A soma é uma query indexada por `card_id`.

**Trade-off:** uma query extra por leitura de cartão. Aceitável no volume desta fase; se virar gargalo, entra um cache reconciliável como o `balance` da conta já faz.

### 3. Ciclo de fatura derivado do dia de fechamento, com datas materializadas na fatura

**Decisão:** o cálculo do ciclo vive em um módulo puro `invoice-cycle.ts` (funções `closingDateFor(date, closingDay)` e `dueDateFor(closingDate, dueDay)`), reaproveitando `daysInMonth`/`addMonths` de `date-math.ts` para meses curtos (dia 31 em fevereiro → último dia do mês). Cada `Invoice` persiste `cycle_start`, `closing_date` e `due_date` no momento em que é aberta.

**Racional:** materializar as datas torna a fatura imune a mudanças posteriores no `closing_day` do cartão — que é exatamente o requisito "mudança de fechamento vale a partir do próximo ciclo". Manter o cálculo em funções puras o torna testável sem banco.

### 4. Compra em cartão de crédito não movimenta a conta

**Decisão:** `Transaction` ganha `cardId?` e `invoiceId?`. Quando `cardId` aponta para um cartão CREDIT, confirmar a transação **não** chama `Account.debit()` — o débito acontece uma única vez, no pagamento da fatura, via uma transação de despesa gerada pelo pagamento. Cartão DEBIT segue o caminho normal de despesa.

**Racional:** é o que a RN-08 exige — a obrigação é a fatura, não cada compra. Debitar na compra **e** no pagamento contaria o gasto duas vezes no saldo.

**Consequência declarada:** as compras de cartão de crédito continuam entrando nos relatórios de despesa por categoria (elas são o gasto real), mas não no fluxo de caixa da conta até o pagamento da fatura. O relatório de Fluxo de Caixa é, por definição, caixa; o de Gastos por Categoria é competência. Essa diferença é intencional e está refletida nas specs.

**Alternativa considerada:** modelar o cartão como uma conta de passivo, com a compra debitando essa conta e o pagamento sendo uma transferência conta → cartão. É mais "contábil" e elegante, mas quebraria a spec de contas (saldo de conta é dinheiro disponível), exigiria distinguir tipos de conta em todo o dashboard e mudaria o cálculo de patrimônio líquido. Rejeitada pelo custo de propagação.

### 5. Máquina de estados da fatura no agregado, pagamento como serviço

**Decisão:** `Invoice` é aggregate root e concentra as transições (`close()`, `registerPayment()`, `markOverdue()`), retornando `Result<Invoice>` e acumulando eventos via `raiseEvent()`. A orquestração que envolve outros agregados — debitar a conta, criar a transação de pagamento, persistir tudo — fica em `InvoicePaymentService`, no mesmo padrão de `TransferService`. O fechamento fica em `InvoiceClosingService` (o `FechamentoFaturaService` do modelo conceitual).

**Racional:** consistente com a Fase 1, onde a transição vive na entidade e a coordenação entre agregados vive em serviço de domínio.

### 6. Fechamento e vencimento são idempotentes por natureza do estado

**Decisão:** `close()` só é aceito a partir de `OPEN`; `markOverdue()` só a partir de `CLOSED`/`PARTIALLY_PAID` e com vencimento passado. O scheduler simplesmente varre e chama — chamadas repetidas retornam falha de operação inválida, que o scheduler ignora sem publicar evento.

**Racional:** a idempotência sai da própria máquina de estados, sem tabela de controle de execução do job.

### 7. Progresso de orçamento derivado por query, com flag de alerta persistida

**Decisão:** `Budget` persiste `planned_amount`, o período, a categoria e um booleano `exceeded_notified`. O valor gasto vem de `BudgetRepository.actualAmount(budget)` — soma dos `net_amount` das transações de despesa confirmadas da categoria e suas descendentes no período. `BudgetService.evaluate()` compara e decide se publica `BudgetExceeded`, alternando `exceeded_notified`.

**Racional:** o gasto é derivado (mesma disciplina do saldo e do limite); só o *fato de já ter alertado* precisa ser persistido, porque é o que evita o alerta repetido a cada nova transação. A descida na hierarquia de categorias reusa `CategoryHierarchy`, já existente.

**Alternativa considerada:** contador incremental atualizado por handler de `TransactionPosted`. Rejeitada por criar um valor não reconciliável e por complicar estorno e edição de transação.

### 8. Avaliação de orçamento acionada por evento

**Decisão:** um handler assinando `TransactionPosted`, `TransactionRefunded` e `TransactionCancelled` no `DomainEventBus` chama `BudgetService.evaluate()` para os orçamentos ativos da categoria afetada.

**Racional:** mantém o registro de transação alheio a orçamento — a categoria classifica, não altera comportamento (RN-06) — e é o mesmo mecanismo que a auditoria já usa.

### 9. `Goal` como aggregate root com contribuições como entidades filhas

**Decisão:** `Goal` (aggregate root) + `GoalContribution` (entidade filha, tabela `goal_contributions`). `Goal.contribute()` valida moeda, valor positivo e o teto `currentAmount <= targetAmount`, transiciona o estado e levanta `ContributionMade` / `GoalAchieved`.

**Racional:** a contribuição não tem vida própria fora da meta — ao contrário da parcela, ela não é paga nem vence individualmente. `current_amount` é cache reconciliável pela soma das contribuições, como o saldo da conta.

### 10. Dashboard e relatórios são camada de leitura, não domínio

**Decisão:** `financeiro/infrastructure/knex-reporting-repository.ts` expõe métodos de agregação que retornam DTOs planos (`PeriodIndicators`, `CategoryBreakdownRow`, `MonthlySeriesRow`, `CashFlowRow`, ...). Controllers de dashboard e relatórios consomem esses DTOs diretamente. Nenhuma entidade de domínio é hidratada; nenhuma regra de negócio nova vive aí.

**Racional:** carregar 10.000 transações em memória para somar viola o RNF-PERF-002 na primeira empresa real. Agregação é trabalho do banco. É um CQRS leve — leitura separada da escrita — sem introduzir infraestrutura de CQRS.

**Trade-off:** as regras de "o que conta como despesa" (status confirmado, exclusão de estornos, rollup de subcategoria) passam a existir também em SQL. Mitigação: essas queries ficam concentradas em um único arquivo, com testes de integração cobrindo os casos das specs.

### 11. CSV serializado à mão

**Decisão:** um `csv.ts` em `financeiro/api/` converte `{ columns, rows }` em texto CSV, com escape de aspas, vírgulas e quebras de linha (RFC 4180). O endpoint responde `text/csv` com `Content-Disposition: attachment`.

**Racional:** evita dependência externa para ~30 linhas de código, alinhado com a política do projeto. PDF/Excel exigiriam biblioteca e ficam fora.

### 12. Schema: uma migration nova, nenhuma existente editada

**Decisão:** `20240101000006_create_phase2_tables.ts`, criando:

- `cards` — `id`, `company_id`, `account_id`, `name`, `type`, `brand`, `bank`, `credit_limit(15,2)`, `closing_day`, `due_day`, `is_active`, timestamps
- `invoices` — `id`, `company_id`, `card_id`, `cycle_start`, `closing_date`, `due_date`, `status`, `total_amount(15,2)`, `paid_amount(15,2)`, `currency`, `closed_at`, `closed_by`, timestamps; índice único parcial garantindo **uma** fatura por (`card_id`, `closing_date`)
- `invoice_payments` — `id`, `invoice_id`, `transaction_id`, `account_id`, `amount(15,2)`, `paid_at`
- `budgets` — `id`, `company_id`, `category_id`, `period_start`, `period_end`, `planned_amount(15,2)`, `currency`, `status`, `exceeded_notified`, `closed_at`, timestamps
- `goals` — `id`, `company_id`, `account_id`, `name`, `target_amount(15,2)`, `current_amount(15,2)`, `currency`, `deadline`, `status`, `achieved_at`, timestamps
- `goal_contributions` — `id`, `goal_id`, `transaction_id`, `amount(15,2)`, `contributed_at`
- `transactions`: colunas `card_id` e `invoice_id` (nullable, FK)
- Índices para as agregações: `transactions(company_id, status, date)`, `transactions(company_id, category_id, status, date)`, `transactions(card_id, invoice_id)`, `invoices(company_id, status, due_date)`

**Racional:** `decimal(15,2)` e `defaultTo(gen_random_uuid())` seguem o padrão das migrations existentes. Os índices são o que sustenta RNF-PERF-002/003 — sem eles o dashboard varre a tabela inteira.

### 13. Rotas

Novos plugins em `src/routes/finance-routes.ts`, registrados em `registerRoutes()` sob `/api/v1`:

| Prefixo | Endpoints |
|---|---|
| `/cards` | `POST /`, `GET /`, `GET /:cardId`, `PUT /:cardId`, `DELETE /:cardId` (inativa) |
| `/cards/:cardId/invoices` | `GET /`, `POST /close` |
| `/invoices` | `GET /:invoiceId`, `POST /:invoiceId/payments` |
| `/budgets` | `POST /`, `GET /`, `GET /:budgetId`, `PUT /:budgetId`, `DELETE /:budgetId` (inativa) |
| `/goals` | `POST /`, `GET /`, `GET /:goalId`, `PUT /:goalId`, `POST /:goalId/contributions`, `POST /:goalId/cancel` |
| `/dashboard` | `GET /` |
| `/reports` | `GET /:type` (`cash-flow`, `income-statement`, `by-category`, `by-card`, `by-account`), `GET /:type/export` |

Todas protegidas por `authenticate`, com `companyId` vindo de `getCompanyId(request)` — nunca do cliente.

## Risks / Trade-offs

- **Compra de cartão fora do fluxo de caixa até o pagamento** → é o comportamento correto por RN-08, mas surpreende quem espera ver a compra no extrato da conta. Mitigação: dashboard e relatório de gastos por categoria mostram a compra na competência; o resumo de cartões expõe a fatura em aberto.
- **Divergência entre a regra em SQL (relatórios) e a regra no domínio** → o filtro "confirmada e não estornada" existe nos dois lugares. Mitigação: queries concentradas em um arquivo, testes de integração derivados dos cenários das specs.
- **Performance do dashboard com muitos indicadores** → são várias agregações por request. Mitigação: índices dedicados na migration e execução das agregações em paralelo (`Promise.all`); se não bastar, materialização entra em mudança posterior, sem alterar o contrato da API.
- **Fechamento de fatura no scheduler pode falhar no meio de um lote** → uma fatura falha, as demais devem seguir. Mitigação: cada fatura é processada em sua própria transação de banco, com erro logado e o lote continuando — mesmo padrão já usado no loop de recorrências.
- **Dia de fechamento 29/30/31** → meses curtos. Mitigação: normalização para o último dia do mês em `invoice-cycle.ts`, com testes específicos para fevereiro.
- **Limite disponível calculado sob concorrência** → duas compras simultâneas podem ambas passar na checagem de limite. Mitigação: a validação de limite roda dentro da transação de banco que insere a compra, com `SELECT ... FOR UPDATE` na linha do cartão. Estouro de limite é aceitável de qualquer modo — o mundo real permite —, então não vale um lock global.

## Migration Plan

1. Aplicar `npm run db:migrate` — a migration é puramente aditiva (tabelas novas + colunas nullable), sem backfill e sem downtime.
2. Deploy da API: as rotas novas não alteram nenhum contrato existente; clientes da Fase 1 seguem funcionando.
3. Atualizar o cron do `scheduler` — as três novas passadas rodam no mesmo binário já agendado, sem mudança de agendamento.
4. **Rollback:** `npm run db:migrate:rollback` reverte o batch (drop das 6 tabelas novas e das 2 colunas). Como nenhum dado da Fase 1 é alterado ou migrado, o rollback é seguro; perde-se apenas o que foi criado na Fase 2.

## Open Questions

- **Fuso horário do fechamento de fatura:** o scheduler compara datas em UTC (como já faz para parcelas). Para um usuário em UTC-3, uma compra tarde da noite do dia do fechamento pode cair no ciclo seguinte. Resolver quando houver preferência de fuso por empresa; não muda specs nem estrutura de tarefas.
- **Limite de tamanho da exportação CSV:** hoje o relatório inteiro é serializado em memória. Definir um teto (ou streaming) quando aparecer volume real.
