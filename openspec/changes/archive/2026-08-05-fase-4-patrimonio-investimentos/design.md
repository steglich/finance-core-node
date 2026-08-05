## Context

As Fases 1, 2 e 3 estão implementadas e arquivadas. O projeto já tem: `shared/domain` (Entity, AggregateRoot, ValueObject, Result, DomainError, DomainEventBus, TreeHierarchy); o contexto `financeiro/` com `Account`, `Category`, `Transaction`, `Card`, `Invoice`, `Budget`, `Goal`, os VOs `Money`, `Period`, `Percent`, `Currency` e **`ExchangeRate` já pronto e usado em transferências e transações**; `cadastros/` com `Person` e `CostCenter`; `pagamentos/` com `Charge` e `Payable`; repositórios Knex com filtro obrigatório por `companyId`; controllers retornando `ControllerResult`; rotas Fastify por contexto sob `/api/v1`; auditoria consumindo eventos do bus; e um `src/scheduler.ts` batch com seis passadas.

**Padrões do código existente que este desenho segue à risca** (verificados em `invoice-payment-service.ts`, `charge-receipt-service.ts`, `charge-controller.ts`, `knex-charge-repository.ts` e `knex-card-repository.ts`):
- **Serviços de domínio são puros.** Recebem agregados já hidratados, validam, transicionam e **devolvem as peças** (`{ agregado, payment, ids, events }`). Não tocam repositório nem banco.
- **A escrita atômica é do controller**, via `transactionRepository.runAtomic(executor => …)`, passando o `executor` a cada repositório.
- **Saldo se move por repositório**, com `accountRepository.applyMovement(companyId, { transactionId, accountId, direction, amount }, executor)` — nunca por método do agregado `Account`.
- **Liquidação não repetível é barrada por `UPDATE` condicional** exigindo `rowCount === 1` (Fase 3, decisão 9), não por lock.

> Motivação e escopo: ver `proposal.md`. Requisitos observáveis: ver `specs/`.

**Restrições que moldam o desenho:**
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `nodenext` com extensão `.js` nos imports relativos
- Sem ORM, sem Zod, sem container de DI — Knex direto, validação manual em `api/dtos.ts`, composition root manual em `AppServer.build()`
- Nenhuma dependência externa nova — em particular, **nenhum cliente de cotação de mercado**
- `Result<T>` no domínio; `throw` só em boundary de infraestrutura
- Multi-tenancy é invariante de repositório (`BaseRepository.companyId`)
- Test runner: `node --test` via `tsx` (`npm test`)

## Goals / Non-Goals

**Goals:**
- Posição, custo médio, rentabilidade e saldo devedor **derivados**, nunca persistidos — a mesma disciplina do saldo (RN-02), do limite do cartão e da multa da cobrança
- Toda operação que move dinheiro produz uma transação na conta vinculada, atomicamente — investimento e empréstimo não são contabilidade paralela
- Nenhuma operação de liquidação repetível sob concorrência, com a mesma técnica já usada na Fase 3
- Uma única porta atravessando empresas, explícita e derivada do vínculo do usuário — o resto do sistema continua mono-empresa por invariante de repositório
- Conversão de moeda sempre pela taxa da data do fato, com a taxa usada visível no resultado

**Non-Goals:**
- Provedor de cotação de mercado e conciliação automática de carteira — as cotações são informadas; a integração futura preenche a mesma tabela
- Cálculo de imposto (ganho de capital, come-cotas, IRRF) e layout oficial da Receita — o relatório de IR entrega dados brutos
- Refinanciamento, portabilidade e recálculo de taxa de empréstimo — a amortização extra abate parcelas, não renegocia o contrato
- Marcação a mercado de renda fixa por curva de juros — Tesouro e CDB são precificados pela mesma tabela de cotações
- Entidade "Grupo Empresarial" com permissões próprias — a consolidação usa `company_users`

## Decisions

