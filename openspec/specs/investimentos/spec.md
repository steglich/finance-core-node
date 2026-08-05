# Investimentos Specification

## Purpose

Investments held by a company — the asset itself, the operations that move it (buy, sell, dividends, interest, amortization), the manually registered quotes that price it, and the position and profitability derived from all of that. Every operation that moves money also moves the linked account, so an investment is never a parallel ledger.

## Requirements

### Requirement: Register Investment
The system SHALL allow users to register an investment within a company with: a name, a type, an optional symbol or identification (ticker, ISIN, contract number), a currency (ISO 4217), a linked financial account of the same company, an expense category used by purchases and an income category used by sales and proceeds. The supported types SHALL be STOCK (Ação), REIT (FII), TREASURY (Tesouro), CD (CDB), CRYPTO (Cripto), ETF, FUND (Fundo) and PENSION (Previdência). The linked account MUST be active and MUST have the same currency as the investment. A new investment starts with status "Active" and an empty position, and the system SHALL publish InvestmentCreated.

#### Scenario: Register a stock investment
- **WHEN** a user registers an investment of type STOCK named "Petrobras PN" with symbol "PETR4", currency "BRL", linked to the account "Corretora XP"
- **THEN** the system creates the investment with status "Active", zero quantity and zero cost, and publishes InvestmentCreated

#### Scenario: Investment with an unsupported type
- **WHEN** a user attempts to register an investment of type "IMOVEL"
- **THEN** the system rejects the registration with a validation error

#### Scenario: Investment linked to an account of another company
- **WHEN** a user attempts to link an investment to an account that belongs to a different company
- **THEN** the system rejects the registration

#### Scenario: Investment linked to an inactive account
- **WHEN** a user attempts to link an investment to an inactive account
- **THEN** the system rejects the registration

#### Scenario: Investment whose currency differs from the account
- **WHEN** a user attempts to register an investment in USD linked to a BRL account
- **THEN** the system rejects the registration and reports the currency mismatch

### Requirement: Register Investment Operation
The system SHALL allow users to register operations on an active investment. The operation types SHALL be BUY, SELL, DIVIDEND, INTEREST and AMORTIZATION. Every operation MUST have a date not in the future and an amount greater than zero. BUY and SELL MUST also carry a quantity greater than zero and a unit price greater than zero, and the operation amount SHALL be quantity multiplied by unit price plus fees. Operations MUST be registered in a currency equal to the investment currency. The system SHALL publish InvestmentOperationRegistered for every accepted operation.

#### Scenario: Register a purchase
- **WHEN** a user registers the purchase of 100 shares of PETR4 at R$ 32,50 each
- **THEN** the system records a BUY operation of R$ 3.250,00 for 100 units and publishes InvestmentOperationRegistered

#### Scenario: Operation with a future date
- **WHEN** a user attempts to register an operation dated after today
- **THEN** the system rejects the operation with a validation error

#### Scenario: Purchase without quantity
- **WHEN** a user attempts to register a BUY operation without informing a quantity
- **THEN** the system rejects the operation

#### Scenario: Operation on a closed investment
- **WHEN** a user attempts to register an operation on an investment whose status is "Closed"
- **THEN** the system rejects the operation

### Requirement: Operations Move the Linked Account
Every investment operation SHALL produce a confirmed transaction on the investment's linked account, atomically with the operation itself: BUY produces an expense, and SELL, DIVIDEND, INTEREST and AMORTIZATION produce income. The transaction SHALL reference the investment, and both the transaction and the operation SHALL be persisted in the same atomic write — if either fails, neither is recorded. BUY transactions SHALL be classified with the investment's expense category and the money-in operations with its income category; both categories are defined when the investment is registered and MAY be overridden per operation by a category of the matching type belonging to the same company.

#### Scenario: Purchase debits the account
- **WHEN** a user registers the purchase of R$ 3.250,00 of PETR4
- **THEN** the system creates a confirmed expense transaction of R$ 3.250,00 on the linked account, referencing the investment, and the account balance is reduced by R$ 3.250,00

#### Scenario: Dividends credit the account
- **WHEN** a user registers R$ 50,00 of dividends from PETR4
- **THEN** the system creates a confirmed income transaction of R$ 50,00 on the linked account, linked to the investment

#### Scenario: Purchase without sufficient balance
- **WHEN** a user attempts to register a purchase larger than the linked account's available balance
- **THEN** the system rejects the operation and creates neither the operation nor the transaction

#### Scenario: Failure leaves nothing behind
- **WHEN** the creation of the operation's transaction fails
- **THEN** the system records neither the operation nor the transaction, and the account balance is unchanged

