## Context

As Fases 1 e 2 estão implementadas e arquivadas. O projeto já tem: `shared/domain` (Entity, AggregateRoot, ValueObject, Result, DomainError, DomainEventBus); o contexto `identity/` com os VOs `Email`, `CPF`, `CNPJ` e `Password`; o contexto `financeiro/` com `Account`, `Category`, `Transaction`, `Card`, `Invoice`, `Budget`, `Goal`, os VOs `Money`, `Period`, `Percent`, `Currency`, o serviço de hierarquia `CategoryHierarchy` e a camada de leitura `knex-reporting-repository.ts`; repositórios Knex com filtro obrigatório por `companyId`; controllers retornando `ControllerResult`; rotas Fastify por contexto sob `/api/v1`; auditoria consumindo eventos do bus; e um `src/scheduler.ts` batch com cinco passadas (recorrências, parcelas atrasadas, fechamento de fatura, fatura atrasada, encerramento de orçamento).

**Três padrões do código existente que este desenho segue à risca** (verificados em `invoice-payment-service.ts`, `invoice-controller.ts` e `knex-card-repository.ts`):
- **Serviços de domínio são puros.** `InvoicePaymentService.pay()` e `TransferService` recebem agregados já hidratados, validam, transicionam e **devolvem as peças** (`{ invoice, payment, paymentId, amount, paidAt, events }`). Não tocam repositório nem banco.
- **A escrita atômica é do controller.** É o controller que chama `transactionRepository.runAtomic(executor => …)` e passa o `executor` a cada repositório.
- **Saldo se move por repositório, não por agregado.** `accountRepository.applyMovement(companyId, { transactionId, accountId, direction, amount }, executor)` — não existe `account.debit()` no caminho de escrita.

> Motivação e escopo: ver `proposal.md`. Requisitos observáveis: ver `specs/`.

**Restrições que moldam o desenho:**
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `nodenext` com extensão `.js` nos imports relativos
- Sem ORM, sem Zod, sem container de DI — Knex direto, validação manual em `api/dtos.ts`, composition root manual em `AppServer.build()`
- Nenhuma dependência externa nova sem aprovação — e esta fase não pede nenhuma
- `Result<T>` no domínio; `throw` só em boundary de infraestrutura
- Multi-tenancy é invariante de repositório (`BaseRepository.companyId`)
- Test runner: `node --test` via `tsx` (`npm test`), padrão já usado em `*.test.ts`

## Goals / Non-Goals

**Goals:**
- Três contextos com dependência unidirecional e sem ciclo: `cadastros` ← `financeiro` ← `pagamentos`
- Valores de terceiros (saldo do cliente, dívida com fornecedor, multa e juros) **derivados**, nunca persistidos — a mesma disciplina do saldo (RN-02) e do limite do cartão
- Recebimento de cobrança e baixa de conta a pagar atômicos e não repetíveis, mesmo sob concorrência
- Reuso das primitivas existentes (`Money`, `Percent`, `Period`, `AggregateRoot`, `DomainEventBus`) — nenhum conceito novo de infraestrutura
- Detecção de vencidos idempotente pela própria máquina de estados, sem tabela de controle de job

**Non-Goals:**
- Quitação parcial de cobrança ou de conta a pagar — a máquina de estados documentada (`docs/docs/maquinas-estado.md`) não tem estado "Parcialmente Paga" para cobrança, e criá-lo agora ampliaria a fase sem requisito que o peça
- Recorrência de cobranças e de contas a pagar (assinatura mensal automática) — a recorrência da Fase 1 continua gerando transações, não cobranças
- Conciliação bancária, código de barras, linha digitável e PDF — dependem de provedor externo (ver "Fora de escopo" na proposal)
- Permissões finas por recurso (`cadastros.*` citado nos casos de uso) — o modelo de perfis da Fase 1 continua como está; esta fase não muda autorização

## Decisions

