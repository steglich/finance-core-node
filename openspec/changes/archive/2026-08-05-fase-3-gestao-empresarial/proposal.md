## Why

As Fases 1 (Núcleo Financeiro) e 2 (Gestão Financeira) estão concluídas e arquivadas: o usuário registra o que aconteceu (contas, transações, transferências, parcelamentos, recorrências) e planeja e controla (cartões, faturas, orçamentos, metas, dashboard, relatórios). O que falta é tudo que envolve **terceiros e estrutura organizacional**: não existe cadastro de pessoas, então não há como saber *de quem* se recebe nem *a quem* se paga; não existe centro de custo, então o gasto não pode ser analisado por departamento; e não existe nenhum controle de valores a receber ou a pagar antes de virarem transação. A Fase 3 (Gestão Empresarial) fecha essa lacuna e é pré-requisito declarado da Fase 4.

## What Changes

- **Novo bounded context `cadastros`** — agregado `Pessoa` (PF/PJ) com nome, documento (CPF/CNPJ reusando os VOs já existentes em `identity/domain`), email, telefone e endereço. Uma pessoa recebe uma ou mais **classificações** (Cliente, Fornecedor, Favorecido) — não são entidades separadas, e a mesma pessoa pode ser cliente *e* fornecedor. Documento único por empresa. Inativação em vez de exclusão física.
- **Dados bancários de favorecido** — pessoa classificada como Favorecido pode ter uma ou mais contas bancárias cadastradas (chave PIX, banco/agência/conta), usadas para preencher pagamentos.
- **Fichas de Cliente e de Fornecedor** — visões derivadas: cliente com total em aberto, saldo devedor e histórico de cobranças; fornecedor com total devido e próximos pagamentos. Nenhum valor persistido — tudo derivado das cobranças e contas a pagar, na mesma disciplina da RN-02.
- **Novo módulo `centros-de-custo`** — unidade organizacional hierárquica (pai opcional), com o mesmo padrão de árvore já usado em `CategoryHierarchy`. Transação e orçamento passam a poder ser classificados por centro de custo, e há relatório por essa dimensão.
- **Novo módulo `cobrancas` (contas a receber)** — agregado `Cobrança` emitida para um cliente, com valor, vencimento, descrição, percentual de multa por atraso e percentual de juros ao mês. Máquina de estados Emitida → Paga / Vencida / Cancelada conforme `docs/docs/maquinas-estado.md`. O recebimento calcula multa e juros sobre o valor original quando vencida, cria a transação de receita na conta de destino e quita a cobrança. Cancelamento exige motivo e é proibido em cobrança paga.
- **Novo módulo `contas-a-pagar`** — agregado `ContaAPagar` vinculado a um fornecedor, com valor, vencimento, categoria, centro de custo e descrição. Máquina de estados espelhando a da cobrança (Pendente → Paga / Vencida / Cancelada). A baixa debita a conta escolhida criando a transação de despesa correspondente.
- **PIX como método de pagamento (registro manual)** — envio de PIX a partir de chave informada ou de favorecido cadastrado, gerando transação de despesa confirmada; recebimento de PIX gerando transação de receita, opcionalmente vinculada a uma cobrança em aberto. **Sem integração bancária**: o sistema registra o movimento, não o executa.
- **Scheduler** — nova passada diária marcando cobranças e contas a pagar vencidas, publicando `ChargeOverdue` / `PayableOverdue`, no mesmo batch de `src/scheduler.ts`.
- **Novos eventos de domínio** — `PersonRegistered`, `ChargeIssued`, `ChargePaid`, `ChargeOverdue`, `ChargeCancelled`, `PayableRegistered`, `PayablePaid`, `PayableOverdue`, consumidos por Auditoria (e, futuramente, Notificações). O catálogo em `docs/docs/eventos-dominio.md` ainda não os lista — esta mudança os introduz.
- **Novo serviço de domínio `ChargeService`** (o `CobrançaService` do modelo conceitual) — cálculo de multa e juros e marcação de vencidas.

## Capabilities

### New Capabilities

