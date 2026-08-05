# Faturas Specification

## Purpose

Consolidation of a credit card's purchases within a billing cycle into an invoice, which upon closing becomes a payment obligation distinct from the individual purchases, with total or partial payment and its own state machine.

## Requirements

### Requirement: Purchase Assigned to the Open Cycle Invoice
Every purchase charged to a credit card MUST belong to exactly one invoice. The system SHALL assign a purchase to the open invoice of the cycle that contains the purchase date, creating that invoice with status "Open" if it does not yet exist. A cycle runs from the day after the previous closing date through the current closing date, derived from the card's closing day. The invoice due date SHALL be derived from the card's due day in the month following the closing date, or in the same month when the due day is greater than the closing day.

#### Scenario: Purchase falls into the open cycle
- **WHEN** a user records a purchase on a card with closing day 3 on 20/07 and no open invoice exists
- **THEN** the system creates an invoice with status "Open" for the cycle closing on 03/08 and links the purchase to it

#### Scenario: Purchase after the closing date joins the next cycle
- **WHEN** a user records a purchase on 05/08 on a card whose cycle closed on 03/08
- **THEN** the system links the purchase to the invoice of the cycle closing on 03/09, not to the closed invoice

#### Scenario: Every purchase belongs to exactly one invoice
- **WHEN** a purchase has been linked to an invoice
- **THEN** the system MUST NOT link that same purchase to any other invoice

#### Scenario: Credit card purchase does not move the account balance
- **WHEN** a user records a purchase of R$ 500,00 on a credit card linked to an account with a balance of R$ 5.000,00
- **THEN** the account balance remains R$ 5.000,00 and the purchase is reflected only in the card's invoice and available limit

### Requirement: Invoice Closing
The system SHALL close a card's open invoice when its closing date is reached, consolidating every purchase of the cycle, computing the total amount as the sum of the net amounts of those purchases, and creating a payment obligation distinct from the individual purchases. Closing SHALL be performed automatically by a scheduled process and MAY also be triggered manually by a user. On closing, the system SHALL publish InvoiceClosed carrying the invoice, card, account, total amount, currency, due date, closing date and the identifiers of the consolidated purchases. A closed invoice MUST NOT return to "Open". The individual purchases SHALL remain independent transactions linked to the invoice.

#### Scenario: Automatic closing on the closing date
- **WHEN** the closing date of a card is reached and its open invoice holds 10 purchases totalling R$ 1.800,00
- **THEN** the system transitions the invoice to "Closed" with a total of R$ 1.800,00 and the due date derived from the card's due day, and publishes InvoiceClosed

#### Scenario: Closing an invoice with no purchases
- **WHEN** the closing date is reached and the open invoice has no purchases
- **THEN** the system closes the invoice with a total of R$ 0,00 and marks it as paid, requiring no payment

#### Scenario: Purchases survive the closing
- **WHEN** an invoice of R$ 1.800,00 is closed from 10 purchases
- **THEN** each of the 10 purchases remains a separate transaction linked to the invoice, and the invoice is a distinct payment obligation of R$ 1.800,00

#### Scenario: Reopening a closed invoice
- **WHEN** a user attempts to reopen a closed invoice
- **THEN** the system rejects the operation

#### Scenario: Closing an already closed invoice
- **WHEN** the scheduled process runs again for a cycle whose invoice is already closed
- **THEN** the system leaves the invoice unchanged and does not publish InvoiceClosed a second time

### Requirement: Invoice Payment
The system SHALL allow users to pay a closed, partially paid or overdue invoice by choosing a payment account and an amount. The payment SHALL create a confirmed expense transaction that debits the chosen account and is linked to the invoice. The paid amount MUST be greater than zero and MUST NOT exceed the invoice's outstanding balance. The system SHALL reject payment when the payment account has insufficient available balance. An invoice with status "Paid" MUST NOT accept further payments.