### 1. `cadastros` como bounded context próprio, referenciado por id

**Decisão:** criar `src/cadastros/` (domain / infrastructure / api) abrigando `Person`, `PersonBankAccount` e `CostCenter`. `financeiro` e `pagamentos` referenciam esses conceitos **apenas por id** — `Transaction` guarda `costCenterId` e `personId` como `string`, sem importar nada de `cadastros`. A validação ("existe, é da empresa, está ativo") acontece no controller/serviço que recebe a entrada, usando `CostCenterRepository` / `PersonRepository` injetados no composition root.

**Racional:** é o mapa de contextos do `docs/docs/README.md`, e mantém o domínio financeiro livre de dependência de cadastro. É também o que já é feito com `categoryId` e `accountId` dentro do próprio contexto financeiro.

**Alternativa considerada:** colocar `Person` e `CostCenter` dentro de `financeiro/`. Rejeitada: `Person` também é usada por `pagamentos` e, na Fase 4, por investimentos e empréstimos — ela não pertence a nenhum deles.

### 2. `pagamentos` como bounded context próprio, dependendo de `financeiro`

**Decisão:** criar `src/pagamentos/` com os agregados `Charge` (contas a receber) e `Payable` (contas a pagar), seus serviços de liquidação e o caso de uso de PIX. Esse contexto **pode** importar de `financeiro` (agregado `Transaction`, interfaces `AccountRepository` e `TransactionRepository`); `financeiro` **nunca** importa de `pagamentos`. A regra do projeto vira: `cadastros` ← `financeiro` ← `pagamentos`, sem ciclos.

**Racional:** cobrança e conta a pagar são obrigações entre a empresa e terceiros; a transação é a consequência. Colocá-las em `financeiro` inverteria a relação e faria o núcleo financeiro conhecer clientes e fornecedores.

**Alternativa considerada:** `Charge`/`Payable` em `financeiro/`, reusando tudo sem indireção. Mais barato hoje, mas empurra o contexto financeiro para virar o depósito de qualquer conceito novo — foi exatamente o que a divisão por contexto do projeto se propôs a evitar.

### 3. Documentos e email sobem para `shared/domain`

**Decisão:** mover `Email`, `CPF` e `CNPJ` de `src/identity/domain/` para `src/shared/domain/`, mantendo `export` de compatibilidade em `identity/domain/index.ts` para não tocar em nenhum import existente.

**Racional:** `cadastros` precisa dos três, e um import `cadastros → identity` criaria uma dependência entre contextos de negócio que não existe no mapa. São primitivas de valor sem regra de negócio de identidade — o lugar delas é `shared`.

**Alternativa considerada:** duplicar a validação de CPF/CNPJ em `cadastros`. Rejeitada: duas implementações de dígito verificador divergem com o tempo.

### 4. Extrair `TreeHierarchy<T>` para `shared/domain`; as duas hierarquias herdam dela

**Decisão:** criar `src/shared/domain/tree-hierarchy.ts` com a classe genérica `TreeHierarchy<T extends { id: string; parentId: string | undefined }>`, contendo o que hoje é `CategoryHierarchy` menos as regras de categoria: `size`, `find`, `roots`, `childrenOf`, `ancestorsOf` (com guarda de ciclo), `descendantsOf` (BFS), `depthOf`, `isDescendantOf` e `tree()`. `CategoryHierarchy` passa a estendê-la mantendo **exatamente a mesma API pública** (`move()` e `delete()`, que são específicas de categoria, continuam nela). `CostCenterHierarchy` estende a mesma base e acrescenta o limite de três níveis e a coleta em cascata para a inativação.

**Racional:** a leitura de `category-hierarchy.ts` desmonta o argumento de "não generalizar antes do terceiro caso": das 193 linhas do arquivo, cerca de 150 são travessia de árvore genérica, e só `move()` e `delete()` conhecem `Category`. Reescrever essas 150 linhas em `cadastros` seria copiar código já escrito e já em uso em seis arquivos — inclusive a guarda de ciclo em `ancestorsOf`, que é o pedaço sutil e o que mais dói se divergir.

