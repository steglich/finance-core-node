## Why

As Fases 1, 2 e 3 estão concluídas e arquivadas: o sistema registra o que aconteceu (contas, transações, transferências, parcelamentos, recorrências), planeja e controla (cartões, faturas, orçamentos, metas, dashboard, relatórios) e opera com terceiros (pessoas, centros de custo, cobranças, contas a pagar, PIX). Falta a última camada declarada no `docs/docs/README.md`: **o que o usuário tem e o que o usuário deve**. Hoje um investimento em ações não existe como conceito — vira uma transação de despesa numa conta do tipo `INVESTMENT` e some; um empréstimo é apenas um punhado de parcelas soltas, sem saldo devedor nem quitação; e o "patrimônio líquido" do dashboard é a soma dos saldos das contas, o que ignora carteira de investimentos e endividamento, e não sabe somar contas em moedas diferentes. A Fase 4 (Patrimônio e Investimentos) fecha o escopo funcional do produto: RF-FIN-032 a RF-FIN-036, RF-FIN-043 a RF-FIN-045, RNF-MULTI-003, RNF-MULTI-005 e RNF-MULTI-006.

## What Changes

- **Novo módulo `investimentos`** — agregado `Investment` (ativo mantido pela empresa) com tipo (Ação, FII, Tesouro, CDB, Cripto, ETF, Fundo, Previdência), símbolo/identificação, moeda, conta de investimento vinculada e situação. A **posição** (quantidade e custo médio) é **derivada das operações**, nunca persistida no agregado — a mesma disciplina do saldo (RN-02) e do limite do cartão.
- **Operações de investimento** — `InvestmentOperation` com tipo Compra, Venda, Dividendos, Juros e Amortização (RF-FIN-033). Compra e venda movem quantidade e caixa; dividendos e juros criam **transação de receita** vinculada ao investimento; amortização devolve principal. Toda operação que move dinheiro cria a transação correspondente na conta vinculada, de forma atômica — o investimento não é uma contabilidade paralela.
- **Cotações de ativo** — tabela própria de cotações (`preço por ativo em uma data`), informadas manualmente ou por integração futura. Valor atual = quantidade × cotação mais recente até a data de referência. Rentabilidade = (valor atual + realizado + proventos − custo) ÷ custo. **Nenhum provedor de mercado externo entra nesta fase**; a porta fica pronta.
- **Novo módulo `emprestimos`** — agregado `Loan` com valor contratado, taxa de juros, número e valor da parcela, conta vinculada e credor opcional (pessoa da Fase 3). A contratação **gera as parcelas** (`LoanInstallment`) com vencimentos mensais. Máquina de estados Contratado → Em Andamento → Quitado / Inadimplente, exatamente como `docs/docs/maquinas-estado.md`.
- **Pagamento de parcela e amortização extra** — o pagamento debita a conta escolhida criando a transação de despesa, reduz o saldo devedor e, na última parcela, quita o empréstimo. A amortização extra reduz o saldo devedor abatendo as parcelas futuras a partir da última (RF-FIN-036).
- **Novo módulo `cambio`** — registro de taxas de câmbio por par de moedas e data (RNF-MULTI-005) e o `ExchangeService` (o *CâmbioService* do modelo conceitual), que converte valores usando **a taxa da data do fato, não a taxa atual** (RN-07, RNF-MULTI-006). O VO `ExchangeRate` já existe em `financeiro/domain` e passa a ter persistência e serviço.
- **Novo módulo `patrimonio`** — consolidação patrimonial: ativos (saldos de contas + carteira de investimentos + recebíveis em aberto) menos passivos (saldo devedor de empréstimos + faturas em aberto + contas a pagar em aberto), convertidos para uma moeda de exibição. Inclui a **consolidação multiempresa** (RNF-MULTI-003), restrita às empresas às quais o usuário autenticado pertence (`company_users`).
- **Novos relatórios** — Patrimônio (RF-FIN-043), Investimentos (RF-FIN-044) e Imposto de Renda em versão básica (RF-FIN-045: posição em 31/12, proventos e rendimentos do ano, saldos de contas e dívidas — dados brutos, sem layout oficial da Receita).
- **Scheduler** — nova passada diária marcando parcelas de empréstimo vencidas, publicando `LoanPaymentMissed` e transicionando o empréstimo para Inadimplente; regularização automática quando as parcelas atrasadas são quitadas.
- **Novos eventos de domínio** — `InvestmentCreated`, `InvestmentOperationRegistered`, `InvestmentClosed`, `LoanCreated`, `LoanSettled`, `LoanPaymentMissed`, `ExchangeRateRegistered`, consumidos por Auditoria. `LoanCreated`, `LoanSettled` e `LoanPaymentMissed` já estão catalogados em `docs/docs/eventos-dominio.md`; os demais são novos e entram no catálogo.

## Capabilities

### New Capabilities

