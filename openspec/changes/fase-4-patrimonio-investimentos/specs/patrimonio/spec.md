## Purpose

Net worth consolidation — what the company owns minus what it owes, expressed in a display currency — and the consolidation of that figure across the companies the authenticated user belongs to.

## ADDED Requirements

### Requirement: Company Net Worth
The system SHALL produce, for the current company and a reference date, the net worth as total assets minus total liabilities. Assets SHALL comprise the balances of active accounts, the current value of the investment portfolio and the open receivables (issued and overdue charges). Liabilities SHALL comprise the outstanding balance of loans that are not settled, the open credit-card invoices and the open payables (pending and overdue). The result SHALL break the figure down by component so that every value is traceable to its source.

#### Scenario: Net worth breakdown
- **WHEN** a company has R$ 20.000,00 in account balances, R$ 30.000,00 in investments, R$ 5.000,00 of open receivables, R$ 10.000,00 of loan balance and R$ 3.000,00 of open payables
- **THEN** the system returns assets of R$ 55.000,00, liabilities of R$ 13.000,00 and a net worth of R$ 42.000,00, with each component listed

#### Scenario: Company with no data
- **WHEN** a company with no accounts, investments, loans, charges or payables requests its net worth
- **THEN** the system returns zeroed values rather than an error

#### Scenario: Reference date in the past
- **WHEN** a user requests the net worth for 31/12/2025
- **THEN** the system uses the balances, positions and open records as of that date, not the current ones

#### Scenario: Inactive accounts are excluded
- **WHEN** a company has an inactive account with a residual balance
- **THEN** that balance is not counted as an asset

### Requirement: Display Currency
The system SHALL accept an optional display currency for the net worth. Components in other currencies SHALL be converted using the exchange rate in force on the reference date. When the display currency is omitted, the system SHALL use the company's default currency. When a component cannot be converted for lack of a rate, the system MUST report which currency and date are missing a rate instead of silently ignoring the component or assuming a rate of 1.

#### Scenario: Consolidation in BRL
- **WHEN** a company holds a BRL account with R$ 10.000,00 and a USD account with $1.000,00, and the USD→BRL rate for the reference date is 5,20
- **THEN** the system returns a total of R$ 15.200,00 expressed in BRL

#### Scenario: Missing rate
- **WHEN** a component is in a currency that has no exchange rate on or before the reference date
- **THEN** the system reports the missing pair and date and does not produce a partial total presented as complete

#### Scenario: Default display currency
- **WHEN** a user requests the net worth without informing a display currency
- **THEN** the system uses the company's default currency

### Requirement: Multi-Company Consolidation
The system SHALL allow the authenticated user to consolidate the net worth across companies. The set of companies SHALL be resolved from the user's own company memberships and MUST NOT be taken from the request. The result SHALL present the net worth per company plus the consolidated total in the display currency.

#### Scenario: Consolidate three companies
- **WHEN** a user belongs to three companies whose net worths are R$ 50.000,00, R$ 30.000,00 and R$ 20.000,00
- **THEN** the system returns the three lines and a consolidated total of R$ 100.000,00

#### Scenario: Company the user does not belong to
- **WHEN** a user requests the consolidation informing the identifier of a company they do not belong to
- **THEN** that company is not included in the result

#### Scenario: Companies in different currencies
- **WHEN** a user consolidates a BRL company and a USD company with a display currency of BRL
- **THEN** each company's net worth is converted using the rate of the reference date before being added

#### Scenario: User belonging to a single company
- **WHEN** a user who belongs to one company requests the consolidation
- **THEN** the system returns that single line and a total equal to it

### Requirement: Net Worth Evolution
The system SHALL produce the evolution of a company's net worth over a period, with one point per month, each carrying assets, liabilities and net worth at the end of that month in the display currency.

#### Scenario: Twelve-month evolution
- **WHEN** a user requests the net worth evolution for the last 12 months
- **THEN** the system returns 12 points with assets, liabilities and net worth at each month end

#### Scenario: Months before the company had data
- **WHEN** the requested period starts before the company had any account
- **THEN** those months are returned with zeroed values

### Requirement: Consolidation Scope and Performance
Single-company net worth SHALL be scoped to the company of the authenticated context. Multi-company consolidation is the only reading allowed to span companies, and it MUST be limited to the authenticated user's memberships. Net worth and its evolution SHALL be produced in less than 10 seconds for periods of up to 12 months.

#### Scenario: Company isolation of the single-company reading
- **WHEN** a user authenticated for company A requests the net worth
- **THEN** only company A data is considered

#### Scenario: Evolution performance
- **WHEN** a user requests the 12-month net worth evolution of a company with 500.000 transactions
- **THEN** the system produces it in less than 10 seconds