**Risco e mitigação:** é um refactor sobre código das Fases 1 e 2 que não tem teste dedicado (`CategoryHierarchy` é exercitada indiretamente por `budget.test.ts` e usada em seis arquivos). Como a herança preserva a API pública, nenhum dos seis call sites muda. O critério de aceite do passo é `npm run typecheck` e `npm test` verdes **sem alterar nenhum arquivo que consome `CategoryHierarchy`** — se algum precisar mudar, a extração saiu errada. A extração vem antes de `CostCenter` na ordem das tarefas, para que a base já esteja validada quando o segundo consumidor aparecer.

**Alternativa considerada:** duplicar a travessia em `cadastros`. Rejeitada pelo volume real de duplicação, medido e não estimado.

### 5. Classificações da pessoa como conjunto de papéis, não como entidades separadas

**Decisão:** não existem entidades `Cliente`, `Fornecedor` e `Favorecido`. `Person` é o aggregate root e carrega um conjunto de `PersonRole` (`CUSTOMER` | `SUPPLIER` | `PAYEE`), persistido em `person_roles`. Cliente, fornecedor e favorecido são **filtros** sobre pessoas.

**Racional:** o modelo conceitual escreve `Pessoa ── Cliente | Fornecedor | Favorecido` — são facetas da mesma pessoa, e o caso de uso UC-CAD-001 trata a classificação como marcação. Entidades separadas obrigariam a duplicar nome, documento e contato, e a manter três registros em sincronia para quem é cliente e fornecedor ao mesmo tempo.

**Consequência:** a remoção de um papel precisa checar registros abertos (`ChargeRepository.hasOpenCharges(personId)`, `PayableRepository.hasOpenPayables(personId)`). Como esses repositórios vivem em `pagamentos` e a regra é do domínio de `cadastros`, a checagem entra como parâmetro no método de domínio (`person.removeRole(role, { openCharges, openPayables })`), no mesmo padrão de `Card.deactivate(openInvoiceCount, unpaidInvoiceCount)` da Fase 2 — o domínio recebe o fato, não vai buscá-lo.

### 6. Fichas de cliente e de fornecedor são camada de leitura

**Decisão:** `pagamentos/infrastructure/knex-ledger-repository.ts` expõe `customerLedger(companyId, personId)` e `supplierLedger(companyId, personId)`, retornando DTOs planos agregados em SQL. Nenhuma entidade é hidratada e nenhum total é persistido em `people`.

**Racional:** é a decisão 10 da Fase 2 aplicada de novo — agregação é trabalho do banco, e um total persistido viraria segunda fonte de verdade a reconciliar. Multa e juros das cobranças vencidas são calculados na projeção usando a mesma fórmula do domínio (ver decisão 7).

### 7. Multa e juros derivados por função pura, materializados só no recebimento

**Decisão:** um módulo puro `pagamentos/domain/charge-math.ts` expõe `penaltyFor(original, penaltyPercent)` e `interestFor(original, monthlyPercent, daysLate)`, com `interest = original × monthlyPercent / 30 × daysLate`, arredondado a centavos por `Money`. `Charge` não persiste multa nem juros enquanto está em aberto; `ChargeService.amountsDueAt(charge, referenceDate)` devolve `{ original, penalty, interest, totalDue }`. No recebimento, os valores calculados **para a data do recebimento** são gravados em `charge_receipts` (`penalty_amount`, `interest_amount`) como registro histórico imutável.

**Racional:** o valor devido é função do tempo — persistir uma multa "atual" exigiria reescrever a linha todo dia. A regra de 30 dias e proporcional por dia é o que reproduz o critério do backlog (R$ 1.500 + R$ 30 + R$ 2,50 = R$ 1.532,50 com 5 dias de atraso). Materializar no recebimento congela o que de fato foi cobrado.

