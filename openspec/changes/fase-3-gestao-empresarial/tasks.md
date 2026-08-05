## 1. Refactors de Base (antes de qualquer código novo)

- [ ] 1.1 Mover `email.ts`, `cpf.ts` e `cnpj.ts` de `src/identity/domain/` para `src/shared/domain/`, ajustando os imports internos
- [ ] 1.2 Re-exportar `Email`, `CPF` e `CNPJ` em `src/identity/domain/index.ts` e em `src/shared/domain/index.ts`; validar com `npm run typecheck` e `npm test` que nenhum arquivo consumidor precisou mudar
- [ ] 1.3 Extrair `src/shared/domain/tree-hierarchy.ts` — classe genérica `TreeHierarchy<T extends { id: string; parentId: string | undefined }>` com `size`, `find`, `roots`, `childrenOf`, `ancestorsOf` (guarda de ciclo), `descendantsOf` (BFS), `depthOf`, `isDescendantOf` e `tree()`, movidos de `category-hierarchy.ts`
- [ ] 1.4 Fazer `CategoryHierarchy` estender `TreeHierarchy<Category>`, mantendo `move()` e `delete()` e **a mesma API pública**; critério de aceite: `npm run typecheck` e `npm test` verdes sem alterar nenhum dos seis arquivos que a consomem
- [ ] 1.5 Escrever `tree-hierarchy.test.ts` cobrindo ciclo em `ancestorsOf`, ordem BFS de `descendantsOf`, `depthOf`, `isDescendantOf` e montagem de `tree()` — cobertura que hoje não existe em lugar nenhum

## 2. Primitivas Novas

- [ ] 2.1 Implementar `src/shared/domain/pix-key.ts` — VO `PixKey` com `PixKeyType` (CPF, CNPJ, EMAIL, PHONE, RANDOM), inferindo o tipo pelo formato e reusando `CPF`/`CNPJ`/`Email` na validação
- [ ] 2.2 Escrever `pix-key.test.ts` cobrindo as cinco formas aceitas, chave inválida e normalização (remoção de máscara)
- [ ] 2.3 Adicionar em `DomainErrorCode` os códigos necessários ainda inexistentes para as novas regras (conferir antes de usar; não criar código redundante)

## 3. Banco de Dados

- [ ] 3.1 Criar migration `20240101000007_create_phase3_tables.ts` com `people` (id, company_id, name, person_type, document, email, phone, address jsonb, is_active, timestamps) e único em (`company_id`, `document`)
- [ ] 3.2 Adicionar `person_roles` (person_id, role, created_at) com PK composta e `person_bank_accounts` (id, company_id, person_id, label, pix_key, pix_key_type, bank, branch, account_number, is_default, timestamps)
- [ ] 3.3 Adicionar `cost_centers` (id, company_id, parent_id, name, description, is_active, timestamps) com único em (`company_id`, `parent_id`, `name`)
- [ ] 3.4 Adicionar `charges` e `charge_receipts` conforme a decisão 14 do design, incluindo `external_reference` nullable reservado para boleto
- [ ] 3.5 Adicionar `payables` e `payable_payments` conforme a decisão 14
- [ ] 3.6 Adicionar `pix_payments` (id, company_id, transaction_id, direction, pix_key, person_id, bank_account_id, charge_id, occurred_at)
- [ ] 3.7 Adicionar as colunas nullable `cost_center_id` e `person_id` em `transactions` e `cost_center_id` em `budgets`, com FKs
- [ ] 3.8 Criar os índices de consulta: `charges(company_id, status, due_date)`, `charges(company_id, person_id, status)`, `payables(company_id, status, due_date)`, `payables(company_id, person_id, status)`, `transactions(company_id, cost_center_id, status, date)`, `people(company_id, is_active)`
- [ ] 3.9 Implementar o `down()` revertendo colunas, índices e tabelas na ordem inversa; validar `npm run db:migrate` e `npm run db:migrate:rollback`

## 4. Cadastros — Pessoa (Domínio)

- [ ] 4.1 Implementar `src/cadastros/domain/person.ts` — aggregate root `Person` com `PersonType` (INDIVIDUAL/LEGAL_ENTITY) e `Person.create()` validando documento compatível com o tipo, email opcional válido e nome não vazio
- [ ] 4.2 Implementar `Person.addRole()` / `Person.removeRole(role, { openCharges, openPayables })` — papéis `CUSTOMER`/`SUPPLIER`/`PAYEE`, remoção bloqueada com registro aberto (design, decisão 5)
- [ ] 4.3 Implementar `Person.edit()` (nome, email, telefone, endereço) e `Person.deactivate({ openCharges, openPayables })`; documento e tipo imutáveis
- [ ] 4.4 Implementar `src/cadastros/domain/person-bank-account.ts` — entidade filha com `PixKey` ou banco/agência/conta, exigindo papel PAYEE e garantindo no máximo um padrão
- [ ] 4.5 Implementar `src/cadastros/domain/person-events.ts` — `PersonRegistered`
- [ ] 4.6 Escrever `person.test.ts` cobrindo os cenários de `specs/pessoas/spec.md` (documento inválido, tipo incompatível, papéis múltiplos, remoção de papel em uso, campo imutável, inativação bloqueada)

