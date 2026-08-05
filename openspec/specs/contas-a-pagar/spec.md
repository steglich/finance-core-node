# Contas a Pagar Specification

## Purpose

Accounts payable: obligations owed to suppliers, registered with a due date before they become cash movement, settled by a payment that debits an account and produces the corresponding expense transaction.

## Requirements

### Requirement: Register Payable
The system SHALL allow users to register a payable within a company for a person classified as SUPPLIER, with an amount greater than zero, a due date, an expense category and a description. Optional fields are cost center, competence date and a document number. The supplier MUST belong to the same company and MUST be active; the category MUST be an expense category of the same company. A new payable starts with status "Pending" and no paid amount, and the system SHALL publish PayableRegistered.

#### Scenario: Register a payable
- **WHEN** a user registers a payable of R$ 1.000,00 to supplier "Fornecedor XYZ" due on 20/08 in category "Serviços"
- **THEN** the system creates the payable with status "Pending" and publishes PayableRegistered

#### Scenario: Payable with a non-positive amount
- **WHEN** a user attempts to register a payable of R$ 0,00
- **THEN** the system rejects the registration with a validation error

#### Scenario: Payable to a person who is not a supplier
- **WHEN** a user attempts to register a payable for a person not classified as SUPPLIER
- **THEN** the system rejects the registration

#### Scenario: Payable on an income category
- **WHEN** a user attempts to register a payable using a category of type INCOME
- **THEN** the system rejects the registration with a validation error

#### Scenario: Payable with a past due date
- **WHEN** a user registers a payable whose due date has already passed
- **THEN** the system accepts the registration, since an obligation may be recorded late

### Requirement: Payable State Machine
The system SHALL enforce a payable lifecycle with states Pending, Overdue, Paid and Cancelled, and only these transitions: Pending → Paid, Pending → Overdue, Pending → Cancelled, Overdue → Paid, Overdue → Cancelled. Paid and Cancelled are final: any transition out of them MUST be rejected, and a paid payable MUST NOT be reopened or edited.

#### Scenario: Payable becomes overdue
- **WHEN** the due date of a pending payable passes without settlement
- **THEN** the payable transitions to "Overdue" and the system publishes PayableOverdue with the number of days late

#### Scenario: Cancel a paid payable
- **WHEN** a user attempts to cancel a payable whose status is "Paid"
- **THEN** the system rejects the operation

#### Scenario: Reopen a cancelled payable
- **WHEN** a user attempts to move a cancelled payable back to "Pending"
- **THEN** the system rejects the transition

### Requirement: Settle Payable
The system SHALL allow users to settle a payable whose status is "Pending" or "Overdue", informing the paid amount, the payment date and the source account. The paid amount MUST equal the payable amount. The source account MUST belong to the same company, MUST be active and MUST have sufficient available balance. On acceptance the system SHALL, atomically: create a confirmed expense transaction in the source account for the paid amount, inheriting the payable's category, cost center and supplier; debit the account balance; record the payment with its date and amount; transition the payable to "Paid"; and publish PayablePaid.

#### Scenario: Settle a payable
- **WHEN** a user settles a payable of R$ 1.000,00 from an active account with sufficient balance
- **THEN** the system creates a confirmed expense transaction of R$ 1.000,00, debits the account, marks the payable "Paid" and publishes PayablePaid

#### Scenario: Insufficient balance
- **WHEN** a user attempts to settle a payable of R$ 1.000,00 from an account whose available balance is R$ 400,00
- **THEN** the system rejects the settlement and the payable remains unchanged

#### Scenario: Partial amount
- **WHEN** a user attempts to settle a payable of R$ 1.000,00 informing R$ 600,00
- **THEN** the system rejects the settlement, since partial settlement is not accepted

#### Scenario: Settle an already paid payable
- **WHEN** a user attempts to settle a payable whose status is "Paid"
- **THEN** the system rejects the operation and no second transaction is created

### Requirement: Cancel Payable
The system SHALL allow users to cancel a payable whose status is "Pending" or "Overdue", informing a reason that MUST NOT be empty. The payable SHALL transition to "Cancelled" and stop counting toward the supplier's owed total. Cancelling MUST NOT create or reverse any transaction.

#### Scenario: Cancel a pending payable
- **WHEN** a user cancels a pending payable with the reason "cobrança indevida"
- **THEN** the payable transitions to "Cancelled" and no longer counts toward the supplier's owed total

#### Scenario: Cancel without a reason
- **WHEN** a user attempts to cancel a payable without informing a reason
- **THEN** the system rejects the cancellation with a validation error

### Requirement: Overdue Detection for Payables
The system SHALL, once per day, transition to "Overdue" every payable whose status is "Pending" and whose due date is earlier than the current date, publishing PayableOverdue for each. Running the detection more than once on the same day MUST NOT produce duplicate transitions or duplicate events, and a failure on one payable MUST NOT prevent the others from being processed.

#### Scenario: Daily detection
- **WHEN** the daily detection runs and finds two pending payables past their due date
- **THEN** both transition to "Overdue" and two PayableOverdue events are published

#### Scenario: Detection runs twice on the same day
- **WHEN** the daily detection runs a second time on the same day
- **THEN** the already-overdue payables are left unchanged and no further event is published

### Requirement: Manage Payables
The system SHALL allow users to list the payables of the current company filtered by supplier, status, category, cost center and due date range, ordered by due date ascending, and to view an individual payable with its amount, due date, status, supplier, category, cost center, description and linked payment. Payables in "Pending" status MAY have their amount, due date, category, cost center and description edited; payables in any other status MUST NOT be edited. Payables MUST NOT be physically deleted. Every registration, edit, settlement and cancellation SHALL be recorded in the audit log.

#### Scenario: List pending payments of a supplier
- **WHEN** a user lists the payables filtered by supplier "Fornecedor XYZ" and status "Pending"
- **THEN** the system returns that supplier's pending payables ordered by due date ascending

#### Scenario: Edit a pending payable
- **WHEN** a user changes the due date of a pending payable
- **THEN** the system updates the payable and records an audit entry

#### Scenario: Edit a paid payable
- **WHEN** a user attempts to change the amount of a paid payable
- **THEN** the system rejects the edit

#### Scenario: Payable of another company
- **WHEN** a user requests a payable that belongs to a different company
- **THEN** the system returns a not-found error