**Alternativa considerada:** juros compostos ou base 365 dias. Rejeitada por contrariar o exemplo numérico documentado, que é o critério de aceite.

**Consequência declarada:** o total devido muda de um dia para o outro. O recebimento por isso **exige a data de recebimento** e valida o valor contra o total daquela data — não contra `Date.now()` (ver risco de fuso).

### 8. Liquidação: serviço de domínio puro, escrita atômica no controller

**Decisão:** `ChargeReceiptService` e `PayableSettlementService` copiam a assinatura de `InvoicePaymentService.pay()` — recebem os agregados já hidratados (`charge`/`payable`, `account`), validam empresa, conta ativa, moeda, saldo e valor, constroem a `Transaction` confirmada, transicionam o agregado e **devolvem** `{ charge, payment, receiptId, amount, penalty, interest, receivedAt, events }`. Não recebem repositório e não abrem transação de banco.

O controller então faz, exatamente como `invoice-controller.pay()`:

```
await transactionRepository.runAtomic(async (executor) => {
  await transactionRepository.create(payment, executor);
  await accountRepository.applyMovement(companyId, { …, direction: "CREDIT" }, executor);
  await chargeRepository.update(charge, executor);          // guardada por status
  await chargeRepository.registerReceipt({ … }, executor);
});
```

**Racional:** era isto que o código já fazia e eu havia descrito ao contrário. Serviço puro é testável sem banco (é assim que `invoice-services.test.ts` roda) e mantém `runAtomic` num lugar só — o controller —, em vez de espalhar controle transacional pelo domínio.

### 9. Duplicidade de liquidação barrada por UPDATE condicional, não por lock

**Decisão:** `ChargeRepository.update(charge, executor)` emite `update charges set … where id = ? and company_id = ? and status in ('ISSUED','OVERDUE')` e **exige `rowCount === 1`**; se vier zero, lança e o `runAtomic` desfaz tudo. O mesmo em `PayableRepository.update()` e nas transições do scheduler.

**Racional:** dois recebimentos simultâneos da mesma cobrança criariam duas transações de receita — e, diferente do estouro de limite do cartão (que o mundo real tolera), receber duas vezes é corrupção de dado. O `UPDATE` condicional resolve isso sem manter lock: no Postgres, o segundo `UPDATE` só enxerga a linha depois do commit do primeiro, encontra `status = 'PAID'` e casa zero linhas. É mais barato que `SELECT … FOR UPDATE`, não segura recurso durante a criação da transação e vale igualmente para a passada do scheduler.

**Alternativa considerada:** `SELECT … FOR UPDATE` na cobrança, como `knex-card-repository.committedAmount({ lockForUpdate })` faz no cartão. Rejeitada aqui: o cartão precisa do lock porque lê um agregado (soma de compras) que não cabe em uma cláusula `where`; a cobrança tem a condição toda em uma coluna de estado. O pagamento de fatura da Fase 2 hoje não tem nem uma coisa nem outra — a guarda por status fecha essa lacuna sem reescrever a Fase 2.

### 10. Máquinas de estado de `Charge` e `Payable` são simétricas e sem estado parcial

**Decisão:** `Charge`: Issued → Paid | Overdue | Cancelled; Overdue → Paid | Cancelled. `Payable`: Pending → Paid | Overdue | Cancelled; Overdue → Paid | Cancelled. Paid e Cancelled são finais. As transições vivem no agregado (`markOverdue`, `registerReceipt`/`registerPayment`, `cancel`), retornam `Result<T>` e levantam eventos via `raiseEvent()`.

**Racional:** é literalmente a tabela de `docs/docs/maquinas-estado.md` para Cobrança, e a conta a pagar é a mesma obrigação na direção oposta — manter as duas simétricas torna a passada do scheduler e os testes praticamente espelhados.