## 5. Cadastros — Centro de Custo (Domínio)

- [ ] 5.1 Implementar `src/cadastros/domain/cost-center.ts` — entidade `CostCenter` com `create()`, `edit()`, `deactivate()` e pai opcional da mesma empresa
- [ ] 5.2 Implementar `src/cadastros/domain/cost-center-hierarchy.ts` estendendo `TreeHierarchy<CostCenter>` (tarefa 1.3) — só o que é específico: limite de três níveis, guarda de reparentamento e coleta em cascata para a inativação
- [ ] 5.3 Implementar a inativação em cascata (centro de custo inativa os descendentes) e o bloqueio quando há orçamento ativo referenciando
- [ ] 5.4 Escrever `cost-center.test.ts` cobrindo os cenários de `specs/centros-de-custo/spec.md` (nome duplicado entre irmãos, mesmo nome sob pais diferentes, ciclo, profundidade máxima, cascata)

## 6. Cadastros — Infraestrutura e API

- [ ] 6.1 Criar `src/cadastros/infrastructure/person-repository.ts` — interface com `create`, `findById`, `findByDocument`, `findByCompany`, `findByRole`, `update`, e as contas bancárias
- [ ] 6.2 Implementar `knex-person-repository.ts` com filtro obrigatório por `companyId`, persistindo papéis em `person_roles`
- [ ] 6.3 Criar `cost-center-repository.ts` (interface) e `knex-cost-center-repository.ts`, com `findByCompany` carregando a árvore inteira para a `CostCenterHierarchy`
- [ ] 6.4 Implementar `src/cadastros/api/person-controller.ts` e `cost-center-controller.ts` retornando `ControllerResult`
- [ ] 6.5 Implementar `src/cadastros/api/dtos.ts` com `validateCreatePersonRequest`, `validateUpdatePersonRequest`, `validatePersonRoleRequest`, `validateBankAccountRequest`, `validateCreateCostCenterRequest`, `validateUpdateCostCenterRequest`
- [ ] 6.6 Criar `src/routes/registration-routes.ts` com os prefixos `/people`, `/customers`, `/suppliers` e `/cost-centers` (design, decisão 15) e registrá-lo em `registerRoutes()`
- [ ] 6.7 Instanciar repositórios e controllers de `cadastros` em `AppServer.build()`

## 7. Cobranças — Domínio

- [ ] 7.1 Implementar `src/pagamentos/domain/charge-math.ts` — funções puras `penaltyFor()` e `interestFor()` com juros mensais proporcionais em base 30 dias, arredondando só no resultado
- [ ] 7.2 Escrever `charge-math.test.ts` cobrindo o caso do backlog (R$ 1.500, 2%, 1% a.m., 5 dias → R$ 1.532,50), atraso zero, percentuais zerados e um caso com dízima
- [ ] 7.3 Implementar `src/pagamentos/domain/charge.ts` — aggregate root `Charge` com `ChargeStatus` (ISSUED/OVERDUE/PAID/CANCELLED) e `Charge.issue()` validando valor > 0, vencimento não anterior à emissão e percentuais entre 0 e 100
- [ ] 7.4 Implementar `Charge.markOverdue(referenceDate)`, `Charge.registerReceipt(amount, receivedAt)` (rejeita valor diferente do total devido na data) e `Charge.cancel(reason)` (motivo obrigatório)
- [ ] 7.5 Implementar `Charge.edit()` — permitido apenas em ISSUED, sobre valor, vencimento, descrição e percentuais
- [ ] 7.6 Implementar `src/pagamentos/domain/charge-service.ts` — `amountsDueAt(charge, date)` devolvendo `{ original, penalty, interest, totalDue }`
- [ ] 7.7 Implementar `src/pagamentos/domain/charge-events.ts` — `ChargeIssued`, `ChargePaid`, `ChargeOverdue`, `ChargeCancelled`
- [ ] 7.8 Escrever `charge.test.ts` cobrindo a máquina de estados de `specs/cobrancas/spec.md`, incluindo as transições proibidas (sair de PAID ou CANCELLED) e o recebimento parcial rejeitado

