## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Dashboard Filters
The system SHALL allow filtering the dashboard by period (start and end date), by one or more accounts and by one or more cost centers. When accounts are supplied, every indicator SHALL consider only transactions of those accounts and the net worth SHALL sum only their balances. When cost centers are supplied, the transaction-derived indicators SHALL consider only transactions classified with those cost centers or their descendants, and the net worth SHALL remain unfiltered, since a balance is not attributable to a cost center. An invalid period, where the start date is later than the end date, MUST be rejected.

#### Scenario: Filter by account
- **WHEN** a user filters the dashboard by a single account
- **THEN** the system returns the indicators computed only from that account's transactions and balance

#### Scenario: Filter by cost center
- **WHEN** a user filters the dashboard by cost center "Marketing"
- **THEN** the income, expense and spending-by-category indicators consider only transactions of "Marketing" and its descendants

#### Scenario: Net worth ignores the cost center filter
- **WHEN** a user filters the dashboard by a cost center
- **THEN** the net worth indicator is the same as without the filter

#### Scenario: Invalid period
- **WHEN** a user requests a dashboard whose start date is later than its end date
- **THEN** the system rejects the request with a validation error