### 11. Detecção de vencidos: sexta passada do scheduler, idempotente pelo estado

**Decisão:** uma passada nova em `src/scheduler.ts` varre `chargeRepository.findOverdueCandidates(referenceDate)` e `payableRepository.findOverdueCandidates(referenceDate)` e chama `markOverdue(referenceDate)`. Uma segunda execução no mesmo dia encontra o agregado já em Overdue, recebe `Result.failed` e segue sem publicar evento. Cada registro é processado em seu próprio `try/catch`, como já é feito com faturas.

**Racional:** exatamente a decisão 6 da Fase 2 — a idempotência sai da máquina de estados, sem tabela de controle de job.

### 12. PIX é um registro, com tabela própria em vez de colunas em `transactions`

**Decisão:** `pix_payments` (`id`, `company_id`, `transaction_id`, `direction`, `pix_key`, `person_id?`, `bank_account_id?`, `charge_id?`, `occurred_at`). O envio cria a transação de despesa confirmada e a linha de PIX; o recebimento cria a transação de receita e, quando vinculado a uma cobrança, delega ao `ChargeReceiptService` para que exista **uma** transação, não duas. Nenhuma coluna nova em `transactions`.

**Racional:** `payment_method`/`pix_key` em `transactions` seriam nulos em quase toda linha e abririam precedente para a tabela virar depósito de campos de meio de pagamento (boleto, TED, cartão…). Uma tabela satélite mantém `transactions` estável e dá lugar natural para o comprovante quando houver integração.

**Consequência:** listar "transações por meio de pagamento" exige um join. É uma consulta secundária, não está nas specs desta fase.

### 13. Orçamento ganha dimensão sem quebrar os existentes

**Decisão:** `budgets` recebe a coluna nullable `cost_center_id`. A invariante passa a ser "pelo menos uma dimensão informada", satisfeita por todo orçamento já existente (todos têm categoria). A regra de não-duplicidade continua **onde já está hoje**: na checagem da aplicação antes de criar, agora comparando a combinação (`categoryId`, `costCenterId`, período) em vez de só a categoria. Nenhuma restrição de unicidade nova no banco.

**Racional:** verificado na migration `20240101000006`: `budgets` **não tem** índice único — só o índice comum `budgets_category_status_idx`. A duplicidade descrita na spec da Fase 2 sempre foi barrada em código. Acrescentar agora um índice único (que, com coluna nullable, exigiria expressão com `COALESCE` para que dois orçamentos "categoria X, sem centro de custo" colidissem) endureceria uma regra da Fase 2 dentro de uma mudança da Fase 3, e poderia quebrar o deploy se houver duplicata já gravada. Fica como possível endurecimento futuro, com backfill próprio.

`BudgetRepository.actualAmount()` ganha os filtros de centro de custo (com descida na árvore por `CostCenterHierarchy`) ao lado da descida de categoria que já existe.

### 14. Schema: uma migration nova, nenhuma existente editada

**Decisão:** `20240101000007_create_phase3_tables.ts`, criando:

- `people` — `id`, `company_id`, `name`, `person_type`, `document`, `email`, `phone`, `address` (jsonb), `is_active`, timestamps; único em (`company_id`, `document`)
- `person_roles` — `person_id`, `role`, `created_at`; PK composta (`person_id`, `role`)
- `person_bank_accounts` — `id`, `company_id`, `person_id`, `label`, `pix_key`, `pix_key_type`, `bank`, `branch`, `account_number`, `is_default`, timestamps
- `cost_centers` — `id`, `company_id`, `parent_id`, `name`, `description`, `is_active`, timestamps; único em (`company_id`, `parent_id`, `name`)
- `charges` — `id`, `company_id`, `person_id`, `amount(15,2)`, `currency`, `due_date`, `issue_date`, `description`, `penalty_percent(5,2)`, `monthly_interest_percent(5,2)`, `status`, `external_reference`, `cancel_reason`, `cancelled_at`, `paid_at`, timestamps
- `charge_receipts` — `id`, `charge_id`, `transaction_id`, `account_id`, `amount(15,2)`, `penalty_amount(15,2)`, `interest_amount(15,2)`, `received_at`
- `payables` — `id`, `company_id`, `person_id`, `category_id`, `cost_center_id`, `amount(15,2)`, `currency`, `due_date`, `competence_date`, `description`, `document_number`, `status`, `cancel_reason`, `cancelled_at`, `paid_at`, timestamps
- `payable_payments` — `id`, `payable_id`, `transaction_id`, `account_id`, `amount(15,2)`, `paid_at`
- `pix_payments` — conforme a decisão 12
- `transactions`: colunas nullable `cost_center_id` e `person_id`, com FK
- `budgets`: coluna nullable `cost_center_id`, com FK
- Índices: `charges(company_id, status, due_date)`, `charges(company_id, person_id, status)`, `payables(company_id, status, due_date)`, `payables(company_id, person_id, status)`, `transactions(company_id, cost_center_id, status, date)`, `people(company_id, is_active)`

**Racional:** `decimal(15,2)`, `defaultTo(gen_random_uuid())` e o `down()` na ordem inversa seguem o padrão das migrations existentes. Os índices de `charges`/`payables` sustentam a varredura diária do scheduler e os relatórios; o índice de `cost_center_id` em `transactions` sustenta o relatório e o filtro do dashboard pela nova dimensão.

**Nota:** `external_reference` em `charges` já nasce reservado para o identificador do boleto quando a integração existir — coluna nullable, sem uso nesta fase.

### 15. Rotas

Dois plugins novos em `src/routes/`, registrados em `registerRoutes()` sob `/api/v1`:

| Arquivo | Prefixo | Endpoints |
|---|---|---|
| `registration-routes.ts` | `/people` | `POST /`, `GET /`, `GET /:personId`, `PUT /:personId`, `DELETE /:personId` (inativa) |
| | `/people/:personId/roles` | `POST /`, `DELETE /:role` |
| | `/people/:personId/bank-accounts` | `POST /`, `GET /`, `PUT /:bankAccountId`, `DELETE /:bankAccountId` |
| | `/customers` | `GET /`, `GET /:personId/ledger` |
| | `/suppliers` | `GET /`, `GET /:personId/ledger` |
| | `/cost-centers` | `POST /`, `GET /` (árvore), `GET /:costCenterId`, `PUT /:costCenterId`, `DELETE /:costCenterId` (inativa) |
| `payment-routes.ts` | `/charges` | `POST /`, `GET /`, `GET /:chargeId`, `PUT /:chargeId`, `POST /:chargeId/receipts`, `POST /:chargeId/cancel` |
| | `/payables` | `POST /`, `GET /`, `GET /:payableId`, `PUT /:payableId`, `POST /:payableId/payments`, `POST /:payableId/cancel` |
| | `/pix` | `POST /send`, `POST /receive` |

`/reports/:type` ganha `by-cost-center`, `receivables` e `payables`; `/dashboard` ganha os dois resumos novos e o filtro `costCenterIds`. Todas as rotas protegidas por `authenticate`, com `companyId` vindo de `getCompanyId(request)` — nunca do cliente.

## Risks / Trade-offs