### 1. Investimentos e empréstimos vivem em `financeiro/`, não em contextos novos

**Decisão:** `Investment`, `InvestmentOperation`, `InvestmentQuote`, `Loan` e `LoanInstallment` entram em `src/financeiro/domain/`, com repositórios em `src/financeiro/infrastructure/` e controllers em `src/financeiro/api/`.

**Racional:** o mapa de contextos do `docs/docs/README.md` coloca "Investimentos, Empréstimos" explicitamente dentro do contexto **Financeiro**, junto com contas, transações e metas. Além disso, ambos precisam criar `Transaction` e mover `Account` — os dois agregados que definem o contexto. Colocá-los fora obrigaria a repetir a indireção que `pagamentos` precisou (interfaces importadas de `financeiro`) sem o motivo que a justificava lá: cobrança e conta a pagar são obrigações com **terceiros**; investimento e empréstimo são patrimônio da própria empresa.

**Alternativa considerada:** um contexto `patrimonio/` abrigando os dois. Rejeitada: contraria o mapa de contextos documentado e criaria um terceiro consumidor da mesma interface de transação sem ganho de isolamento.

**Consequência:** o vínculo transação → investimento/parcela é **local ao contexto**, então não precisa de porta como o `SettlementOriginChecker` da Fase 3 (decisão 10).

### 2. `patrimonio` e `cambio` são módulos dentro de `financeiro/`, não contextos

**Decisão:** `cambio` é `src/financeiro/domain/exchange-service.ts` + `exchange-rate-repository.ts` (o VO `ExchangeRate` já existe); `patrimonio` é uma **camada de leitura**, `src/financeiro/infrastructure/knex-net-worth-repository.ts`, sem agregado próprio.

**Racional:** nenhum dos dois tem regra de escrita própria além de "guarda uma taxa" — patrimônio é agregação de coisas que já existem. As capabilities da proposal são unidades de **spec**, não de diretório; a Fase 3 já fez isso (`pix` é capability, mas mora dentro de `pagamentos`).

### 3. Posição do investimento é derivada das operações; nada de quantidade persistida no agregado

**Decisão:** `Investment` guarda identidade e configuração (nome, tipo, símbolo, moeda, conta, categorias, status). Quantidade, custo médio, custo investido e resultado realizado são calculados por um módulo puro `investment-position.ts`, que recebe a lista ordenada de operações e devolve `{ quantity, averageCost, investedAmount, realizedResult, incomeReceived }`.

**Racional:** é a decisão de saldo (RN-02) aplicada de novo. Persistir quantidade cria uma segunda fonte de verdade que diverge no primeiro estorno.

**Consequência:** registrar uma operação exige ler as operações anteriores para validar venda maior que a posição. Isso é feito **dentro** do `runAtomic`, com a linha do investimento travada (decisão 4).

**Custo assumido:** a projeção do portfólio agrega em SQL (`sum(case when type='BUY' …)`) em `knex-investment-repository.ts`, não hidratando operações — mesma técnica do `knex-reporting-repository.ts`. O custo médio, que não sai de um `sum`, é calculado em SQL como custo remanescente ÷ quantidade remanescente, porque a política é custo médio (não FIFO) e portanto não depende da ordem.

### 4. Concorrência do investimento: `SELECT … FOR UPDATE` na linha do investimento

**Decisão:** o registro de operação abre `runAtomic`, faz `investmentRepository.findByIdForUpdate(companyId, id, executor)` (que emite `select … for update`), recalcula a posição pelas operações já gravadas, valida, insere operação e transação e chama `applyMovement`.

**Racional:** aqui a guarda **não** cabe em uma cláusula `where` como a de cobrança (Fase 3, decisão 9): a invariante violável é "quantidade vendida ≤ posição", que é uma soma sobre outra tabela. É exatamente o caso do `knex-card-repository.committedAmount({ lockForUpdate })` da Fase 2 — e é o precedente que este desenho segue, em vez de inventar técnica nova.

