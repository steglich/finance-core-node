# Cartoes Specification

## Purpose

Management of payment cards (credit, debit and prepaid) bound to a financial account, carrying limit, brand, closing day and due day, with the available limit derived from unbilled purchases and open invoices.

## Requirements

### Requirement: Create Card
The system SHALL allow users to create a card within a company. A card MUST have a name, a type (CREDIT, DEBIT or PREPAID), a linked account of the same company, and a brand. A credit or prepaid card MUST also have a limit greater than zero; a credit card MUST also have a closing day and a due day, both integers between 1 and 31. The bank/institution name is optional. A card MUST NOT be created without a linked account.

#### Scenario: Create a credit card
- **WHEN** a user creates a card "Nubank" of type CREDIT, brand "Visa", limit R$ 5.000,00, closing day 3, due day 10, linked to account "Conta Corrente"
- **THEN** the system creates the card and reports an available limit of R$ 5.000,00

#### Scenario: Create card without a linked account
- **WHEN** a user attempts to create a card without specifying an account
- **THEN** the system rejects the creation with a validation error

#### Scenario: Create credit card with invalid closing day
- **WHEN** a user attempts to create a credit card with closing day 0 or 32
- **THEN** the system rejects the creation with a validation error

#### Scenario: Create credit card with zero limit
- **WHEN** a user attempts to create a credit card with a limit of R$ 0,00
- **THEN** the system rejects the creation with a validation error

#### Scenario: Create card linked to an account of another company
- **WHEN** a user attempts to link a card to an account that belongs to a different company
- **THEN** the system rejects the creation

### Requirement: Card Available Limit Is Derived
The system SHALL derive a credit or prepaid card's available limit as the card limit minus the net amount of purchases charged to the card that are not yet settled — that is, purchases in the open cycle plus the outstanding balance of invoices that are not fully paid. The available limit MUST NOT be directly editable by users. A debit card SHALL NOT expose an available limit.

#### Scenario: Purchase reduces the available limit
- **WHEN** a user records a purchase of R$ 500,00 on a credit card with a R$ 5.000,00 limit and no other charges
- **THEN** the system reports an available limit of R$ 4.500,00

#### Scenario: Invoice payment restores the available limit
- **WHEN** a user fully pays an invoice of R$ 1.800,00 for a card with a R$ 5.000,00 limit and no other charges
- **THEN** the system reports an available limit of R$ 5.000,00

#### Scenario: Purchase exceeding the available limit
- **WHEN** a user attempts to record a purchase of R$ 600,00 on a credit card whose available limit is R$ 500,00
- **THEN** the system rejects the purchase with a business rule violation

#### Scenario: Available limit is not editable
- **WHEN** a user attempts to set the available limit of a card directly
- **THEN** the system rejects the operation

### Requirement: Edit Card
The system SHALL allow users to edit a card's mutable fields: name, brand, bank, limit, closing day and due day. The card type and the linked account MUST be immutable after creation. The system SHALL register an audit entry for every change. A limit change MUST NOT be accepted when the resulting limit is lower than the amount already committed on the card.

#### Scenario: Increase the card limit
- **WHEN** a user changes the limit of a card from R$ 5.000,00 to R$ 8.000,00
- **THEN** the system updates the limit, recomputes the available limit and records an audit entry

#### Scenario: Reduce the limit below the committed amount
- **WHEN** a user attempts to reduce the limit to R$ 1.000,00 on a card with R$ 3.000,00 already committed
- **THEN** the system rejects the change

#### Scenario: Change the card type
- **WHEN** a user attempts to change a card's type from CREDIT to DEBIT
- **THEN** the system rejects the change

#### Scenario: Changing the closing day takes effect on the next cycle
- **WHEN** a user changes the closing day of a card whose current cycle is already open
- **THEN** the system keeps the current cycle's closing date unchanged and applies the new closing day starting from the next cycle

### Requirement: Deactivate Card
The system SHALL allow users to deactivate a card only when it has no open invoice and no unpaid closed invoice. An inactive card MUST NOT accept new purchases. Cards MUST NOT be physically deleted.

#### Scenario: Deactivate a settled card
- **WHEN** a user deactivates a card whose invoices are all paid and which has no purchases in the open cycle
- **THEN** the system marks the card as inactive

#### Scenario: Deactivate a card with an unpaid invoice
- **WHEN** a user attempts to deactivate a card that has a closed invoice with an outstanding balance
- **THEN** the system prevents deactivation and returns an error

#### Scenario: Purchase on an inactive card
- **WHEN** a user attempts to record a purchase on an inactive card
- **THEN** the system rejects the purchase

### Requirement: List Cards
The system SHALL allow users to list the cards of the current company, showing name, type, brand, linked account, limit, available limit, closing day and due day. Inactive cards SHALL be excluded unless explicitly requested.

#### Scenario: List company cards
- **WHEN** a user requests the list of cards for the active company
- **THEN** the system returns all active cards with their limits and available limits

#### Scenario: Cards of another company are not visible
- **WHEN** a user requests the list of cards while the active company is company A
- **THEN** the system returns only cards belonging to company A