#### Scenario: Full payment
- **WHEN** a user pays R$ 1.800,00 of a closed invoice of R$ 1.800,00 from an account with a balance of R$ 5.000,00
- **THEN** the invoice transitions to "Paid", the account balance becomes R$ 3.200,00, and the system publishes InvoicePaid

#### Scenario: Partial payment
- **WHEN** a user pays R$ 900,00 of a closed invoice of R$ 1.800,00
- **THEN** the invoice transitions to "Partially Paid" with an outstanding balance of R$ 900,00 and no InvoicePaid is published

#### Scenario: Settling a partially paid invoice
- **WHEN** a user pays the remaining R$ 900,00 of a partially paid invoice
- **THEN** the invoice transitions to "Paid" with an outstanding balance of R$ 0,00 and the system publishes InvoicePaid

#### Scenario: Paying an already paid invoice
- **WHEN** a user attempts to pay an invoice whose status is "Paid"
- **THEN** the system rejects the payment

#### Scenario: Insufficient balance
- **WHEN** a user attempts to pay an invoice of R$ 1.800,00 from an account whose available balance is R$ 500,00
- **THEN** the system rejects the payment and reports insufficient balance

#### Scenario: Payment above the outstanding balance
- **WHEN** a user attempts to pay R$ 2.000,00 of an invoice whose outstanding balance is R$ 900,00
- **THEN** the system rejects the payment

#### Scenario: Paying an open invoice
- **WHEN** a user attempts to pay an invoice whose status is "Open"
- **THEN** the system rejects the payment, since the payment obligation exists only after closing

### Requirement: Invoice State Machine
The system SHALL enforce an invoice lifecycle with states Open, Closed, Partially Paid, Paid and Overdue, and the transitions: Open → Closed, Closed → Paid, Closed → Partially Paid, Partially Paid → Paid, Closed → Overdue, Partially Paid → Overdue, Overdue → Partially Paid, Overdue → Paid. A transition out of "Paid" and a transition from "Closed" back to "Open" MUST be rejected. The system SHALL publish a domain event for each state change that defines one.

#### Scenario: Invoice becomes overdue
- **WHEN** a scheduled process detects that the due date of a closed or partially paid invoice has passed with an outstanding balance
- **THEN** the system transitions the invoice to "Overdue" and publishes InvoiceOverdue with the number of overdue days

#### Scenario: Paying an overdue invoice
- **WHEN** a user fully pays an overdue invoice
- **THEN** the invoice transitions to "Paid" and the system publishes InvoicePaid

#### Scenario: Transition out of Paid
- **WHEN** any actor attempts to transition an invoice out of the "Paid" state
- **THEN** the system rejects the transition

### Requirement: Consult Invoices
The system SHALL allow users to list the invoices of a card and to view an individual invoice with its status, closing date, due date, total amount, paid amount, outstanding balance, the list of consolidated purchases and the list of payments made.

#### Scenario: View a closed invoice
- **WHEN** a user opens a closed invoice
- **THEN** the system displays the total amount, the due date and the list of purchases that make it up

#### Scenario: List card invoices
- **WHEN** a user requests the invoices of a card
- **THEN** the system returns the invoices of that card ordered by closing date, most recent first

### Requirement: Billed Transaction Is Protected
The system MUST NOT allow editing or cancelling a purchase that is already linked to a closed invoice. Removing the charge SHALL be done through a refund, which adjusts the invoice's total and outstanding balance when the invoice is not yet paid.

#### Scenario: Editing a billed purchase
- **WHEN** a user attempts to edit the amount of a purchase linked to a closed invoice
- **THEN** the system rejects the edit

#### Scenario: Refunding a purchase on an unpaid invoice
- **WHEN** a user refunds a purchase of R$ 200,00 linked to a closed and unpaid invoice of R$ 1.800,00
- **THEN** the system records the refund and reduces the invoice total and outstanding balance to R$ 1.600,00