**Alternativa considerada:** coluna `quantity` no investimento com `UPDATE … WHERE quantity >= ?`. Rejeitada: reintroduz o estado persistido que a decisão 3 elimina.

### 5. Empréstimo: status persistido, saldo devedor derivado, parcelas materializadas na contratação

**Decisão:** `Loan` guarda `status` (CONTRACTED/IN_PROGRESS/DELINQUENT/SETTLED) e os termos do contrato; as parcelas são **geradas e gravadas** na contratação, cada uma com `interest_amount` e `principal_amount` congelados. O saldo devedor é a **soma dos `principal_amount` das parcelas ainda em aberto**, calculada em SQL.

**Correção feita na implementação:** a fórmula original — `principal − Σ principal pago − Σ amortizações extras` — conta a amortização extra duas vezes, porque a amortização *quita parcelas* (cujo principal entra na primeira soma) **e** reduz o principal da parcela que ela cobre só em parte. Somar o que resta em aberto é aritmeticamente equivalente quando não há amortização extra e continua correto quando há, sem precisar de um segundo termo. Continua derivado, nunca persistido. Coberto por `loan.test.ts` e por `net-worth.integration.test.ts`.

**Racional:** o status é uma máquina de estados documentada com transições que dependem de eventos externos (atraso), então é estado de verdade, não derivação — igual a `Charge` e `Invoice`. Já a tabela de amortização é determinística a partir do contrato, mas é materializada porque as parcelas são **entidades com identidade e situação própria** (pendente/paga/vencida), exatamente como as parcelas da Fase 1.

**Alternativa considerada:** gerar o cronograma sob demanda. Rejeitada: uma parcela precisa carregar status, transação de pagamento e vencimento editável — isso é entidade, não projeção.

### 6. Matemática do empréstimo em módulo puro, com a última parcela absorvendo o arredondamento

**Decisão:** `loan-math.ts` expõe `buildSchedule({ principal, monthlyRate, installmentCount, installmentAmount, firstDueDate })`. Para cada parcela *i*: `interest_i = round(saldo_{i-1} × taxa)`, `principal_i = parcela − interest_i`, `saldo_i = saldo_{i-1} − principal_i`. A última parcela recebe `principal_n = saldo_{n-1}` e `interest_n = parcela − principal_n`, garantindo `Σ principal = principal` **ao centavo**.

**Racional:** é a tabela de amortização padrão, e o usuário informa o valor da parcela (RF-FIN-035), então não há por que recalcular a Price. Amarrar a última parcela é o que impede um empréstimo de terminar com R$ 0,03 de saldo devedor residual — o defeito clássico deste cálculo.

**Guarda de contratação:** `installmentCount × installmentAmount ≥ principal`, senão o cronograma nunca zera o saldo. É a validação que a spec exige e a que barra o dado sem sentido antes de gerar 24 linhas erradas.

**Alternativa considerada:** derivar o valor da parcela pela fórmula Price a partir de principal/taxa/prazo. Rejeitada: o contrato real tem o valor da parcela impresso, e recalculá-lo produziria centavos diferentes dos do banco do usuário.

### 7. Pagamento de parcela e amortização: serviço puro + `UPDATE` guardado por status

**Decisão:** `LoanPaymentService` copia a assinatura de `ChargeReceiptService` — recebe `{ loan, installment, account, amount, paidAt }`, valida empresa, conta ativa, moeda, saldo e valor, constrói a transação de despesa confirmada, transiciona a parcela e o empréstimo e devolve `{ loan, installment, payment, paymentId, events }`. O controller faz o `runAtomic` com `create(payment)` → `applyMovement(DEBIT)` → `loanInstallmentRepository.update(installment, executor)` → `loanRepository.update(loan, executor)`.

`LoanInstallmentRepository.update()` emite `update loan_installments set … where id = ? and company_id = ? and status in ('PENDING','OVERDUE')` e **exige `rowCount === 1`**.