- `pessoas`: Cadastro de pessoas físicas e jurídicas por empresa, com documento validado e único, classificação como Cliente/Fornecedor/Favorecido, contas bancárias de favorecido e as fichas derivadas de cliente e de fornecedor. Cobre RF-CAD-001, RF-CAD-002, RF-CAD-003 e RF-CAD-004 (UC-CAD-001 a UC-CAD-004).
- `centros-de-custo`: Criação e gestão de centros de custo hierárquicos e sua aplicação como dimensão de classificação de transações e orçamentos. Cobre RF-CAD-005 e RF-CAD-006 (UC-CAD-005).
- `cobrancas`: Emissão de cobranças para clientes, cálculo automático de multa e juros no vencimento, registro de recebimento com criação da transação de receita, cancelamento e máquina de estados da cobrança. Cobre RF-PAG-001, RF-PAG-002, RF-PAG-005 e RF-PAG-006 (UC-PAG-001).
- `contas-a-pagar`: Registro de obrigações a pagar vinculadas a fornecedores, com vencimento, baixa gerando transação de despesa, marcação de atraso e cancelamento. Sustenta o critério do backlog "fornecedor aparece com a lista de pagamentos pendentes"; a Fase 3 do README a declara explicitamente.
- `pix`: Envio e recebimento de PIX como registro manual — chave PIX avulsa ou favorecido cadastrado no envio, vínculo opcional a cobrança no recebimento. Cobre RF-PAG-003 no que é possível sem provedor bancário.

### Modified Capabilities

- `transacoes`: a transação ganha vínculo opcional a `costCenterId` (o campo já citado na spec como "cost center" passa a ter entidade e validação) e a `personId` (contraparte). Ambos devem pertencer à mesma empresa; centro de custo deve estar ativo.
- `orcamentos`: o orçamento passa a poder ser definido por centro de custo além de por categoria — pelo menos uma das duas dimensões é obrigatória, e o gasto real é derivado filtrando pelas dimensões declaradas.
- `relatorios`: "Spending Reports by Dimension" ganha a dimensão **centro de custo** (com rollup dos filhos no pai, como já é feito com subcategorias), e entram dois relatórios novos: Contas a Receber e Contas a Pagar, por período e por situação.
- `dashboard`: os resumos consolidados passam a incluir total a receber e total a pagar do período, com destaque para o que está vencido.

`identity`, `categorias`, `contas-financeiras`, `cartoes`, `faturas`, `metas`, `parcelamentos`, `transferencias`, `recorrencias` e `auditoria` permanecem inalteradas em nível de spec.

## Impact

- **Código novo**: novo bounded context `src/cadastros/` (domain/infrastructure/api) para `Pessoa`, `ContaBancária` e `CentroDeCusto`; novos agregados `Charge` e `Payable` em `src/financeiro/domain/` com repositórios e controllers próprios; `src/routes/registration-routes.ts` e `src/routes/payment-routes.ts` registrados em `registerRoutes()` sob `/api/v1`; nova passada em `src/scheduler.ts`.
- **Reuso**: os VOs `Cpf`, `Cnpj` e `Email` vivem hoje em `identity/domain/` e passam a ser usados por `cadastros/` — a mudança move essas primitivas de documento para `shared/domain/` para não criar dependência entre contextos.
- **Migrations**: nova migration `20240101000007_create_phase3_tables.ts` com `people`, `person_roles`, `person_bank_accounts`, `cost_centers`, `charges`, `charge_receipts`, `payables`, `payable_payments`, mais as colunas nullable `cost_center_id` e `person_id` em `transactions` e `cost_center_id` em `budgets`. Migrations já aplicadas não são editadas.
- **Composition root**: `AppServer.build()` instancia os novos repositórios, serviços e controllers.
- **Dependências**: **nenhuma dependência externa nova.** Validação de CPF/CNPJ e chave PIX é implementada à mão, como o restante do projeto.
- **Multi-tenancy**: todos os novos repositórios filtram por `companyId` (RNF-SEC-005), invariante de `BaseRepository`.
- **Auditoria**: pessoa, centro de custo, cobrança e conta a pagar entram em RN-09 — criação, edição e mudança de estado geram registro de auditoria.
- **Fora de escopo (declarado)**:
  - **RF-PAG-004 (boletos)** — exige provedor bancário para código de barras/linha digitável e biblioteca de PDF, ambos dependências externas a aprovar. Fica para uma mudança própria; o agregado `Charge` já nasce com o campo de identificação externa reservado.
  - **Integração bancária de PIX** — envio real e conciliação automática dependem de provedor. O que entra é o registro manual do movimento.
  - **Notificações** (cobrança emitida/vencida) — os eventos são publicados e servirão de gatilho quando o contexto de Notificações existir.
- **Fase futura**: a Fase 4 (Patrimônio e Investimentos) depende desta — em especial a consolidação patrimonial, que somará recebíveis e obrigações.
