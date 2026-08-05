## Purpose

Management of individual installments generated from parceled purchases, each with independent lifecycle (status, due date, payment) while sharing a common origin.

## ADDED Requirements

### Requirement: Installment Independent Lifecycle
The system SHALL treat each installment as an independent entity with its own number, amount, due date, status, and payment date. Payment of one installment MUST NOT affect the status of other installments from the same parent transaction.

#### Scenario: Pay a single installment
- **WHEN** a user pays the 3rd installment of a 12-installment purchase
- **THEN** only the 3rd installment transitions to "Paid"; installments 1, 2, and 4-12 remain unchanged

### Requirement: Installment State Machine
The system SHALL enforce an installment lifecycle with states: Pending, Paid, and Overdue. Transitions: Pending → Paid, Pending → Overdue, Overdue → Paid. Once Paid, a transition to any other state MUST be rejected.

#### Scenario: Pay pending installment
- **WHEN** a user pays a pending installment before its due date
- **THEN** the system transitions it to "Paid" and publishes InstallmentPaid

#### Scenario: Installment becomes overdue
- **WHEN** the system detects an installment whose due date has passed without payment
- **THEN** the system transitions it to "Overdue" and publishes InstallmentOverdue

#### Scenario: Pay overdue installment
- **WHEN** a user pays an overdue installment
- **THEN** the system transitions it from "Overdue" to "Paid" and publishes InstallmentPaid

#### Scenario: Cannot modify a paid installment
- **WHEN** a user attempts to edit or change the state of a paid installment
- **THEN** the system rejects the operation

### Requirement: Edit Installment Due Date
The system SHALL allow users to edit the due date of pending installments only. The system SHALL register an audit entry for the change.

#### Scenario: Change due date of pending installment
- **WHEN** a user changes the due date of a pending installment from "2024-08-15" to "2024-08-20"
- **THEN** the system updates the due date and records an audit entry

#### Scenario: Cannot change due date of paid installment
- **WHEN** a user attempts to change the due date of a paid installment
- **THEN** the system rejects the operation

### Requirement: Installment Payment
The system SHALL allow users to pay an individual installment, specifying a payment date and optionally a different account than the one associated with the original purchase. The system SHALL create a payment transaction linked to the installment.

#### Scenario: Pay installment from a different account
- **WHEN** a user pays an installment of R$ 250,00 from "Conta Poupança" instead of the original purchase's "Cartão de Crédito"
- **THEN** the system creates a payment transaction from Conta Poupança and links it to the installment

### Requirement: Batch Installment Payment
The system SHALL allow users to select and pay multiple installments in a single operation. Each installment SHALL be processed individually.

#### Scenario: Pay multiple installments at once
- **WHEN** a user selects 3 pending installments and clicks "Pay Selected"
- **THEN** the system processes payment for each installment individually

### Requirement: Installments Share Common Origin
The system SHALL maintain a reference from each installment to its parent parceled transaction. The parent transaction SHALL link to all its installments.

#### Scenario: View all installments of a purchase
- **WHEN** a user views the parent purchase transaction
- **THEN** the system displays all linked installments with their individual statuses
