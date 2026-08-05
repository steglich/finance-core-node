# Cobrancas Specification

## Purpose

Accounts receivable: charges issued to customers with a due date, automatic penalty and interest once overdue, settlement that produces the corresponding income transaction, and a strict lifecycle in which a settled charge can never be reopened.

## Requirements

### Requirement: Issue Charge
The system SHALL allow users to issue a charge within a company for a person classified as CUSTOMER, with an amount greater than zero, a due date not earlier than the issue date, a description, an optional late penalty percentage and an optional monthly interest percentage. Both percentages MUST be between 0% and 100%. The customer MUST belong to the same company and MUST be active. A new charge starts with status "Issued" and no settled amount, and the system SHALL publish ChargeIssued.

#### Scenario: Issue a charge
- **WHEN** a user issues a charge of R$ 1.500,00 to customer "João Silva" due on 15/08 with a 2% penalty and 1% monthly interest
- **THEN** the system creates the charge with status "Issued" and publishes ChargeIssued

#### Scenario: Charge with a non-positive amount
- **WHEN** a user attempts to issue a charge of R$ 0,00
- **THEN** the system rejects the issuance with a validation error

#### Scenario: Charge with a past due date
- **WHEN** a user attempts to issue a charge whose due date is earlier than today
- **THEN** the system rejects the issuance with a validation error

#### Scenario: Charge to a person who is not a customer
- **WHEN** a user attempts to issue a charge to a person not classified as CUSTOMER
- **THEN** the system rejects the issuance

#### Scenario: Charge to an inactive customer
- **WHEN** a user attempts to issue a charge to an inactive customer
- **THEN** the system rejects the issuance and reports that the customer is inactive

### Requirement: Charge State Machine
The system SHALL enforce a charge lifecycle with states Issued, Overdue, Paid and Cancelled, and only these transitions: Issued → Paid, Issued → Overdue, Issued → Cancelled, Overdue → Paid, Overdue → Cancelled. Paid and Cancelled are final: any transition out of them MUST be rejected. In particular, a paid charge MUST NOT be reopened, cancelled or edited.

#### Scenario: Charge becomes overdue
- **WHEN** the due date of an issued charge passes without settlement
- **THEN** the charge transitions to "Overdue" and the system publishes ChargeOverdue with the number of days late

#### Scenario: Cancel a paid charge
- **WHEN** a user attempts to cancel a charge whose status is "Paid"
- **THEN** the system rejects the operation

#### Scenario: Reopen a cancelled charge
- **WHEN** a user attempts to move a cancelled charge back to "Issued"
- **THEN** the system rejects the transition

#### Scenario: Overdue charge is settled
- **WHEN** a user registers the receipt of an overdue charge
- **THEN** the charge transitions to "Paid" and no further transition is accepted

### Requirement: Penalty and Interest on Overdue Charges
The system SHALL compute penalty and interest on the charge's original amount, never on an already adjusted amount. The penalty SHALL be the original amount multiplied by the penalty percentage, applied once as soon as the charge is overdue. The interest SHALL be the original amount multiplied by the monthly interest percentage, prorated by day over a 30-day month and multiplied by the number of days late. Both SHALL be rounded to cents and SHALL be zero while the charge is not overdue. The total due SHALL be the original amount plus penalty plus interest.

#### Scenario: Charge five days late
- **WHEN** a charge of R$ 1.500,00 with a 2% penalty and 1% monthly interest is five days late
- **THEN** the total due is R$ 1.532,50 — R$ 1.500,00 plus R$ 30,00 of penalty plus R$ 2,50 of interest

#### Scenario: Charge not yet due
- **WHEN** a user consults a charge whose due date has not passed
- **THEN** the penalty and the interest are zero and the total due equals the original amount

#### Scenario: Charge without penalty or interest configured
- **WHEN** a charge with no penalty and no interest percentage is ten days late
- **THEN** the total due equals the original amount

#### Scenario: Interest grows with the delay
- **WHEN** the same overdue charge is consulted on two different days
- **THEN** the interest of the later day is greater, since it is prorated by the number of days late

