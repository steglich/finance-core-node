## Why

A Fase 1 (Núcleo Financeiro) está concluída e arquivada: contas, categorias, transações, transferências, parcelamentos, recorrências e auditoria estão implementados e operando. O usuário já consegue registrar o que aconteceu, mas ainda não consegue **planejar e controlar** — não há cartões de crédito, faturas, orçamentos, metas nem qualquer visão consolidada. A Fase 2 (Gestão Financeira) fecha essa lacuna e é pré-requisito declarado das Fases 3 e 4.

## What Changes

- **Novo módulo Financeiro — Cartões**: cadastro de cartões de crédito, débito e pré-pago vinculados a uma conta, com bandeira, banco, limite, dia de fechamento e dia de vencimento. Limite disponível derivado das compras não faturadas + faturas em aberto (nunca editável diretamente, análogo ao saldo derivado da RN-02). Alteração de limite auditada; inativação de cartão.
- **Novo módulo Financeiro — Faturas**: ciclo de fatura por cartão. Compras no cartão são vinculadas à fatura aberta do ciclo correspondente. Fechamento (automático via scheduler na data de fechamento, ou manual) consolida as compras, calcula o total e cria a obrigação de pagamento distinta (RN-08), publicando `InvoiceClosed`. Pagamento total ou parcial debita a conta escolhida e move a fatura por sua máquina de estados (Aberta → Fechada → Parcialmente Paga / Paga / Atrasada), publicando `InvoicePaid` / `InvoiceOverdue`.
- **Novo módulo Financeiro — Orçamentos**: orçamento por categoria e período (mês/ano), com valor planejado. Progresso calculado a partir das transações confirmadas da categoria (e subcategorias) dentro do período. Publica `BudgetExceeded` ao ultrapassar 100% e `BudgetPeriodClosed` no encerramento do período (scheduler).
- **Novo módulo Financeiro — Metas**: meta financeira com nome, valor objetivo, prazo e conta vinculada. Contribuições registram transações e avançam a máquina de estados (Criada → Em Progresso → Alcançada / Cancelada), publicando `GoalCreated`, `ContributionMade` e `GoalAchieved`. Invariante `valor atual <= valor objetivo` e meta alcançada/cancelada imutável.
- **Novo módulo Financeiro — Dashboard**: indicadores consolidados do período (receita, despesa, saldo, patrimônio líquido), gastos por categoria, evolução mensal de 12 meses e, adicionalmente na Fase 2, resumo de orçamentos, metas e cartões/faturas. Filtros por período e por conta.
- **Novo módulo Financeiro — Relatórios**: Fluxo de Caixa, DRE Simplificada e Gastos por Categoria / Cartão / Conta, com período parametrizável e exportação CSV. (Patrimônio, Investimentos e IR permanecem na Fase 4.)
- **Extensão do agregado Conta**: `Cartão` passa a ser entidade filha do agregado `Conta` conforme o modelo conceitual — cartão só existe vinculado a uma conta.
- **Extensão de Transação**: transação de despesa pode referenciar um `cardId` e, quando faturada, um `invoiceId`. Transações de cartão de crédito não debitam a conta no ato da compra — o débito ocorre no pagamento da fatura.
- **Novos serviços de domínio**: `FechamentoFaturaService` (consolidação do ciclo) e `OrçamentoService` (comparação gasto real × planejado e emissão de `BudgetExceeded`).
- **Scheduler**: novas passadas de fechamento de fatura, marcação de fatura atrasada e encerramento de período de orçamento, no mesmo batch já existente (`src/scheduler.ts`).
- **Regras de negócio implementadas**: RN-08 (fechamento de fatura cria obrigação distinta) e reafirmação de RN-01, RN-02, RN-03, RN-06 e RN-09 nos novos agregados.

## Capabilities

### New Capabilities