## 8. Contas a Pagar — Domínio

- [ ] 8.1 Implementar `src/pagamentos/domain/payable.ts` — aggregate root `Payable` com `PayableStatus` (PENDING/OVERDUE/PAID/CANCELLED) e `Payable.register()` validando valor > 0 e categoria de despesa; vencimento passado é aceito
- [ ] 8.2 Implementar `Payable.markOverdue(referenceDate)`, `Payable.registerPayment(amount, paidAt)` (valor deve ser igual ao total) e `Payable.cancel(reason)`
- [ ] 8.3 Implementar `Payable.edit()` — permitido apenas em PENDING, sobre valor, vencimento, categoria, centro de custo e descrição
- [ ] 8.4 Implementar `src/pagamentos/domain/payable-events.ts` — `PayableRegistered`, `PayablePaid`, `PayableOverdue`
- [ ] 8.5 Escrever `payable.test.ts` cobrindo a máquina de estados de `specs/contas-a-pagar/spec.md`, incluindo baixa parcial rejeitada e edição de conta já paga

## 9. Liquidação — Serviços de Domínio

- [ ] 9.1 Implementar `src/pagamentos/domain/charge-receipt-service.ts` como **serviço puro**, na assinatura de `InvoicePaymentService.pay()` — recebe `{ charge, account, amount, receivedAt }`, valida empresa/conta ativa/moeda/valor igual ao total devido na data, constrói a transação de receita confirmada, transiciona a cobrança e devolve `{ charge, payment, receiptId, amount, penalty, interest, receivedAt, events }`. Não recebe repositório e não abre transação de banco
- [ ] 9.2 Implementar `src/pagamentos/domain/payable-settlement-service.ts` no mesmo formato puro — valida conta ativa e saldo suficiente, constrói a transação de despesa herdando categoria, centro de custo e fornecedor, transiciona a conta a pagar e devolve as peças
- [ ] 9.3 Escrever `settlement-services.test.ts` sem banco (como `invoice-services.test.ts`), cobrindo recebimento no prazo, recebimento vencido com encargos, valor divergente, conta inativa, moeda divergente e saldo insuficiente

## 10. Pagamentos — Infraestrutura

- [ ] 10.1 Criar `charge-repository.ts` (interface) com `create`, `findById`, `findByCompany` (filtros de cliente, status e intervalo de vencimento), `update`, `findOverdueCandidates(date)`, `hasOpenCharges(personId)`, `registerReceipt`
- [ ] 10.2 Implementar `knex-charge-repository.ts` com filtro obrigatório por `companyId`; `update()` aceita `executor` e emite `UPDATE ... WHERE id = ? AND company_id = ? AND status IN (...)`, exigindo `rowCount === 1` e lançando caso contrário (design, decisão 9)
- [ ] 10.3 Criar `payable-repository.ts` (interface) e `knex-payable-repository.ts` com os equivalentes, incluindo o `update()` guardado por status, `hasOpenPayables(personId)` e ordenação por vencimento
- [ ] 10.4 Implementar `knex-ledger-repository.ts` — `customerLedger()` e `supplierLedger()` agregando em SQL e aplicando a mesma fórmula de multa e juros da tarefa 7.1
- [ ] 10.5 Implementar `knex-pix-repository.ts` — persistência de `pix_payments`
- [ ] 10.6 Estender `knex-transaction-repository.ts` para persistir e ler `cost_center_id` e `person_id`

## 11. Pagamentos — API e Rotas

- [ ] 11.1 Implementar `src/pagamentos/api/charge-controller.ts` (emitir, listar, consultar, editar, receber, cancelar); o recebimento faz `transactionRepository.runAtomic()` chamando `create(payment)`, `accountRepository.applyMovement(CREDIT)`, `chargeRepository.update()` e `registerReceipt()`, espelhando `invoice-controller.pay()`
- [ ] 11.2 Implementar `src/pagamentos/api/payable-controller.ts` (registrar, listar, consultar, editar, baixar, cancelar); a baixa faz o `runAtomic` equivalente com `applyMovement(DEBIT)`
- [ ] 11.3 Implementar `src/pagamentos/api/pix-controller.ts` — `send` e `receive`, delegando ao `ChargeReceiptService` quando o recebimento informa uma cobrança (uma transação, não duas)
- [ ] 11.4 Implementar `src/pagamentos/api/dtos.ts` com a validação manual de todos os requests acima, incluindo `receivedAt`/`paidAt` obrigatórios
- [ ] 11.5 Criar `src/routes/payment-routes.ts` com `/charges`, `/payables` e `/pix`, registrá-lo em `registerRoutes()` e instanciar tudo em `AppServer.build()`
- [ ] 11.6 Implementar os endpoints de ficha em `registration-routes.ts` (`/customers/:personId/ledger`, `/suppliers/:personId/ledger`) consumindo o `knex-ledger-repository`

