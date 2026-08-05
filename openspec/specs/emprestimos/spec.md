# Emprestimos Specification

## Purpose

Loans contracted by a company — the contract, the installment schedule generated from it, the payments that reduce the outstanding balance, extra amortizations, and a lifecycle in which a settled loan can never be reopened.

## Requirements

### Requirement: Contract Loan
The system SHALL allow users to contract a loan within a company with: a description, a principal amount greater than zero, a monthly interest rate between 0% and 100%, a number of installments greater than zero, an installment amount greater than zero, a first due date, a linked financial account of the same company, and an optional creditor (a person of the same company). The loan currency SHALL be the currency of the linked account. A new loan starts with status "Contracted", and the system SHALL publish LoanCreated.

#### Scenario: Contract a loan
- **WHEN** a user contracts a loan of R$ 10.000,00 in 24 installments of R$ 520,00 with 1,5% monthly interest
- **THEN** the system creates the loan with status "Contracted", generates 24 installments with consecutive monthly due dates, and publishes LoanCreated

#### Scenario: Loan with a non-positive principal
- **WHEN** a user attempts to contract a loan with a principal of R$ 0,00
- **THEN** the system rejects the contract with a validation error

#### Scenario: Loan with an interest rate out of range
- **WHEN** a user attempts to contract a loan with a monthly interest rate of 150%
- **THEN** the system rejects the contract with a validation error

#### Scenario: Loan whose installments do not cover the principal
- **WHEN** a user attempts to contract a loan whose number of installments multiplied by the installment amount is lower than the principal
- **THEN** the system rejects the contract and reports that the schedule does not repay the principal

#### Scenario: Creditor of another company
- **WHEN** a user attempts to reference a creditor that belongs to a different company
- **THEN** the system rejects the contract

### Requirement: Installment Schedule
Contracting a loan SHALL generate its full installment schedule: one installment per contracted period, numbered from 1, with consecutive monthly due dates starting at the informed first due date, each carrying the installment amount split into an interest portion and a principal portion. The interest portion of an installment SHALL be the outstanding balance before it multiplied by the monthly interest rate, and the principal portion SHALL be the installment amount minus that interest. The last installment SHALL absorb any rounding difference so that the sum of the principal portions equals the contracted principal exactly. Every installment starts with status "Pending".

#### Scenario: Schedule generated on contract
- **WHEN** a loan of R$ 10.000,00 in 24 installments of R$ 520,00 is contracted with the first due date on 10/09/2026
- **THEN** the system generates 24 pending installments due on the 10th of each month, from 10/09/2026 to 10/08/2028

#### Scenario: Principal portions add up to the principal
- **WHEN** the schedule of any loan is generated
- **THEN** the sum of the principal portions of all installments equals the contracted principal to the cent

#### Scenario: Interest-free loan
- **WHEN** a loan of R$ 1.200,00 in 12 installments of R$ 100,00 with 0% interest is contracted
- **THEN** every installment has an interest portion of R$ 0,00 and a principal portion of R$ 100,00

### Requirement: Outstanding Balance
The outstanding balance of a loan SHALL be derived as the contracted principal minus the sum of all amortizations — the principal portions of the paid installments plus any extra amortizations. The system MUST NOT persist the outstanding balance as an independent field. The system SHALL also expose the number of remaining installments and the total interest paid so far.

#### Scenario: Balance after paying an installment
- **WHEN** a user pays the 5th installment of a 24-installment loan
- **THEN** the outstanding balance is reduced by that installment's principal portion and the loan reports 19 remaining installments

#### Scenario: Balance of an untouched loan
- **WHEN** a user consults a loan that has just been contracted
- **THEN** the outstanding balance equals the contracted principal

### Requirement: Pay Loan Installment
The system SHALL allow users to pay a pending or overdue installment, informing the payment date and the account it is paid from. The account MUST be active, MUST belong to the same company, MUST have the same currency as the loan and MUST have sufficient balance. The payment SHALL create a confirmed expense transaction on that account referencing the installment, mark the installment as "Paid", and be persisted atomically with the transaction. Paying an installment MUST NOT be possible twice: a second payment of the same installment SHALL be rejected and MUST NOT create a second transaction.

#### Scenario: Pay an installment
- **WHEN** a user pays the 5th installment of R$ 520,00 from the account "Conta Corrente"
- **THEN** the system creates a confirmed expense transaction of R$ 520,00, marks the installment as paid and reduces the outstanding balance

#### Scenario: Pay an already paid installment
- **WHEN** a user attempts to pay an installment whose status is "Paid"
- **THEN** the system rejects the payment and no second transaction is created

#### Scenario: Concurrent double payment
- **WHEN** two simultaneous requests attempt to pay the same installment
- **THEN** exactly one succeeds, the other is rejected, and only one expense transaction exists

