## ADDED Requirements

### Requirement: Receivables Report
The system SHALL produce a receivables report listing the charges of the period, with customer, description, original amount, penalty, interest, total due, due date and status, ordered by due date ascending. The report SHALL be filterable by customer and by status, and SHALL return totals for issued, overdue and received amounts. Charges are selected by due date within the period.

#### Scenario: Receivables for a period
- **WHEN** a user requests the receivables report for August 2026
- **THEN** the system returns the charges due in that period with their amounts and status, plus the issued, overdue and received totals

#### Scenario: Filter receivables by status
- **WHEN** a user requests the receivables report filtered by status "Overdue"
- **THEN** the system returns only the overdue charges, each with its accrued penalty and interest

#### Scenario: Period without charges
- **WHEN** a user requests the receivables report for a period with no charges
- **THEN** the system returns an empty report with zeroed totals

### Requirement: Payables Report
The system SHALL produce a payables report listing the payables of the period, with supplier, description, amount, due date, category, cost center and status, ordered by due date ascending. The report SHALL be filterable by supplier, category, cost center and status, and SHALL return totals for pending, overdue and paid amounts. Payables are selected by due date within the period.

#### Scenario: Payables for a period
- **WHEN** a user requests the payables report for August 2026
- **THEN** the system returns the payables due in that period with their amounts and status, plus the pending, overdue and paid totals

#### Scenario: Filter payables by supplier
- **WHEN** a user requests the payables report filtered by a supplier
- **THEN** the system returns only that supplier's payables in the period

## MODIFIED Requirements

### Requirement: Spending Reports by Dimension
The system SHALL produce spending reports grouped by category, by cost center, by card or by account. Each entry SHALL carry the dimension value, the total amount and its percentage of the period's total, ordered by amount descending. The spending-by-category report SHALL roll subcategories up into their top-level category, and the spending-by-cost-center report SHALL roll child cost centers up into their top-level cost center. Transactions with no value for the requested dimension SHALL be grouped under a single "Sem classificação" entry.

#### Scenario: Spending by category
- **WHEN** a user requests the spending-by-category report from 05/2026 to 07/2026
- **THEN** the system returns a table with the total per category in the period and each one's percentage of the total

#### Scenario: Spending by cost center
- **WHEN** a user requests the spending-by-cost-center report for a period in which "Marketing" and "TI" have expenses
- **THEN** the system returns the total spent per cost center in the period and each one's percentage of the total

#### Scenario: Child cost centers roll up
- **WHEN** the period has expenses in "Marketing" and in its child "Mídia Paga"
- **THEN** the spending-by-cost-center report reports both amounts under "Marketing"

#### Scenario: Transactions without a cost center
- **WHEN** the period has expenses with no cost center informed
- **THEN** the spending-by-cost-center report groups them under "Sem classificação"

#### Scenario: Spending by card
- **WHEN** a user requests the spending-by-card report for a period
- **THEN** the system returns the total charged to each card in the period

#### Scenario: Spending by account
- **WHEN** a user requests the spending-by-account report for a period
- **THEN** the system returns the total spent from each account in the period

### Requirement: Report Parameters
The system SHALL accept, for every report, a period defined by a start date and an end date, and optionally a list of accounts to restrict the result. A period whose start date is later than its end date MUST be rejected. Every report SHALL be scoped to the active company taken from the authenticated context. Reports over transactions SHALL consider only confirmed transactions; the receivables and payables reports operate over charges and payables and are not restricted by transaction status.

#### Scenario: Report over a period
- **WHEN** a user requests a report from 01/05/2026 to 31/07/2026
- **THEN** the system returns the report computed from the confirmed transactions of that period

#### Scenario: Invalid period
- **WHEN** a user requests a report whose start date is later than its end date
- **THEN** the system rejects the request with a validation error

#### Scenario: Company isolation
- **WHEN** a user requests a report while the active company is company A
- **THEN** the report contains only company A data

#### Scenario: Receivables are not filtered by transaction status
- **WHEN** a user requests the receivables report for a period
- **THEN** the system includes charges that have generated no transaction yet
