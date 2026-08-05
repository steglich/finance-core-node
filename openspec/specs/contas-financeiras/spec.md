# Contas Financeiras Specification

## Purpose

Management of financial accounts that represent where money is stored, with support for multiple currencies and balance derivation from transactions.

## Requirements

### Requirement: Create Financial Account
The system SHALL allow users to create financial accounts within a company. An account MUST have a name, a wallet (institution), a currency (ISO 4217 code), and an optional initial balance. When an initial balance is provided, the system SHALL create an adjustment transaction to record it.

#### Scenario: Create account with initial balance
- **WHEN** a user creates an account "Conta Corrente Nubank" linked to wallet "Nubank", currency "BRL", with initial balance R$ 5.000,00
- **THEN** the system creates the account and records an adjustment transaction of R$ 5.000,00

#### Scenario: Create account without name
- **WHEN** a user attempts to create an account without a name
- **THEN** the system rejects the creation with a validation error

### Requirement: Edit Account
The system SHALL allow users to edit an account's mutable fields: name, wallet (institution), and status. The system SHALL register an audit entry for every change. The currency SHALL be immutable after account creation.

#### Scenario: Edit account name
- **WHEN** a user changes the account name from "Conta Corrente" to "Conta Corrente Principal"
- **THEN** the system updates the name and records an audit entry

### Requirement: Deactivate Account
The system SHALL allow users to deactivate an account only if there are no pending transactions associated with it, no active card bound to it, and no unpaid invoice on any of its cards. An inactive account MUST NOT accept new transactions.

#### Scenario: Deactivate account with no pending transactions
- **WHEN** a user deactivates an account that has only confirmed or cancelled transactions and no active card
- **THEN** the system marks the account as inactive

#### Scenario: Deactivate account with pending transactions
- **WHEN** a user attempts to deactivate an account that has pending transactions
- **THEN** the system prevents deactivation and returns an error

#### Scenario: Deactivate account with an active card
- **WHEN** a user attempts to deactivate an account that has an active card bound to it
- **THEN** the system prevents deactivation and returns an error

#### Scenario: Deactivate account with an unpaid invoice
- **WHEN** a user attempts to deactivate an account whose card has a closed invoice with an outstanding balance
- **THEN** the system prevents deactivation and returns an error

### Requirement: Account Balance
The system SHALL derive the account balance from the sum of all confirmed transactions (credits minus debits). The balance MUST NOT be directly editable by users. The system SHALL expose both the current balance and the available balance (balance minus blocked amounts). Purchases charged to a credit card MUST NOT affect the balance of the account bound to that card at purchase time; the balance is affected only when the corresponding invoice is paid.

#### Scenario: View account balance
- **WHEN** a user views an account that has R$ 8.000 in credits and R$ 3.500 in debits from confirmed transactions
- **THEN** the system displays a current balance of R$ 4.500,00

#### Scenario: Balance reconciliation
- **WHEN** the system calculates the balance from all confirmed transactions
- **THEN** the result MUST match the stored balance cache; if not, the system SHALL flag the account for reconciliation

#### Scenario: Credit card purchase does not affect the balance
- **WHEN** a user records a purchase of R$ 500,00 on a credit card bound to an account whose balance is R$ 5.000,00
- **THEN** the account balance remains R$ 5.000,00

#### Scenario: Invoice payment affects the balance
- **WHEN** a user pays an invoice of R$ 1.800,00 from an account whose balance is R$ 5.000,00
- **THEN** the account balance becomes R$ 3.200,00

### Requirement: Multi-Currency Foundation
The system SHALL store the currency code (ISO 4217) for each account. The system SHALL support at least 30 currencies.

#### Scenario: Account in foreign currency
- **WHEN** a user creates an account "Conta Internacional Wise" with currency "USD"
- **THEN** the system stores and displays the currency as "USD"

### Requirement: List Accounts
The system SHALL allow users to list all active accounts for the current company, displaying name, wallet, currency, and current balance.

#### Scenario: List company accounts
- **WHEN** a user requests the list of accounts for the active company
- **THEN** the system returns all active accounts with their balances

### Requirement: Account Owns Its Cards
A card MUST exist only bound to an account. The system SHALL expose, for each account, the cards bound to it, and SHALL reject binding a card to an account of a different company.

#### Scenario: View the cards of an account
- **WHEN** a user views an account that has two cards bound to it
- **THEN** the system displays both cards with their types and limits

#### Scenario: Card in another company's account
- **WHEN** a user attempts to bind a card to an account belonging to a different company
- **THEN** the system rejects the operation