- `investimentos`: Cadastro de investimentos por tipo, registro de operações (compra, venda, dividendos, juros, amortização) com a transação financeira correspondente, cotações manuais, e posição e rentabilidade derivadas. Cobre RF-FIN-032, RF-FIN-033 e RF-FIN-034 (UC-FIN-011).
- `emprestimos`: Contratação de empréstimo com geração de parcelas, pagamento de parcela gerando transação de despesa, amortização extra, controle de saldo devedor e a máquina de estados Contratado/Em Andamento/Inadimplente/Quitado. Cobre RF-FIN-035 e RF-FIN-036 (UC-FIN-012).
- `cambio`: Registro e consulta de taxas de câmbio por par de moedas e data, e conversão de valores usando a taxa vigente na data do fato. Cobre RNF-MULTI-005 e RNF-MULTI-006, e sustenta RN-07 nas leituras consolidadas.
- `patrimonio`: Consolidação patrimonial de uma empresa (ativos − passivos) em moeda de exibição e consolidação entre as empresas do usuário autenticado. Cobre RNF-MULTI-003 e sustenta RF-FIN-043.

### Modified Capabilities

- `transacoes`: a transação ganha vínculo opcional a `investmentId` e a `loanInstallmentId` (origem de liquidação), com bloqueio de edição e de cancelamento quando originada de operação de investimento ou de pagamento de parcela de empréstimo — a mesma regra já aplicada às liquidações da Fase 3. A exigência de taxa de câmbio quando a moeda da transação difere da moeda da conta (RN-07) passa a estar declarada em spec.
- `relatorios`: entram três relatórios novos — Patrimônio, Investimentos e Imposto de Renda —, todos com exportação CSV como os existentes, e os relatórios passam a aceitar uma moeda de exibição opcional.
- `dashboard`: os indicadores ganham patrimônio consolidado (não mais só a soma dos saldos), resumo de investimentos com rentabilidade e resumo de endividamento (saldo devedor total e parcelas em atraso), conforme "Fase 4 adiciona indicadores de investimentos, rentabilidade e endividamento" (UC-FIN-013).

`identity`, `categorias`, `contas-financeiras`, `cartoes`, `faturas`, `metas`, `orcamentos`, `parcelamentos`, `transferencias`, `recorrencias`, `pessoas`, `centros-de-custo`, `cobrancas`, `contas-a-pagar`, `pix` e `auditoria` permanecem inalteradas em nível de spec.

## Impact

- **Código novo**: novos agregados `Investment`, `InvestmentOperation`, `Loan` e `LoanInstallment` em `src/financeiro/domain/`, com repositórios, serviços de liquidação e controllers próprios; `src/financeiro/domain/exchange-service.ts` e a persistência de taxas; camada de leitura de patrimônio; `src/routes/investment-routes.ts`, `src/routes/loan-routes.ts` e `src/routes/net-worth-routes.ts` registrados em `registerRoutes()` sob `/api/v1`; nova passada em `src/scheduler.ts`.
- **Reuso**: `Money`, `Percent`, `Period`, `ExchangeRate`, `AggregateRoot`, `DomainEventBus`, `TransactionRepository.runAtomic()` e `AccountRepository.applyMovement()` já existem e são a base de toda a fase. `ExchangeRate` (hoje usado apenas em transferências e transações) ganha repositório e serviço.
- **Migrations**: nova migration `20240101000008_create_phase4_tables.ts` com `investments`, `investment_operations`, `investment_quotes`, `loans`, `loan_installments`, `loan_payments`, `exchange_rates`, mais as colunas nullable `investment_id` e `loan_installment_id` em `transactions`. Migrations já aplicadas não são editadas.
- **Composition root**: `AppServer.build()` instancia os novos repositórios, serviços e controllers.
- **Dependências**: **nenhuma dependência externa nova.** Sem cliente de cotação de mercado, sem biblioteca financeira — a matemática de juros e rentabilidade é implementada à mão, como o restante do projeto.
- **Multi-tenancy**: todos os novos repositórios filtram por `companyId` (RNF-SEC-005). A **única** leitura que atravessa empresas é a consolidação multiempresa, que resolve o conjunto de empresas a partir de `company_users` do usuário autenticado — nunca de uma lista enviada pelo cliente — e vive em uma camada de leitura própria e explícita, fora dos repositórios mono-empresa.
- **Auditoria**: investimento, operação, empréstimo, pagamento de parcela e taxa de câmbio entram em RN-09.
- **Fora de escopo (declarado)**:
  - **Cotação automática de mercado** — exige provedor externo (dependência e credenciais a aprovar). Entram as cotações informadas manualmente; o modelo de dados já é o mesmo que uma integração usaria.
  - **Layout oficial da Receita Federal para o IR** — o relatório entrega os dados brutos consolidados do ano; formatação para a declaração fica para uma mudança própria.
  - **Cálculo de imposto sobre ganho de capital e come-cotas** — depende de regras fiscais por tipo de ativo que os documentos do projeto não especificam.
  - **Grupo empresarial como entidade** — a consolidação usa o vínculo usuário↔empresa já existente; um cadastro de grupo com permissões próprias seria uma mudança à parte.
  - **Notificações** de parcela vencida e meta de rentabilidade — os eventos são publicados e servirão de gatilho quando o contexto de Notificações existir.
- **Fecho do roadmap**: esta é a última fase declarada no `docs/docs/README.md`. Concluída, todo o backlog inicial (20 funcionalidades, 31 histórias) está coberto.