### Requirement: Register Charge Receipt
The system SHALL allow users to register the receipt of a charge whose status is "Issued" or "Overdue", informing the received amount, the receipt date and the destination account. The received amount MUST equal the total due computed for the receipt date; a lesser or greater amount MUST be rejected. The destination account MUST belong to the same company and MUST be active. On acceptance the system SHALL, atomically: create a confirmed income transaction in the destination account for the received amount, linked to the charge and to the customer; credit the account balance; record the receipt with its date and amount; transition the charge to "Paid"; and publish ChargePaid.

#### Scenario: Receive a charge on time
- **WHEN** a user registers the receipt of R$ 1.500,00 for a charge of R$ 1.500,00 into an active account
- **THEN** the system creates a confirmed income transaction of R$ 1.500,00, credits the account, marks the charge "Paid" and publishes ChargePaid

#### Scenario: Receive an overdue charge
- **WHEN** a user registers the receipt of R$ 1.532,50 for a charge that is five days late with a total due of R$ 1.532,50
- **THEN** the system creates an income transaction of R$ 1.532,50, of which R$ 32,50 is recorded as penalty and interest, and marks the charge "Paid"

#### Scenario: Amount below the total due
- **WHEN** a user attempts to register a receipt of R$ 1.000,00 for a charge whose total due is R$ 1.500,00
- **THEN** the system rejects the receipt, since partial settlement is not accepted

#### Scenario: Receipt into an inactive account
- **WHEN** a user attempts to register a receipt into an inactive account
- **THEN** the system rejects the operation and the charge remains unchanged

#### Scenario: Receipt of a cancelled charge
- **WHEN** a user attempts to register a receipt for a cancelled charge
- **THEN** the system rejects the operation

### Requirement: Cancel Charge
The system SHALL allow users to cancel a charge whose status is "Issued" or "Overdue", informing a reason. The reason MUST NOT be empty. The charge SHALL transition to "Cancelled", stop counting toward the customer's outstanding total, and the system SHALL publish ChargeCancelled with the reason. Cancelling MUST NOT create or reverse any transaction.

#### Scenario: Cancel an issued charge
- **WHEN** a user cancels an issued charge with the reason "serviço não executado"
- **THEN** the charge transitions to "Cancelled", publishes ChargeCancelled and no longer counts toward the customer's outstanding total

#### Scenario: Cancel without a reason
- **WHEN** a user attempts to cancel a charge without informing a reason
- **THEN** the system rejects the cancellation with a validation error

### Requirement: Overdue Detection
The system SHALL, once per day, transition to "Overdue" every charge whose status is "Issued" and whose due date is earlier than the current date, publishing ChargeOverdue for each. Running the detection more than once on the same day MUST NOT produce duplicate transitions or duplicate events. A failure while processing one charge MUST NOT prevent the remaining ones from being processed.

#### Scenario: Daily detection
- **WHEN** the daily detection runs and finds three issued charges past their due date
- **THEN** the three charges transition to "Overdue" and three ChargeOverdue events are published

#### Scenario: Detection runs twice on the same day
- **WHEN** the daily detection runs a second time on the same day
- **THEN** the already-overdue charges are left unchanged and no further event is published

#### Scenario: Failure in one charge
- **WHEN** processing one charge fails during the daily detection
- **THEN** the error is logged and the remaining charges are still processed

### Requirement: Manage Charges
The system SHALL allow users to list the charges of the current company filtered by customer, status and due date range, and to view an individual charge with its original amount, penalty, interest, total due, due date, status, customer, description and linked receipt. Charges of an "Issued" status MAY have their amount, due date, description, penalty and interest percentages edited; charges in any other status MUST NOT be edited. Charges MUST NOT be physically deleted. Every issuance, edit, receipt and cancellation SHALL be recorded in the audit log.

#### Scenario: List overdue charges
- **WHEN** a user lists the charges filtered by status "Overdue"
- **THEN** the system returns only the overdue charges of the current company, each with its accrued penalty and interest

#### Scenario: Edit an issued charge
- **WHEN** a user changes the due date of an issued charge
- **THEN** the system updates the charge and records an audit entry

#### Scenario: Edit an overdue charge
- **WHEN** a user attempts to change the amount of an overdue charge
- **THEN** the system rejects the edit

#### Scenario: Charge of another company
- **WHEN** a user requests a charge that belongs to a different company
- **THEN** the system returns a not-found error