### Requirement: Derived Position and Average Cost
The system SHALL derive the position of an investment from its operations and MUST NOT persist it as a field of the investment. The quantity SHALL be the sum of BUY quantities minus the sum of SELL quantities. The average cost SHALL be the total cost of the remaining quantity divided by that quantity, updated by each BUY and unchanged by a SELL. A SELL SHALL reduce the invested cost by the sold quantity valued at the average cost, and the difference against the sale amount SHALL be recorded as realized profit or loss.

#### Scenario: Position after a purchase
- **WHEN** a user has registered the purchase of 100 shares of PETR4 at R$ 32,50
- **THEN** the investment shows an invested amount of R$ 3.250,00 and a position of 100 shares

#### Scenario: Average cost after two purchases
- **WHEN** a user buys 100 shares at R$ 30,00 and later 100 shares at R$ 40,00
- **THEN** the position is 200 shares with an average cost of R$ 35,00 and an invested amount of R$ 7.000,00

#### Scenario: Partial sale
- **WHEN** a user holding 200 shares at an average cost of R$ 35,00 sells 50 shares at R$ 40,00
- **THEN** the position becomes 150 shares, the average cost remains R$ 35,00, the invested amount becomes R$ 5.250,00 and a realized profit of R$ 250,00 is recorded

#### Scenario: Sale larger than the position
- **WHEN** a user attempts to sell 300 shares while holding 200
- **THEN** the system rejects the operation and reports insufficient quantity

### Requirement: Investment Quotes
The system SHALL allow users to register quotes for an investment: a unit price greater than zero on a given date, in the investment's currency. Registering a quote for a date that already has one SHALL replace it. The current value of an investment on a reference date SHALL be the position quantity multiplied by the most recent quote whose date is not later than the reference date. When no such quote exists, the current value SHALL fall back to the invested amount and the response MUST flag that no quote is available.

#### Scenario: Register a quote
- **WHEN** a user registers a quote of R$ 38,00 for PETR4 on 31/07/2026
- **THEN** the system stores the quote and the current value on that date becomes the position quantity multiplied by R$ 38,00

#### Scenario: Value uses the quote of the date, not the latest one
- **WHEN** a user requests the value of PETR4 on 15/07/2026 and quotes exist for 10/07/2026 and 31/07/2026
- **THEN** the system uses the quote of 10/07/2026

#### Scenario: Investment without any quote
- **WHEN** a user requests the value of an investment that has no quote
- **THEN** the system returns the invested amount as the current value and flags that no quote is available

#### Scenario: Non-positive quote
- **WHEN** a user attempts to register a quote of R$ 0,00
- **THEN** the system rejects the quote with a validation error

### Requirement: Portfolio Position and Profitability
The system SHALL produce, for a company and a reference date, the consolidated investment portfolio: per investment the type, quantity, invested amount, current value, unrealized result and profitability percentage; and for the portfolio the totals plus the distribution by investment type. Profitability SHALL be computed as (current value + realized result + income received − invested amount) divided by the invested amount, expressed as a percentage. An investment whose invested amount is zero SHALL report a profitability of zero rather than an error.

#### Scenario: Portfolio profitability
- **WHEN** a company has invested R$ 10.000,00 and the current value of the portfolio is R$ 11.500,00, with no sales and no income received
- **THEN** the system reports a profitability of +15%

#### Scenario: Distribution by type
- **WHEN** a user opens the investment dashboard holding stocks, FIIs and treasury bonds
- **THEN** the system returns the current value and the share of the portfolio for each type

#### Scenario: Profitability including dividends
- **WHEN** an investment of R$ 1.000,00 is worth R$ 1.000,00 and has paid R$ 100,00 of dividends
- **THEN** the system reports a profitability of +10%

#### Scenario: Empty portfolio
- **WHEN** a company with no investments requests the portfolio
- **THEN** the system returns zeroed totals rather than an error

### Requirement: Close Investment
The system SHALL allow users to close an investment only when its position quantity is zero. A closed investment MUST NOT accept new operations and MUST remain visible in historical reports. The system SHALL publish InvestmentClosed. Investments MUST NOT be physically deleted.

#### Scenario: Close a fully sold investment
- **WHEN** a user closes an investment whose position is zero
- **THEN** the system marks it as "Closed" and publishes InvestmentClosed

#### Scenario: Close an investment with an open position
- **WHEN** a user attempts to close an investment that still holds 50 shares
- **THEN** the system rejects the closing and reports the open position

#### Scenario: Closed investment stays in reports
- **WHEN** a user requests the investment report for a period that contains operations of a closed investment
- **THEN** those operations are included

### Requirement: Investment Company Isolation
Every investment, operation and quote SHALL belong to exactly one company and SHALL only be readable and writable within that company's scope, taken from the authenticated context.

#### Scenario: Investment of another company
- **WHEN** a user authenticated for company A requests an investment of company B
- **THEN** the system returns not found