- **Total devido muda com a data, e o servidor compara em UTC** → um recebimento lançado à noite em UTC-3 pode calcular um dia a mais de juros. Mitigação: o endpoint exige `receivedAt` explícito e valida o valor contra o total daquela data; a diferença fica sob controle de quem lança. Mesma limitação já assumida no fechamento de fatura.
- **Arredondamento de juros proporcionais** → `original × pct / 30 × dias` produz frações de centavo. Mitigação: arredondar apenas no resultado final via `Money`, com teste do caso do backlog (R$ 2,50 exatos) e de um caso com dízima.
- **Recebimento duplicado sob concorrência** → dois requests simultâneos. Mitigação: `UPDATE` guardado por status exigindo `rowCount === 1` dentro do `runAtomic` (decisão 9); o segundo request casa zero linhas e o `runAtomic` desfaz a transação de receita que ele havia criado.
- **Remoção de papel e inativação de pessoa dependem de dados de outro contexto** → `cadastros` precisa saber de cobranças abertas. Mitigação: o fato é calculado no controller e passado ao domínio como parâmetro (decisão 5); nenhum import de `pagamentos` em `cadastros`.
- **Sem quitação parcial** → um cliente que paga metade não tem como ser registrado. Mitigação declarada: emitir duas cobranças, ou cancelar e reemitir. Se virar necessidade real, entra como mudança própria acrescentando o estado "Parcialmente Paga" às três máquinas (cobrança, conta a pagar e o que a fatura já faz).
- **Refactor de `CategoryHierarchy` em código já em produção sem teste dedicado** → a extração da base genérica (decisão 4) toca uma classe usada em seis arquivos das Fases 1 e 2. Mitigação: a herança preserva a API pública, então nenhum call site muda; o passo só é dado por concluído com `npm run typecheck` e `npm test` verdes **e** zero alterações nos consumidores. Como não há `category-hierarchy.test.ts`, a extração vem acompanhada de um teste novo da base (`tree-hierarchy.test.ts`) cobrindo ciclo, profundidade e BFS — o que também tapa um buraco de cobertura que já existia.
- **Duplicidade de orçamento continua sem garantia no banco** → a regra é aplicada só em código, e uma escrita concorrente pode criar dois orçamentos iguais. Mitigação: é o comportamento que a Fase 2 já tem — esta fase não regride nada, apenas estende a checagem para a nova dimensão. O endurecimento com índice único fica registrado como dívida, com backfill próprio (decisão 13).
- **Scheduler cresce para seis passadas em um único processo** → uma passada lenta atrasa as demais. Mitigação: cada passada já é independente e loga seu total; se o tempo do batch incomodar, a separação em jobs distintos é mecânica e não muda domínio.

## Migration Plan

1. Aplicar `npm run db:migrate` — a migration é puramente aditiva (tabelas novas + colunas nullable), sem backfill e sem downtime.
2. Os dois passos de refactor sobre código existente — mover `Email`/`CPF`/`CNPJ` para `shared/domain` (com re-export em `identity/domain/index.ts`) e extrair `TreeHierarchy<T>` — são puramente internos e vão antes de qualquer código novo. Critério de aceite dos dois: `npm run typecheck` e `npm test` verdes sem que nenhum arquivo consumidor precise mudar.
3. Deploy da API: as rotas novas não alteram nenhum contrato existente. `/dashboard` e `/reports` ganham campos e valores de `type` novos, ambos aditivos — clientes das Fases 1 e 2 seguem funcionando.
4. Atualizar o cron do `scheduler` não é necessário — a sexta passada roda no mesmo binário já agendado.
5. **Rollback:** `npm run db:migrate:rollback` reverte o batch (drop das tabelas novas e das colunas adicionadas). Nenhum dado das Fases 1 e 2 é alterado ou migrado, então o rollback é seguro; perde-se apenas o que foi criado na Fase 3.

## Open Questions

- **Moeda da cobrança e da conta a pagar:** nascem na moeda da empresa, como o restante da Fase 3. Cobrança em moeda estrangeira só faz sentido junto com a multimoeda da Fase 4 — não muda specs nem estrutura de tarefas.
- **Endereço da pessoa como `jsonb`:** guardado como objeto (`street`, `number`, `complement`, `district`, `city`, `state`, `zipCode`) sem validação de CEP. Se o endereço virar critério de busca ou de emissão fiscal, vira tabela própria.
