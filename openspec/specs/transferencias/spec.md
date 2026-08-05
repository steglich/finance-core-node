# Transferencias Specification

## Purpose

Atomic transfer of funds between two accounts within the same company, creating linked debit and credit transactions with balance validation.

## Requirements

### Requirement: Transfer Between Accounts
The system SHALL allow users to transfer funds between two accounts within the same company. A transfer SHALL create two linked transactions atomically: a debit on the source account and a credit on the destination account. The two transactions SHALL share a common transfer identifier.

#### Scenario: Successful transfer
- **WHEN** a user transfers R$ 500,00 from "Conta Corrente" (balance R$ 2.000,00) to "Conta Poupança" (balance R$ 1.000,00)
- **THEN** the system creates a debit of R$ 500,00 on Conta Corrente and a credit of R$ 500,00 on Conta Poupança, both linked by a shared transfer ID, and publishes TransferCompleted

### Requirement: Atomicity of Debit and Credit
The system SHALL ensure that both the debit and credit transactions for a transfer are created together or not at all. If either creation fails, the system SHALL roll back the other.

#### Scenario: Credit creation fails
- **WHEN** a transfer's debit is created successfully but the credit creation fails
- **THEN** the system rolls back the debit, and no balance changes occur on either account

### Requirement: Balance Validation
The system SHALL validate that the source account has sufficient balance before processing a transfer. If the balance is insufficient, the system SHALL reject the transfer without creating any transactions.

#### Scenario: Insufficient balance
- **WHEN** a user attempts to transfer R$ 3.000,00 from an account with R$ 2.000,00 balance
- **THEN** the system rejects the transfer with "Saldo insuficiente na conta de origem"

### Requirement: Transfer Between Different Currencies
The system SHALL support transfers between accounts with different currencies. The system SHALL require the exchange rate to be provided at the time of transfer. The exchange rate SHALL be stored with the transfer and MUST be immutable after completion.

#### Scenario: Transfer BRL to USD
- **WHEN** a user transfers R$ 520,00 from a BRL account to a USD account with an exchange rate of 5.20
- **THEN** the system creates a debit of R$ 520,00 on the BRL account and a credit of $100.00 on the USD account, storing the exchange rate

#### Scenario: Cross-currency transfer without rate
- **WHEN** a user attempts to transfer between accounts with different currencies without providing an exchange rate
- **THEN** the system rejects the transfer and requires the exchange rate

### Requirement: Transfer Between Same Currency
The system SHALL process transfers between accounts with the same currency without requiring an exchange rate.

#### Scenario: Transfer BRL to BRL
- **WHEN** a user transfers R$ 500,00 between two BRL accounts
- **THEN** the system processes the transfer without requiring or storing an exchange rate

### Requirement: Transfer Restrictions
The system SHALL only allow transfers between active accounts. The system SHALL reject transfers from or to inactive accounts.

#### Scenario: Transfer from inactive account
- **WHEN** a user attempts to transfer from an inactive account
- **THEN** the system rejects the transfer with an error