- **cartoes**: Cadastro e gestão de cartões (crédito/débito/pré-pago) vinculados a uma conta, com limite, bandeira, dia de fechamento e de vencimento; limite disponível derivado; inativação. Cobre RF-FIN-021, RF-FIN-022 e RF-FIN-025.
- **faturas**: Ciclo de fatura por cartão, vínculo das compras ao ciclo, fechamento automático e manual, pagamento total ou parcial, atraso e máquina de estados da fatura. Cobre RF-FIN-023 e RF-FIN-024, e implementa RN-08.
- **orcamentos**: Orçamentos por categoria e período com valor planejado, cálculo de progresso a cada transação e alerta de excedente. Cobre RF-FIN-026, RF-FIN-027 e RF-FIN-028.
- **metas**: Metas financeiras com valor alvo, prazo e conta vinculada; registro de contribuições e progresso percentual, com máquina de estados própria. Cobre RF-FIN-029, RF-FIN-030 e RF-FIN-031.
- **dashboard**: Indicadores consolidados do período — receita, despesa, saldo, patrimônio líquido, gastos por categoria, evolução mensal — mais os resumos de orçamento, metas e cartões da Fase 2. Cobre RF-FIN-037, RF-FIN-038 e RF-FIN-039.
- **relatorios**: Relatórios de Fluxo de Caixa, DRE Simplificada e Gastos por Categoria/Cartão/Conta, com período parametrizável e exportação CSV. Cobre RF-FIN-040, RF-FIN-041 e RF-FIN-042.

### Modified Capabilities

- **contas-financeiras**: o agregado `Conta` passa a conter `Cartão` como entidade filha; a conta expõe os cartões vinculados e a inativação de conta passa a considerar cartões ativos e faturas em aberto.
- **transacoes**: transação de despesa ganha vínculo opcional a `cardId` e a `invoiceId`; compras em cartão de crédito não alteram o saldo da conta no ato do registro, e uma transação já faturada não pode ser editada nem excluída sem passar pela fatura.
- **contas-financeiras** e **transacoes** são as únicas capacidades existentes cujos requisitos mudam. `categorias`, `parcelamentos`, `transferencias`, `recorrencias`, `identity` e `auditoria` permanecem inalteradas em nível de spec.

## Impact

- **Código novo**: `src/financeiro/domain/` (Card, Invoice, Budget, Goal, Contribution + eventos e serviços), `src/financeiro/infrastructure/` (interfaces + implementações Knex dos 4 novos repositórios e das queries de dashboard/relatórios), `src/financeiro/api/` (6 novos controllers + DTOs), `src/routes/finance-routes.ts` (6 novos grupos de rota), `src/scheduler.ts` (3 novas passadas).
- **Migrations**: nova migration com `cards`, `invoices`, `invoice_payments`, `budgets`, `goals`, `goal_contributions`, mais colunas `card_id` e `invoice_id` em `transactions`. Migrations já aplicadas não são editadas.
- **Composition root**: `AppServer.build()` instancia os novos repositórios, serviços e controllers e os registra em `registerRoutes()`.
- **Dependências**: nenhuma dependência externa nova. Exportação CSV é serialização própria; agregações são SQL via Knex.
- **Performance**: dashboard e relatórios são as primeiras queries agregadas do projeto — RNF-PERF-002 (dashboard < 3s para 10.000 transações) e RNF-PERF-003 (relatório < 10s para 12 meses) passam a ser critérios explícitos, com índices dedicados na migration.
- **Multi-tenancy**: todos os novos repositórios filtram por `companyId` (RNF-SEC-005), invariante de `BaseRepository`.
- **Fora de escopo (declarado)**: RF-AUD-004/RF-AUD-005 (versionamento e comparação de versões) e RF-NOT-001/002/005/006 (notificações por email e central de notificações) estão marcados como Fase 2 em `requisitos.md`, mas não fazem parte do Épico 2 do backlog nem da definição da Fase 2 no README. Notificações exigiriam um provedor de email (dependência externa a aprovar). Ficam para uma mudança própria; os eventos (`BudgetExceeded`, `InvoiceOverdue`, `GoalAchieved`) já são publicados e servirão de gatilho.
- **Fases futuras**: Fase 3 (Gestão Empresarial) e Fase 4 (Patrimônio) dependem desta fase — em especial Centro de Custo, que reaproveitará a estrutura de orçamento.
