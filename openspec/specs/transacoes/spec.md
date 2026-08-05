# Transacoes Specification

## Purpose

Core financial transaction recording with support for expenses, income, adjustments, and installment purchases, following a strict state machine and domain invariants.

## Requirements

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

### Requirement: Transaction State Machine
The system SHALL enforce a transaction lifecycle with the following states and transitions: Pending → Confirmed, Pending → Cancelled, Confirmed → Refunded. Transitions to Cancelled or Refunded from any other state MUST be rejected. The system SHALL publish domain events for each state change.

#### Scenario: Confirm a pending transaction
- **WHEN** a user confirms a pending transaction
- **THEN** the system transitions it to "Confirmed", updates the account balance, and publishes TransactionPosted

#### Scenario: Cancel a pending transaction
- **WHEN** a user cancels a pending transaction
- **THEN** the system transitions it to "Cancelled" and publishes TransactionCancelled

#### Scenario: Refund a confirmed transaction
- **WHEN** a user refunds a confirmed transaction
- **THEN** the system transitions it to "Refunded", reverts the balance impact, and publishes TransactionRefunded

#### Scenario: Cannot cancel a confirmed transaction
- **WHEN** a user attempts to cancel a confirmed transaction
- **THEN** the system rejects the operation and offers "Refund" as the available action

#### Scenario: Cannot modify a cancelled transaction
- **WHEN** a user attempts to edit or change the state of a cancelled transaction
- **THEN** the system rejects the operation

### Requirement: Transaction Linked to Account
Every transaction MUST belong to at least one account. The system SHALL reject any transaction without an account.

#### Scenario: Transaction without account
- **WHEN** a user attempts to register a transaction without specifying an account
- **THEN** the system rejects the transaction with a validation error

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

### Requirement: Transaction with Tags
The system SHALL allow users to attach multiple tags to a transaction for flexible classification beyond categories.

#### Scenario: Add tags to transaction
- **WHEN** a user tags a transaction with "urgente" and "reembolsável"
- **THEN** the system stores and displays the tags

### Requirement: Transaction with Attachments
The system SHALL allow users to attach files to transactions. The system SHALL store attachment metadata (filename, size, MIME type) and the file content.

#### Scenario: Attach receipt to transaction
- **WHEN** a user attaches a PDF receipt to a transaction
- **THEN** the system stores the file and links it to the transaction

### Requirement: No Physical Deletion
The system MUST NOT physically delete any transaction. The system SHALL use status changes (Cancelled, Refunded) or soft-delete to preserve the audit trail.

#### Scenario: "Delete" a transaction
- **WHEN** a user requests to delete a transaction
- **THEN** the system marks it as "Cancelled" (if pending) or prompts for "Refund", preserving the original record

### Requirement: Register Parceled Purchase
The system SHALL allow users to register a purchase as parceled (installments). When registering a parceled purchase, the system SHALL automatically generate N installments with consecutive monthly due dates starting from the next month. Each installment SHALL inherit the category and cost center from the parent transaction.

#### Scenario: Register a 12-installment purchase
- **WHEN** a user registers a purchase of R$ 1.200,00 in 12 installments on a credit card account
- **THEN** the system creates the parent transaction and 12 installments of R$ 100,00 each, with consecutive monthly due dates

#### Scenario: Installments inherit category
- **WHEN** a parceled purchase is registered with category "Eletrônicos"
- **THEN** all generated installments have category "Eletrônicos"

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
