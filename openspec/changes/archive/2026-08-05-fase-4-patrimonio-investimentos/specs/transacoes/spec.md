## ADDED Requirements

### Requirement: Transaction Originated by an Investment or a Loan
The system SHALL allow a transaction to reference the investment operation or the loan installment that originated it. Such a transaction is created confirmed and is owned by that record: it MUST NOT be edited, and it MUST NOT be cancelled or refunded directly — reverting it SHALL be done by reverting the originating operation or payment. The reference is set by the system, never by the client, and MUST NOT be assigned to a transaction registered directly by the user.

#### Scenario: Purchase of an investment creates its transaction
- **WHEN** a user registers the purchase of R$ 3.250,00 of PETR4
- **THEN** the resulting expense transaction references that investment and is created with status "Confirmed"

#### Scenario: Cannot edit a transaction from an investment operation
- **WHEN** a user attempts to edit the transaction created by an investment operation
- **THEN** the system rejects the edit

#### Scenario: Cannot cancel a loan installment payment transaction
- **WHEN** a user attempts to cancel the transaction created by a loan installment payment
- **THEN** the system rejects the operation and points to the loan as the place to revert it

#### Scenario: Client cannot set the origin
- **WHEN** a user registers a transaction directly informing an investment or loan installment reference
- **THEN** the system rejects the request

### Requirement: Transaction in a Currency Other Than the Account
The system SHALL allow a transaction to be registered in a currency different from its account's currency, provided an exchange rate is supplied. The transaction SHALL store the original amount and currency, the exchange rate used and the converted amount in the account currency; the account balance SHALL be affected by the converted amount. The stored rate MUST be immutable after registration, and a transaction whose currency differs from the account's without a supplied rate MUST be rejected.

#### Scenario: Purchase in a foreign currency
- **WHEN** a user registers a purchase of $50.00 on a BRL account with an exchange rate of 5,20
- **THEN** the system stores the original amount of $50.00, the rate 5,20 and the converted amount of R$ 260,00, and the account balance is reduced by R$ 260,00

#### Scenario: Foreign currency without a rate
- **WHEN** a user attempts to register a transaction in USD on a BRL account without supplying an exchange rate
- **THEN** the system rejects the transaction and requires the rate

#### Scenario: Rate is immutable
- **WHEN** a user attempts to change the exchange rate of a registered transaction
- **THEN** the system rejects the change

#### Scenario: Historical value is preserved
- **WHEN** a user consults a foreign-currency transaction months after it was registered
- **THEN** the system presents the converted amount computed with the rate of the transaction date, not the current rate

## MODIFIED Requirements

### Requirement: Edit Pending Transaction
The system SHALL allow editing of pending transactions only. Editable fields include: amount, category, cost center, counterparty person, date, description, discount, tags, and attachments. The system SHALL register audit entries for every edit. A transaction already linked to a closed invoice MUST NOT be edited, regardless of its own status; removing such a charge SHALL be done through a refund. A transaction created by the settlement of a charge or of a payable MUST NOT be edited — it is confirmed at creation and is owned by that record. The same applies to a transaction created by an investment operation or by a loan installment payment or amortization.

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

#### Scenario: Cannot edit a transaction owned by an investment or a loan
- **WHEN** a user attempts to edit the transaction created by an investment operation or by a loan installment payment
- **THEN** the system rejects the edit