## 12. Integração com Transações e Orçamentos

- [ ] 12.1 Estender `Transaction` com `costCenterId?` e `personId?` em `TransactionProps`, `CreateTransactionInput` e `toJSON()`
- [ ] 12.2 Validar no `transaction-controller` que o centro de custo existe, é da empresa e está ativo, e que a pessoa é da empresa
- [ ] 12.3 Bloquear a edição de transações originadas de liquidação de cobrança ou de conta a pagar (`specs/transacoes/spec.md`, "Edit Pending Transaction")
- [ ] 12.4 Estender `Budget` com `costCenterId?` e a invariante "pelo menos uma dimensão", ajustando `Budget.create()` e bloqueando a edição de dimensão
- [ ] 12.5 Estender `BudgetRepository.actualAmount()` para filtrar também por centro de custo, descendo a árvore com `CostCenterHierarchy`
- [ ] 12.6 Atualizar `budget-controller` e os DTOs de orçamento para aceitar `costCenterId`
- [ ] 12.7 Estender a checagem de duplicidade de orçamento (hoje em código, não no banco) para comparar a combinação `categoryId` + `costCenterId` + período
- [ ] 12.8 Escrever/atualizar testes de orçamento cobrindo os cenários novos de `specs/orcamentos/spec.md` (dimensão por centro de custo, ambas as dimensões, duplicata pela combinação)

## 13. Scheduler

- [ ] 13.1 Adicionar a passada de cobranças vencidas em `src/scheduler.ts` — varre `findOverdueCandidates`, chama `markOverdue`, persiste pelo `update()` guardado por status e publica `ChargeOverdue`, com `try/catch` por registro
- [ ] 13.2 Adicionar a passada de contas a pagar vencidas, no mesmo padrão
- [ ] 13.3 Incluir `overdueCharges` e `overduePayables` no log final da passada e atualizar o comentário de cabeçalho do arquivo
- [ ] 13.4 Escrever teste cobrindo a idempotência: uma segunda execução no mesmo dia não transiciona nem publica de novo

## 14. Dashboard e Relatórios

- [ ] 14.1 Estender `knex-reporting-repository.ts` com `receivablesSummary()` e `payablesSummary()` para o período, incluindo encargos das vencidas
- [ ] 14.2 Estender o `dashboard-controller` com os dois resumos e com o filtro `costCenterIds` (patrimônio líquido permanece sem o filtro, conforme `specs/dashboard/spec.md`)
- [ ] 14.3 Implementar o relatório `by-cost-center` com rollup dos filhos no pai e agrupamento "Sem classificação"
- [ ] 14.4 Implementar os relatórios `receivables` e `payables` com seus filtros e totais
- [ ] 14.5 Garantir que os quatro relatórios novos funcionem na exportação CSV existente
- [ ] 14.6 Escrever testes de relatório cobrindo os cenários novos de `specs/relatorios/spec.md` e `specs/dashboard/spec.md`

## 15. Auditoria e Fechamento

- [ ] 15.1 Registrar os eventos novos (`PersonRegistered`, `ChargeIssued`, `ChargePaid`, `ChargeOverdue`, `ChargeCancelled`, `PayableRegistered`, `PayablePaid`, `PayableOverdue`) nos handlers de auditoria, no `AppServer` e no `scheduler`
- [ ] 15.2 Garantir registro de auditoria em criação, edição, mudança de estado e inativação de pessoa, centro de custo, cobrança e conta a pagar (RN-09)
- [ ] 15.3 Adicionar ao catálogo `docs/docs/eventos-dominio.md` os eventos novos, com payload, produtor e consumidores, e atualizar a tabela-resumo
- [ ] 15.4 Escrever testes de API de ponta a ponta em `src/pagamentos/api/api.test.ts` e `src/cadastros/api/api.test.ts` cobrindo os fluxos principais, o isolamento por empresa e a **dupla liquidação**: o segundo recebimento da mesma cobrança casa zero linhas no `update` guardado, o `runAtomic` desfaz tudo e nenhuma segunda transação de receita fica gravada
- [ ] 15.5 Rodar `npm run typecheck`, `npm test` e `npm run build`; corrigir o que aparecer
- [ ] 15.6 Revisar cada spec da mudança contra o implementado e ajustar o que divergir antes de arquivar
