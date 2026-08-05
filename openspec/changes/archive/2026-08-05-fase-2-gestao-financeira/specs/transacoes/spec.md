## ADDED Requirements

### Requirement: Transaction Charged to a Card
The system SHALL allow an expense transaction to reference a card of the same company. When the card is of type CREDIT, the transaction MUST NOT affect the balance of the bound account at registration time and MUST be linked to the open invoice of the corresponding cycle; the balance is affected only when that invoice is paid. When the card is of type DEBIT, the transaction SHALL affect the bound account's balance as any other expense. The referenced card MUST be active.

#### Scenario: Purchase on a credit card
- **WHEN** a user registers an expense of R$ 500,00 referencing an active credit card
- **THEN** the system links the transaction to the card's open invoice, leaves the account balance unchanged, and reduces the card's available limit by R$ 500,00

#### Scenario: Purchase on a debit card
- **WHEN** a user registers an expense of R$ 120,00 referencing a debit card and confirms it
- **THEN** the system debits the bound account as with any other expense

#### Scenario: Purchase on an inactive card
- **WHEN** a user attempts to register an expense referencing an inactive card
- **THEN** the system rejects the transaction

#### Scenario: Card of another company
- **WHEN** a user attempts to register an expense referencing a card of a different company
- **THEN** the system rejects the transaction

## MODIFIED Requirements

### Requirement: Edit Pending Transaction
The system SHALL allow editing of pending transactions only. Editable fields include: amount, category, date, description, discount, tags, and attachments. The system SHALL register audit entries for every edit. A transaction already linked to a closed invoice MUST NOT be edited, regardless of its own status; removing such a charge SHALL be done through a refund.

#### Scenario: Edit pending transaction amount
- **WHEN** a user changes the amount of a pending transaction from R$ 100,00 to R$ 120,00
- **THEN** the system updates the amount and records an audit entry

#### Scenario: Cannot edit confirmed transaction
- **WHEN** a user attempts to edit a confirmed transaction
- **THEN** the system rejects the edit

#### Scenario: Cannot edit a billed transaction
- **WHEN** a user attempts to edit a transaction linked to a closed invoice
- **THEN** the system rejects the edit and offers "Refund" as the available action

### Requirement: Register Expense Transaction
The system SHALL allow users to register expense transactions with at minimum: amount, account, category, and date. Optional fields include: description, discount, tags, attachments, cost center, competence date, and the card the expense is charged to. The system SHALL calculate the net amount as: gross amount - discount + interest + penalty.

#### Scenario: Simple expense
- **WHEN** a user registers an expense of R$ 150,00 in account "Conta Corrente", category "Alimentação > Mercado", on today's date
- **THEN** the system creates a transaction with status "Pending", gross amount R$ 150,00, and net amount R$ 150,00

#### Scenario: Expense with discount
- **WHEN** a user registers an expense of R$ 200,00 with a R$ 20,00 discount
- **THEN** the system creates a transaction with gross amount R$ 200,00, discount R$ 20,00, and net amount R$ 180,00

#### Scenario: Expense charged to a card
- **WHEN** a user registers an expense of R$ 500,00 specifying a card
- **THEN** the system stores the card reference on the transaction
