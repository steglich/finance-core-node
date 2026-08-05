## ADDED Requirements

### Requirement: Transaction Counterparty
The system SHALL allow a transaction to reference a person of the same company as its counterparty — the customer money came from, or the supplier or payee it went to. The reference is optional and MUST NOT change the amount, the balance effect or the state machine of the transaction. When a transaction is created by the settlement of a charge or of a payable, the counterparty SHALL be set automatically from that record and MUST NOT be edited afterwards.

#### Scenario: Expense with a supplier
- **WHEN** a user registers an expense selecting supplier "Fornecedor XYZ" as the counterparty
- **THEN** the system stores the person reference on the transaction and the amount and balance effect are unchanged

#### Scenario: Counterparty of another company
- **WHEN** a user attempts to reference a person that belongs to a different company
- **THEN** the system rejects the transaction

#### Scenario: Counterparty set by a settlement
- **WHEN** the settlement of a payable creates its expense transaction
- **THEN** the transaction carries the payable's supplier as counterparty and that reference cannot be edited

#### Scenario: Transaction without counterparty
- **WHEN** a user registers a transaction without selecting a person
- **THEN** the system accepts it, since the counterparty is optional

## MODIFIED Requirements

### Requirement: Register Expense Transaction
The system SHALL allow users to register expense transactions with at minimum: amount, account, category, and date. Optional fields include: description, discount, tags, attachments, cost center, counterparty person, competence date, and the card the expense is charged to. When a cost center is informed it MUST belong to the same company and MUST be active. The system SHALL calculate the net amount as: gross amount - discount + interest + penalty.

#### Scenario: Simple expense
- **WHEN** a user registers an expense of R$ 150,00 in account "Conta Corrente", category "Alimentação > Mercado", on today's date
- **THEN** the system creates a transaction with status "Pending", gross amount R$ 150,00, and net amount R$ 150,00

#### Scenario: Expense with discount
- **WHEN** a user registers an expense of R$ 200,00 with a R$ 20,00 discount
- **THEN** the system creates a transaction with gross amount R$ 200,00, discount R$ 20,00, and net amount R$ 180,00

#### Scenario: Expense charged to a card
- **WHEN** a user registers an expense of R$ 500,00 specifying a card
- **THEN** the system stores the card reference on the transaction

#### Scenario: Expense with a cost center
- **WHEN** a user registers an expense of R$ 150,00 selecting the active cost center "Marketing"
- **THEN** the system stores the cost center on the transaction and the net amount is unchanged

#### Scenario: Expense with an inactive cost center
- **WHEN** a user attempts to register an expense selecting an inactive cost center
- **THEN** the system rejects the transaction with a validation error

### Requirement: Register Income Transaction
The system SHALL allow users to register income transactions following the same structure as expenses, with the amount representing money received. Income transactions MAY also carry a cost center and a counterparty person, under the same validation rules as expenses.

#### Scenario: Income transaction
- **WHEN** a user registers an income of R$ 5.000,00 in account "Conta Corrente", category "Salário", on today's date
- **THEN** the system creates an income transaction with status "Pending"

#### Scenario: Income with a customer as counterparty
- **WHEN** a user registers an income of R$ 1.500,00 selecting customer "João Silva" as the counterparty
- **THEN** the system stores the person reference on the income transaction

### Requirement: Edit Pending Transaction
The system SHALL allow editing of pending transactions only. Editable fields include: amount, category, cost center, counterparty person, date, description, discount, tags, and attachments. The system SHALL register audit entries for every edit. A transaction already linked to a closed invoice MUST NOT be edited, regardless of its own status; removing such a charge SHALL be done through a refund. A transaction created by the settlement of a charge or of a payable MUST NOT be edited — it is confirmed at creation and is owned by that record.

#### Scenario: Edit pending transaction amount
- **WHEN** a user changes the amount of a pending transaction from R$ 100,00 to R$ 120,00
- **THEN** the system updates the amount and records an audit entry

#### Scenario: Cannot edit confirmed transaction
- **WHEN** a user attempts to edit a confirmed transaction
- **THEN** the system rejects the edit

#### Scenario: Cannot edit a billed transaction
- **WHEN** a user attempts to edit a transaction linked to a closed invoice
- **THEN** the system rejects the edit and offers "Refund" as the available action

#### Scenario: Change the cost center of a pending transaction
- **WHEN** a user changes the cost center of a pending transaction to another active cost center of the company
- **THEN** the system updates the classification and records an audit entry
