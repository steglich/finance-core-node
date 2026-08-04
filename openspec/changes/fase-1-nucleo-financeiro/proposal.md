## Why

O Finance Core precisa de seu núcleo funcional — sem ele, não há base para nenhuma das fases posteriores (Gestão Financeira, Gestão Empresarial, Patrimônio e Investimentos). O projeto atualmente possui apenas um servidor HTTP mínimo (`AppServer`) sem qualquer lógica de domínio, entidades ou endpoints. Implementar a Fase 1 estabelece o alicerce sobre o qual todas as funcionalidades futuras serão construídas.

## What Changes

- **Novo módulo Identity**: Registro e autenticação de usuários, criação e gestão de empresas, definição de perfis com permissões granulares, convite e remoção de usuários da empresa, alternância entre empresas sem reautenticação.
- **Novo módulo Financeiro — Contas**: Criação, edição e inativação de contas financeiras vinculadas a carteiras (instituições). Saldo derivado das transações (nunca editável diretamente), suporte a múltiplas moedas com código ISO 4217.
- **Novo módulo Financeiro — Categorias**: Classificação hierárquica infinita (categoria pai e subcategorias) com tipo (Despesa/Receita), cor e ícone.
- **Novo módulo Financeiro — Transações**: Registro de despesas e receitas com valor bruto, desconto, acréscimos, valor líquido, data, competência, descrição, tags, anexos. Suporte a transações parceladas com geração de N parcelas de vida independente. Edição, cancelamento e estorno seguindo invariantes de domínio.
- **Novo módulo Financeiro — Transferências**: Movimentação atômica entre duas contas com débito e crédito vinculados, validação de saldo, suporte a moedas diferentes com taxa de câmbio registrada.
- **Novo módulo Financeiro — Recorrências**: Configuração de transações recorrentes com periodicidades variadas (diária a anual), data fim ou número máximo de ocorrências, pausa e cancelamento.
- **Novo módulo Auditoria**: Registro imutável de eventos de domínio (TransactionPosted, TransferCompleted, etc.) e histórico de alterações em entidades (timestamp, usuário, entidade, operação, dados anteriores e novos). Logs de acesso.
- **Serviços de domínio**: TransferênciaService (atomicidade), ParcelamentoService (geração de parcelas), RecorrênciaService (geração de transações futuras), ConciliaçãoSaldoService (reconciliação).
- **Regras de negócio implementadas**: RN-01 (rastreabilidade, soft delete), RN-02 (saldo derivado), RN-03 (transação vinculada a conta), RN-04 (atomicidade de transferências), RN-05 (parcelas com vida própria), RN-06 (categorias não alteram comportamento financeiro), RN-07 (transações multimoeda com taxa de câmbio), RN-09 (auditoria de alterações).
- **Máquinas de estado**: Transação (Pendente → Confirmada → Estornada / Cancelada) e Parcela (Pendente → Paga / Atrasada → Paga).

## Capabilities

### New Capabilities

- **identity**: Registro de usuários, autenticação (email/senha), criação e gestão de empresas, perfis com permissões granulares, convite e remoção de usuários, alternância entre empresas. Cobre RF-IDENTITY-001 a RF-IDENTITY-009.
- **contas-financeiras**: Criação, edição e inativação de contas vinculadas a carteiras/instituições. Saldo derivado e reconciliável. Suporte multimoeda base (ISO 4217). Cobre RF-FIN-001 a RF-FIN-003.
- **categorias**: Categorias hierárquicas infinitas com tipo (Despesa/Receita), cor e ícone para classificação de transações. Cobre RF-FIN-004.
- **transacoes**: Registro de despesas e receitas com valor bruto, desconto, acréscimos, valor líquido, tags, anexos. Edição, cancelamento e estorno com máquina de estados. Cobre RF-FIN-005 a RF-FIN-010.
- **transferencias**: Transferências atômicas entre contas com débito/crédito vinculados, validação de saldo e suporte multimoeda com taxa de câmbio. Cobre RF-FIN-011 a RF-FIN-014.
- **parcelamentos**: Geração de N parcelas a partir de transação parcelada, pagamento individual, edição de vencimento, vida própria de cada parcela. Cobre RF-FIN-015 a RF-FIN-017.
- **recorrencias**: Configuração de recorrências com 7 periodicidades, data fim ou número máximo de ocorrências, pausa e cancelamento. Cobre RF-FIN-018 a RF-FIN-020.
- **auditoria**: Registro de eventos de domínio, histórico de alterações em entidades e logs de acesso. Imutável e append-only. Cobre RF-AUD-001 a RF-AUD-003 e RF-AUD-006.

### Modified Capabilities

<!-- Nenhum — este é o primeiro conjunto de capacidades do projeto. -->

## Impact

- **Código novo**: 8 módulos de domínio + camada de infraestrutura (persistência) + camada de API (rotas HTTP)
- **Dependências**: Nenhuma dependência externa nova sem aprovação prévia. A stack atual (`tsx`, `tsc`, `node`) é suficiente.
- **Estrutura**: Expansão de `src/` com diretórios por bounded context (`identity/`, `financeiro/`, `auditoria/`), cada um com subcamadas (`domain/`, `infrastructure/`, `api/`)
- **Dados**: Primeiro uso de persistência no projeto (a definir: banco de dados e ORM/query builder)
- **Segurança**: Hash de senhas (bcrypt/argon2), HTTPS, isolamento multi-tenant por empresa
- **Fases futuras**: Fase 2 (Cartões, Faturas, Orçamentos, Metas, Dashboard, Relatórios) depende diretamente desta fase
