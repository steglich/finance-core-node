# Dashboard Specification

## Purpose

Consolidated view of a company's financial situation for a period — income, expense, net result, net worth, spending by category, monthly evolution — plus the Phase 2 summaries of budgets, goals and cards.

## Requirements

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

### Requirement: Spending by Category
The system SHALL return, for the period, the confirmed expense total grouped by category, each entry carrying the category, the amount and its percentage of the period's total expense, ordered by amount descending. Spending on subcategories SHALL be rolled up into the top-level category.

#### Scenario: Category breakdown
- **WHEN** a user has expenses in 5 categories in the period
- **THEN** the system returns the 5 categories with their amounts and each one's percentage of the total

#### Scenario: No expenses in the period
- **WHEN** the period has no confirmed expenses
- **THEN** the system returns an empty breakdown and does not fail

### Requirement: Monthly Evolution
The system SHALL return the confirmed income and expense totals per month for the last 12 months ending in the reference period, including months with no movement as zero.

#### Scenario: Twelve-month series
- **WHEN** a user opens the dashboard in August 2026
- **THEN** the system returns 12 entries, from September 2025 through August 2026, each with its income and expense totals

#### Scenario: Month without movement
- **WHEN** one of the months in the series has no confirmed transaction
- **THEN** the system returns that month with income R$ 0,00 and expense R$ 0,00

### Requirement: Phase 2 Summaries
The system SHALL additionally return, for the period: a budget summary with the count of budgets, the total planned amount, the total actual amount and the count of exceeded budgets; a goal summary with the count of active goals, the total target amount, the total current amount and the aggregate progress; and a card summary with, per active card, the limit, the available limit, the open invoice amount and the next invoice due date.

#### Scenario: Budget summary
- **WHEN** the company has 4 budgets for the period, one of them exceeded
- **THEN** the system returns 4 budgets, the total planned and actual amounts, and 1 exceeded

#### Scenario: Card summary
- **WHEN** the company has two active credit cards
- **THEN** the system returns, for each card, its limit, available limit, open invoice amount and next due date

#### Scenario: Company without cards, budgets or goals
- **WHEN** the company has none of these records
- **THEN** the system returns empty summaries with zeroed totals

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

### Requirement: Dashboard Scope and Performance
The dashboard MUST only expose data of the active company, taken from the authenticated context and never from the client. The dashboard SHALL respond in less than 3 seconds for a company with up to 10.000 transactions.

#### Scenario: Company isolation
- **WHEN** a user whose active company is company A requests the dashboard
- **THEN** the system returns only company A data, ignoring any company identifier sent by the client

#### Scenario: Response time
- **WHEN** a user with 10.000 transactions opens the dashboard
- **THEN** the system responds in less than 3 seconds

### Requirement: Phase 3 Summaries
The system SHALL additionally return, for the period: a receivables summary with the total amount to receive, the overdue amount, the count of open charges and the count of overdue charges; and a payables summary with the total amount to pay, the overdue amount, the count of pending payables and the count of overdue payables. Amounts to receive SHALL include the penalty and interest accrued on overdue charges. Both summaries consider only charges and payables of the active company whose due date falls within the period.

#### Scenario: Receivables summary
- **WHEN** the company has three open charges totalling R$ 4.500,00 in the period, one of them overdue with R$ 32,50 of penalty and interest
- **THEN** the system returns R$ 4.532,50 to receive, R$ 1.532,50 of it overdue, with 3 open charges and 1 overdue

#### Scenario: Payables summary
- **WHEN** the company has two pending payables totalling R$ 1.300,00 in the period, R$ 300,00 of it overdue
- **THEN** the system returns R$ 1.300,00 to pay, R$ 300,00 of it overdue, with 2 pending payables and 1 overdue

#### Scenario: Company without charges or payables
- **WHEN** the company has neither charges nor payables in the period
- **THEN** the system returns both summaries with zeroed totals and counts

#### Scenario: Paid and cancelled records are excluded
- **WHEN** the period contains charges already paid and payables already cancelled
- **THEN** neither counts toward the amounts to receive or to pay

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