**Racional:** é a decisão 9 da Fase 3, e a razão é a mesma: dois pagamentos simultâneos da mesma parcela criariam duas transações de despesa — corrupção de dado, não apenas concorrência tolerável. A condição inteira cabe numa coluna de estado, então o `UPDATE` condicional é suficiente e mais barato que lock.

**Amortização extra** usa o mesmo caminho, mas precisa travar o empréstimo (`findByIdForUpdate`) porque decide **quais** parcelas quitar a partir do saldo devedor, que é uma soma — o mesmo motivo da decisão 4.

### 8. Cotações: tabela própria, upsert por (investimento, data), sem provedor

**Decisão:** `investment_quotes (investment_id, quote_date, unit_price, source, created_at)` com único em (`investment_id`, `quote_date`) e `onConflict().merge()` no registro. O valor atual usa `select … where quote_date <= :ref order by quote_date desc limit 1`.

**Racional:** é o mesmo modelo que uma integração de mercado preencheria — a coluna `source` (`MANUAL` hoje) já distingue a origem. Guardar um único campo `currentValue` no investimento (alternativa considerada) tornaria impossível responder "quanto valia em 31/12", que é exatamente o que o relatório de IR pede.

**Fallback declarado:** sem cotação, valor atual = custo investido, com a flag `quoted: false` no resultado. É melhor que zero (que apagaria patrimônio real) e melhor que erro (que quebraria o dashboard de quem ainda não registrou cotação), mas precisa ser visível — daí a flag na resposta, exigida pela spec.

### 9. Taxas de câmbio por empresa, com fallback para o par inverso e falha explícita

**Decisão:** `exchange_rates (id, company_id, source_currency, target_currency, rate decimal(18,8), rate_date, source, timestamps)`, único em (`company_id`, `source_currency`, `target_currency`, `rate_date`). `ExchangeService.rateFor(source, target, date)` busca a taxa mais recente `≤ date`; não achando, busca o par inverso e usa `1/rate`; não achando nenhum, devolve `Result.failed` com o par e a data. Mesma moeda devolve fator 1 sem consultar.

**Racional:** taxa por empresa porque a taxa que interessa é a que a empresa efetivamente usou (contrato de câmbio, cotação do banco), não uma taxa global — e porque uma tabela global exigiria decidir quem pode escrever nela, que é um problema de permissão que esta fase não abre. O fallback inverso evita obrigar o usuário a cadastrar USD→BRL *e* BRL→USD. `decimal(18,8)` porque taxas de moedas fracas (JPY, PYG) precisam de mais que duas casas.

**Alternativa considerada:** assumir 1 quando não há taxa. Rejeitada explicitamente: produziria um patrimônio errado com cara de certo — o pior resultado possível para um sistema financeiro.

### 10. Vínculo da transação com investimento e empréstimo é local, sem porta

**Decisão:** `transactions` recebe `investment_operation_id` e `loan_installment_id` nullable com FK. O bloqueio de edição/cancelamento é feito no `transaction-controller` lendo as próprias colunas.

**Racional:** a Fase 3 precisou do `SettlementOriginChecker` porque `Charge` e `Payable` moram em `pagamentos`, que depende de `financeiro` e não o contrário. Aqui os dois lados moram em `financeiro` (decisão 1), então a indireção não compraria isolamento nenhum — só um arquivo a mais.

### 11. Patrimônio: camada de leitura por componente, com saldo a uma data reconstruído das transações

**Decisão:** `knex-net-worth-repository.ts` expõe `netWorthAt(companyId, referenceDate, displayCurrency)`, somando em SQL, componente a componente: saldos de contas ativas, valor da carteira, recebíveis em aberto, saldo devedor de empréstimos, faturas em aberto e contas a pagar em aberto. Cada componente volta como linha `{ component, currency, amount }`; a conversão para a moeda de exibição acontece **depois**, em TypeScript, chamando o `ExchangeService`.

