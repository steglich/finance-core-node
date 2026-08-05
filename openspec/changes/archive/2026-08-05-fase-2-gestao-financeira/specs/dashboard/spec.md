## Purpose

Consolidated view of a company's financial situation for a period — income, expense, net result, net worth, spending by category, monthly evolution — plus the Phase 2 summaries of budgets, goals and cards.

## ADDED Requirements

### Requirement: Period Indicators
The system SHALL return, for the current company and a given period, the total confirmed income, the total confirmed expense, the net result (income minus expense) and the net worth (sum of the current balances of all active accounts). Cancelled and refunded transactions MUST NOT be included. When no period is supplied, the system SHALL use the current month.

#### Scenario: Indicators for the month
- **WHEN** a user opens the dashboard for a month with R$ 8.000,00 of income and R$ 6.500,00 of expense
- **THEN** the system returns income R$ 8.000,00, expense R$ 6.500,00 and a net result of R$ 1.500,00

#### Scenario: Net worth
- **WHEN** a company has three active accounts with balances of R$ 3.000,00, R$ 1.500,00 and R$ 500,00
- **THEN** the system returns a net worth of R$ 5.000,00

#### Scenario: Default period
- **WHEN** a user opens the dashboard without supplying a period
- **THEN** the system returns the indicators of the current month

#### Scenario: Cancelled transactions are excluded
- **WHEN** the period contains a cancelled expense of R$ 300,00
- **THEN** the system does not include that amount in the total expense

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
The system SHALL allow filtering the dashboard by period (start and end date) and by one or more accounts. When accounts are supplied, every indicator SHALL consider only transactions of those accounts and the net worth SHALL sum only their balances. An invalid period, where the start date is later than the end date, MUST be rejected.

#### Scenario: Filter by account
- **WHEN** a user filters the dashboard by a single account
- **THEN** the system returns the indicators computed only from that account's transactions and balance

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
