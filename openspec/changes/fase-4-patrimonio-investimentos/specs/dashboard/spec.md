## ADDED Requirements

### Requirement: Phase 4 Summaries
The system SHALL additionally return, for the reference date of the period: an investments summary with the invested amount, the current value, the unrealized result, the profitability percentage and the distribution of the current value by investment type; and a debt summary with the total outstanding balance of loans that are not settled, the amount of installments due within the period, the overdue amount and the count of overdue installments. Both summaries consider only records of the active company.

#### Scenario: Investments summary
- **WHEN** the company has invested R$ 10.000,00 and the current value of the portfolio is R$ 11.500,00
- **THEN** the system returns an invested amount of R$ 10.000,00, a current value of R$ 11.500,00, an unrealized result of R$ 1.500,00 and a profitability of +15%

#### Scenario: Debt summary
- **WHEN** the company has one loan with an outstanding balance of R$ 8.000,00 and two overdue installments totalling R$ 1.040,00
- **THEN** the system returns an outstanding balance of R$ 8.000,00, an overdue amount of R$ 1.040,00 and 2 overdue installments

#### Scenario: Company without investments or loans
- **WHEN** the company has neither investments nor loans
- **THEN** the system returns both summaries with zeroed values

#### Scenario: Settled loans are excluded from the debt summary
- **WHEN** the company has a settled loan
- **THEN** its principal is not counted in the outstanding balance

## MODIFIED Requirements

### Requirement: Period Indicators
The system SHALL return, for the current company and a given period, the total confirmed income, the total confirmed expense, the net result (income minus expense) and the net worth. The net worth SHALL be the total assets minus the total liabilities at the end of the period: assets comprise the balances of active accounts, the current value of the investment portfolio and the open receivables; liabilities comprise the outstanding balance of loans that are not settled, the open credit-card invoices and the open payables. The indicators SHALL be expressed in an optional display currency, defaulting to the company's default currency, converting each component with the exchange rate in force on the reference date. Cancelled and refunded transactions MUST NOT be included. When no period is supplied, the system SHALL use the current month.

#### Scenario: Indicators for the month
- **WHEN** a user opens the dashboard for a month with R$ 8.000,00 of income and R$ 6.500,00 of expense
- **THEN** the system returns income R$ 8.000,00, expense R$ 6.500,00 and a net result of R$ 1.500,00

#### Scenario: Net worth
- **WHEN** a company has three active accounts with balances of R$ 3.000,00, R$ 1.500,00 and R$ 500,00, an investment portfolio worth R$ 10.000,00 and a loan with an outstanding balance of R$ 4.000,00
- **THEN** the system returns a net worth of R$ 11.000,00

#### Scenario: Default period
- **WHEN** a user opens the dashboard without supplying a period
- **THEN** the system returns the indicators of the current month

#### Scenario: Cancelled transactions are excluded
- **WHEN** the period contains a cancelled expense of R$ 300,00
- **THEN** the system does not include that amount in the total expense

#### Scenario: Accounts in more than one currency
- **WHEN** a company holds a BRL account with R$ 10.000,00 and a USD account with $1.000,00, and the USD→BRL rate of the reference date is 5,20
- **THEN** the net worth counts R$ 15.200,00 from the accounts, expressed in BRL

### Requirement: Dashboard Filters
The system SHALL allow filtering the dashboard by period (start and end date), by one or more accounts and by one or more cost centers. When accounts are supplied, every indicator SHALL consider only transactions of those accounts and the net worth SHALL consider only their balances and the investments linked to them. When cost centers are supplied, the transaction-derived indicators SHALL consider only transactions classified with those cost centers or their descendants, and the net worth, the investments summary and the debt summary SHALL remain unfiltered, since a balance, a position and a debt are not attributable to a cost center. An invalid period, where the start date is later than the end date, MUST be rejected.

#### Scenario: Filter by account
- **WHEN** a user filters the dashboard by a single account
- **THEN** the system returns the indicators computed only from that account's transactions and balance

#### Scenario: Filter by cost center
- **WHEN** a user filters the dashboard by cost center "Marketing"
- **THEN** the income, expense and spending-by-category indicators consider only transactions of "Marketing" and its descendants

#### Scenario: Net worth ignores the cost center filter
- **WHEN** a user filters the dashboard by a cost center
- **THEN** the net worth indicator is the same as without the filter

#### Scenario: Investments and debt ignore the cost center filter
- **WHEN** a user filters the dashboard by a cost center
- **THEN** the investments summary and the debt summary are the same as without the filter

#### Scenario: Invalid period
- **WHEN** a user requests a dashboard whose start date is later than its end date
- **THEN** the system rejects the request with a validation error