O saldo de conta **a uma data passada** é `sum(entries confirmadas com date <= referenceDate)`, não a coluna de saldo atual.

**Racional:** converter em SQL exigiria um join com a tabela de taxas repetido em seis subconsultas e reimplementaria a resolução de taxa (mais recente ≤ data, com fallback inverso) em SQL — duas implementações da mesma regra, e a cópia é sempre a que diverge. É a lição registrada na decisão 6 da Fase 3. O número de linhas a converter é da ordem de dezenas, então o custo é irrelevante.

**Consequência:** a evolução mensal do patrimônio faz 12 leituras de componentes, uma por mês. Aceitável dentro do orçamento de 10s da spec de relatórios; se apertar, vira uma consulta única com `generate_series`.

### 12. Consolidação multiempresa: leitura própria, empresas resolvidas do vínculo do usuário

**Decisão:** `CrossCompanyReader.netWorthByCompany(userId, referenceDate, displayCurrency)` faz `select company_id from company_users where user_id = :userId` e chama `netWorthAt` para cada empresa. Vive em um arquivo próprio (`knex-cross-company-repository.ts`), **fora** de qualquer classe que estenda `BaseRepository`, e recebe `userId` — nunca uma lista de empresas do cliente. A rota é `/api/v1/net-worth/consolidated`, e o `userId` vem de `getAuthContext(request)`.

**Racional:** o isolamento por empresa é invariante de repositório justamente para que não haja exceção acidental; então a exceção necessária tem que ser **inconfundível** — outro arquivo, outra assinatura (recebe usuário, não empresa), e nenhuma herança de `BaseRepository`. Um `findAll(companyIds)` em repositório normal seria a porta pela qual o isolamento vaza depois, por engano.

**Risco explícito:** um usuário com acesso a 50 empresas dispara 50 leituras. Mitigação: a resposta é paginável por empresa e o endpoint é o único desta fase sem índice de período — se virar problema, a consolidação vira uma consulta com `where company_id = any(:ids)` por componente.

### 13. Detecção de atraso: sétima passada do scheduler, idempotente pelo estado

**Decisão:** nova passada varrendo `loanInstallmentRepository.findOverdueCandidates(referenceDate)`, chamando `installment.markOverdue()` e `loan.markDelinquent()`, persistindo pelo `update()` guardado por status e publicando `LoanPaymentMissed`. Cada registro em seu próprio `try/catch`.

**Racional:** decisão 11 da Fase 3 e decisão 6 da Fase 2, sem alteração: a idempotência sai da máquina de estados, sem tabela de controle de job. Uma segunda execução no mesmo dia encontra `status = 'OVERDUE'`, recebe `Result.failed` e segue.

**Regularização** não é uma passada: acontece no pagamento, quando o serviço detecta que não restam parcelas vencidas e devolve o empréstimo a `IN_PROGRESS`.

### 14. Schema: uma migration nova, nenhuma existente editada

**Decisão:** `20240101000008_create_phase4_tables.ts`, criando:

- `investments` — `id`, `company_id`, `account_id`, `name`, `investment_type`, `symbol`, `currency`, `expense_category_id`, `income_category_id`, `status`, `closed_at`, timestamps; índice (`company_id`, `status`)
- `investment_operations` — `id`, `company_id`, `investment_id`, `transaction_id`, `operation_type`, `quantity decimal(20,8)`, `unit_price decimal(20,8)`, `fees decimal(15,2)`, `amount decimal(15,2)`, `currency`, `operated_at`, `notes`, timestamps; índice (`investment_id`, `operated_at`)
- `investment_quotes` — `id`, `investment_id`, `quote_date`, `unit_price decimal(20,8)`, `source`, timestamps; único (`investment_id`, `quote_date`)
- `loans` — `id`, `company_id`, `account_id`, `person_id`, `description`, `principal_amount decimal(15,2)`, `monthly_interest_percent decimal(7,4)`, `installment_count`, `installment_amount decimal(15,2)`, `currency`, `first_due_date`, `status`, `settled_at`, timestamps; índice (`company_id`, `status`)
- `loan_installments` — `id`, `company_id`, `loan_id`, `number`, `due_date`, `amount decimal(15,2)`, `interest_amount decimal(15,2)`, `principal_amount decimal(15,2)`, `status`, `paid_at`, timestamps; único (`loan_id`, `number`); índice (`company_id`, `status`, `due_date`)
- `loan_payments` — `id`, `company_id`, `loan_id`, `loan_installment_id`, `transaction_id`, `account_id`, `payment_type` (INSTALLMENT | EXTRA_AMORTIZATION), `amount decimal(15,2)`, `principal_amount decimal(15,2)`, `paid_at`
- `exchange_rates` — conforme a decisão 9
- `transactions`: colunas nullable `investment_operation_id` e `loan_installment_id`, com FK e índices parciais
- Índice `transactions(company_id, account_id, status, date)` se ainda não existir, exigido pela reconstrução de saldo a uma data (decisão 11)

**Racional:** `decimal(15,2)` para dinheiro segue as tabelas existentes; `decimal(20,8)` para quantidade e preço unitário porque cripto tem oito casas e uma fração de ação não cabe em duas. O `down()` na ordem inversa, como nas migrations anteriores.

**Consequência descoberta na implementação:** `transactions.investment_operation_id` e `investment_operations.transaction_id` se referenciam mutuamente, então a escrita da operação tem três passos dentro do mesmo `runAtomic`: grava a operação sem o vínculo, grava a transação (cuja FK já resolve) e fecha o vínculo com `linkOperationTransaction`. Nenhum estado intermediário é observável fora da transação de banco. Foi um teste de integração que expôs isso — a ordem "transação primeiro" viola a FK.

**Seeds:** `02_default_categories.ts` ganha a categoria de **despesa** "Investimentos" (hoje só existe a de receita), usada como padrão nas compras. Alterar o seed não afeta empresas já criadas — para elas, a categoria é escolhida no cadastro do investimento.

### 15. Rotas

Três plugins novos em `src/routes/`, registrados em `registerRoutes()` sob `/api/v1`:

| Arquivo | Prefixo | Endpoints |
|---|---|---|
| `investment-routes.ts` | `/investments` | `POST /`, `GET /`, `GET /:investmentId`, `PUT /:investmentId`, `POST /:investmentId/close` |
| | `/investments/:investmentId/operations` | `POST /`, `GET /` |
| | `/investments/:investmentId/quotes` | `POST /`, `GET /` |
| | `/investments/portfolio` | `GET /` |
| `loan-routes.ts` | `/loans` | `POST /`, `GET /`, `GET /:loanId`, `PUT /:loanId` |
| | `/loans/:loanId/installments` | `GET /`, `POST /:number/payments` |
| | `/loans/:loanId/amortizations` | `POST /` |
| `net-worth-routes.ts` | `/net-worth` | `GET /`, `GET /evolution`, `GET /consolidated` |
| | `/exchange-rates` | `POST /`, `GET /` |

`/reports/:type` ganha `net-worth`, `investments` e `income-tax`; `/dashboard` ganha os dois resumos novos e o parâmetro `displayCurrency`. Todas protegidas por `authenticate`, com `companyId` de `getCompanyId(request)` — e `/net-worth/consolidated` usando `userId` de `getAuthContext(request)`.

## Risks / Trade-offs