#### Scenario: Payment from an account without balance
- **WHEN** a user attempts to pay an installment from an account whose balance is lower than the installment amount
- **THEN** the system rejects the payment

#### Scenario: Payment from an account in another currency
- **WHEN** a user attempts to pay an installment of a BRL loan from a USD account
- **THEN** the system rejects the payment and reports the currency mismatch

### Requirement: Extra Amortization
The system SHALL allow users to register an extra amortization on a loan that is in progress, informing an amount greater than zero, a date and the account it is paid from. The amortization SHALL reduce the outstanding balance by the full informed amount and SHALL create a confirmed expense transaction on the account, atomically. An amortization greater than the outstanding balance MUST be rejected. The amortization SHALL settle the loan's pending installments starting from the last one, and when it does not cover a whole installment the remainder SHALL reduce the principal portion of the last still-pending installment.

#### Scenario: Extra amortization
- **WHEN** a loan with an outstanding balance of R$ 8.000,00 receives an extra amortization of R$ 2.000,00
- **THEN** the outstanding balance becomes R$ 6.000,00 and a confirmed expense transaction of R$ 2.000,00 is created

#### Scenario: Amortization larger than the balance
- **WHEN** a user attempts to amortize R$ 9.000,00 on a loan whose outstanding balance is R$ 8.000,00
- **THEN** the system rejects the amortization

#### Scenario: Amortization that settles the loan
- **WHEN** an extra amortization equals the whole outstanding balance
- **THEN** all remaining installments are settled, the loan transitions to "Settled" and the system publishes LoanSettled

#### Scenario: Amortization on a settled loan
- **WHEN** a user attempts to amortize a loan whose status is "Settled"
- **THEN** the system rejects the operation

### Requirement: Loan State Machine
The system SHALL enforce a loan lifecycle with states Contracted, In Progress, Delinquent and Settled, and only these transitions: Contracted → In Progress (first installment paid), Contracted → Delinquent (an installment falls overdue before any payment), In Progress → Settled (all installments settled), In Progress → Delinquent (an installment falls overdue), Delinquent → In Progress (all overdue installments settled), Delinquent → Settled. Settled is final: any transition out of it MUST be rejected, and a settled loan MUST NOT be edited or reopened. A loan MUST NOT go directly from Contracted to Settled by paying installments — it passes through In Progress.

#### Scenario: First payment starts the loan
- **WHEN** the first installment of a contracted loan is paid
- **THEN** the loan transitions to "In Progress"

#### Scenario: Loan is settled
- **WHEN** the last pending installment of a loan in progress is paid
- **THEN** the loan transitions to "Settled" and the system publishes LoanSettled

#### Scenario: Reopen a settled loan
- **WHEN** a user attempts to register a payment or an edit on a settled loan
- **THEN** the system rejects the operation

#### Scenario: Delinquent loan is regularized
- **WHEN** the last overdue installment of a delinquent loan is paid and other installments remain pending
- **THEN** the loan transitions back to "In Progress"

### Requirement: Overdue Installment Detection
The system SHALL detect, once a day, pending installments whose due date has passed, mark them as "Overdue", transition the loan to "Delinquent" when it is not already, and publish LoanPaymentMissed with the installment number, the due date, the number of days late and the amount. Running the detection more than once for the same day MUST NOT transition an already overdue installment again nor publish a duplicate event.

#### Scenario: Installment falls overdue
- **WHEN** the due date of a pending installment passes without payment
- **THEN** the installment is marked "Overdue", the loan becomes "Delinquent" and the system publishes LoanPaymentMissed

#### Scenario: Detection is idempotent
- **WHEN** the overdue detection runs a second time on the same day
- **THEN** already overdue installments are not transitioned again and no duplicate event is published

#### Scenario: Settled loan is ignored
- **WHEN** the detection runs over a settled loan
- **THEN** nothing is transitioned and no event is published

### Requirement: List and Consult Loans
The system SHALL allow users to list the loans of the current company, filterable by status and by creditor, each entry showing the description, contracted principal, outstanding balance, installment amount, paid and remaining installments and status. Consulting a single loan SHALL additionally return its full installment schedule with each installment's number, due date, amount, interest portion, principal portion and status.

#### Scenario: List loans by status
- **WHEN** a user lists loans filtering by status "Delinquent"
- **THEN** the system returns only delinquent loans of the current company

#### Scenario: Consult the schedule
- **WHEN** a user opens a loan of 24 installments
- **THEN** the system returns the 24 installments with number, due date, amount, interest and principal portions, and status

### Requirement: Loan Company Isolation
Every loan, installment and payment SHALL belong to exactly one company and SHALL only be readable and writable within that company's scope, taken from the authenticated context.

#### Scenario: Loan of another company
- **WHEN** a user authenticated for company A requests a loan of company B
- **THEN** the system returns not found
