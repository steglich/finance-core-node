# Pix Specification

## Purpose

PIX as a payment method recorded manually: sending money to a PIX key or a registered payee produces an expense transaction, and receiving produces an income transaction that may settle a charge. The system records the movement; it does not execute it against a bank.

## Requirements

### Requirement: Send PIX
The system SHALL allow users to record an outgoing PIX from an active account of the current company, informing either a PIX key directly or a person classified as PAYEE together with one of that payee's registered bank details. The amount MUST be greater than zero, the account MUST have sufficient available balance, and an expense category MUST be informed. On acceptance the system SHALL create a confirmed expense transaction for the amount, linked to the payee when one was selected, carrying the PIX key used and the payment method PIX, and SHALL debit the account balance.

#### Scenario: Send PIX to a registered payee
- **WHEN** a user selects payee "Maria" with a registered PIX key, informs R$ 200,00 and confirms
- **THEN** the system creates a confirmed expense transaction of R$ 200,00 linked to "Maria" with method PIX, and debits the account by R$ 200,00

#### Scenario: Send PIX to a key typed in
- **WHEN** a user informs a valid PIX key without selecting a payee and confirms R$ 200,00
- **THEN** the system creates the expense transaction carrying the informed key and no linked person

#### Scenario: Insufficient balance
- **WHEN** a user attempts to send a PIX of R$ 200,00 from an account whose available balance is R$ 50,00
- **THEN** the system rejects the operation and no transaction is created

#### Scenario: Invalid PIX key
- **WHEN** a user informs a PIX key that matches none of the accepted forms
- **THEN** the system rejects the operation with a validation error

#### Scenario: Payee bank detail of another company
- **WHEN** a user attempts to select a payee bank detail that belongs to a different company
- **THEN** the system returns a not-found error

#### Scenario: Inactive account
- **WHEN** a user attempts to send a PIX from an inactive account
- **THEN** the system rejects the operation

### Requirement: Receive PIX
The system SHALL allow users to record an incoming PIX into an active account of the current company, informing the amount, the date, an income category and, optionally, the paying person and an open charge to settle. The amount MUST be greater than zero. On acceptance the system SHALL create a confirmed income transaction with the payment method PIX and credit the account balance. When a charge is informed, the receipt SHALL follow the charge settlement rules — the amount MUST equal the charge's total due, and the charge SHALL transition to "Paid" with a single income transaction created, not two.

#### Scenario: Receive a standalone PIX
- **WHEN** a user records an incoming PIX of R$ 300,00 into an active account with an income category
- **THEN** the system creates a confirmed income transaction of R$ 300,00 with method PIX and credits the account

#### Scenario: Receive a PIX that settles a charge
- **WHEN** a user records an incoming PIX of R$ 1.500,00 informing an issued charge whose total due is R$ 1.500,00
- **THEN** the system creates one confirmed income transaction, marks the charge "Paid" and publishes ChargePaid

#### Scenario: Receive an amount different from the charge
- **WHEN** a user records an incoming PIX of R$ 1.400,00 informing a charge whose total due is R$ 1.500,00
- **THEN** the system rejects the operation, since partial settlement of a charge is not accepted

#### Scenario: Receive a PIX for an already paid charge
- **WHEN** a user attempts to record an incoming PIX against a charge whose status is "Paid"
- **THEN** the system rejects the operation

### Requirement: PIX Is a Manual Record
The system SHALL treat every PIX operation as the record of a movement that happened outside the platform. No integration with a payment provider is performed, no key ownership is verified beyond its structural format, and no automatic reconciliation occurs. The response of a PIX operation MUST NOT claim that funds were transferred — it reports only the transaction that was created.

#### Scenario: No external call is made
- **WHEN** a user records an outgoing PIX
- **THEN** the system creates the transaction locally and performs no request to any external payment provider

#### Scenario: Key ownership is not verified
- **WHEN** a user informs a structurally valid PIX key that belongs to nobody
- **THEN** the system accepts the record, since ownership cannot be verified without a provider