- **Compra de investimento lançada como despesa reduz o "resultado do período"** → comprar ações vira despesa no DRE e no fluxo de caixa, o que é correto para caixa e enganoso para resultado. Mitigação: a categoria de investimento é própria e separada, então o relatório de DRE a mostra numa linha identificável; o patrimônio (decisão 11) é onde a compra aparece como troca de forma, não como perda. Excluir compras do DRE seria uma mudança na spec da Fase 2 e não entra aqui.
- **Sem cotação, o valor atual mente por omissão** → a carteira aparece valendo o custo. Mitigação: flag `quoted: false` por investimento e no total do portfólio, exigida pela spec, para que a interface possa dizer "sem cotação" em vez de "0% de rentabilidade".
- **Taxa de câmbio faltando quebra a consolidação** → um único componente em moeda sem taxa impede o total. Mitigação declarada: a resposta reporta o par e a data faltantes em vez de emitir total parcial; é a decisão 9, e o custo é o usuário ter que cadastrar a taxa.
- **Custo médio não é FIFO** → o resultado realizado por venda difere do que a Receita exige para ganho de capital em alguns ativos. Mitigação: declarado como não-goal; o relatório de IR entrega posição e operações brutas, de onde o contribuinte (ou uma fase futura) aplica a regra fiscal.
- **`SELECT … FOR UPDATE` no investimento segura a linha durante a criação da transação** → sob rajada de operações no mesmo ativo, há fila. Mitigação: a seção crítica é curta (uma soma e três inserts) e a contenção é por investimento, não global; é o mesmo perfil já aceito no cartão da Fase 2.
- **A evolução de patrimônio faz 12 leituras de seis componentes** → 72 consultas por chamada. Mitigação: cada uma é uma agregação indexada e o orçamento é 10s; se apertar, a consulta única com `generate_series` é mecânica e não muda domínio nem spec.
- **Consolidação multiempresa é a primeira leitura que atravessa empresas** → se o padrão vazar para os repositórios normais, o isolamento morre. Mitigação: arquivo próprio, sem `BaseRepository`, assinatura recebendo `userId` (decisão 12), e teste de API cobrindo que uma empresa fora do vínculo do usuário não aparece nem quando o cliente a informa.
- **Scheduler cresce para sete passadas** → uma passada lenta atrasa as demais. Mitigação: cada passada já é independente e loga seu total; separar em jobs é mecânico.
- **Relatório de IR pode ser lido como apuração fiscal** → risco de uso indevido. Mitigação: a spec exige que o relatório não apresente imposto devido e declare que entrega dados brutos para a declaração.

## Migration Plan

1. Aplicar `npm run db:migrate` — a migration é puramente aditiva (tabelas novas + colunas nullable), sem backfill e sem downtime.
2. Atualizar o seed de categorias padrão (categoria de despesa "Investimentos"). Empresas existentes não são afetadas: para elas, as categorias do investimento são escolhidas no cadastro.
3. Deploy da API: as rotas novas não alteram nenhum contrato existente. `/dashboard` e `/reports` ganham campos, tipos e o parâmetro `displayCurrency`, todos aditivos — clientes das Fases 1 a 3 seguem funcionando. A **única** mudança de valor em contrato existente é o `netWorth` do dashboard, que passa a descontar passivos e somar investimentos; está declarado na spec como requisito modificado e é a razão de ela ter sido reescrita por inteiro.
4. Atualizar o cron do `scheduler` não é necessário — a sétima passada roda no mesmo binário já agendado.
5. **Rollback:** `npm run db:migrate:rollback` reverte o batch. Nenhum dado das fases anteriores é alterado ou migrado, então o rollback é seguro; perde-se apenas o que foi criado na Fase 4. O `netWorth` do dashboard volta ao cálculo anterior junto com o código.

## Open Questions

- **Estorno de operação de investimento:** a spec desta fase não pede estorno; a correção hoje é registrar a operação inversa. Se virar necessidade, entra como mudança própria, provavelmente espelhando o `refund` da transação.
- **Vencimento de parcela em fim de mês:** o cronograma usa `date-math.ts` da Fase 1, que já resolve "31 em fevereiro" para as recorrências. Vale confirmar na implementação que a mesma função é reusada, e não uma segunda regra de calendário.
