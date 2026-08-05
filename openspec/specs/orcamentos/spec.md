# Orcamentos Specification

## Purpose

Planned spending limits per category and period, whose progress is derived from the actual transactions of that category and period, alerting the user when the planned amount is exceeded.

## Requirements

### Requirement: Create Budget
The system SHALL allow users to create a budget within a company for a category and a period, with a planned amount greater than zero. The period MUST be a month/year and MUST have a start date not later than its end date. The category MUST be an expense category of the same company. The system MUST NOT allow two active budgets for the same category and overlapping period.

#### Scenario: Create a monthly budget
- **WHEN** a user creates a budget of R$ 800,00 for category "Alimentação" for August 2026
- **THEN** the system creates the budget with 0% progress and R$ 800,00 remaining

#### Scenario: Duplicate budget for the same category and period
- **WHEN** a user attempts to create a second budget for "Alimentação" in August 2026 while an active one already exists
- **THEN** the system rejects the creation with a duplicate entity error

#### Scenario: Budget with a non-positive planned amount
- **WHEN** a user attempts to create a budget with a planned amount of R$ 0,00
- **THEN** the system rejects the creation with a validation error

#### Scenario: Budget on an income category
- **WHEN** a user attempts to create a budget for a category of type INCOME
- **THEN** the system rejects the creation with a validation error

### Requirement: Budget Progress Is Derived
The system SHALL derive a budget's actual spent amount from the net amount of the confirmed expense transactions of its category — including its descendant categories — whose date falls within the budget period. The progress percentage SHALL be the actual amount divided by the planned amount. The actual amount MUST NOT be directly editable. Cancelled and refunded transactions MUST NOT count toward the actual amount.

#### Scenario: Transaction advances the progress
- **WHEN** a user records a confirmed expense of R$ 200,00 in "Alimentação" within a budget of R$ 800,00 for the period
- **THEN** the system reports an actual amount of R$ 200,00 and a progress of 25%

#### Scenario: Subcategory spending counts toward the parent budget
- **WHEN** a user records a confirmed expense of R$ 150,00 in "Alimentação > Mercado" and a budget exists for "Alimentação"
- **THEN** the system counts the R$ 150,00 toward that budget

#### Scenario: Refunded transaction leaves the progress
- **WHEN** a transaction of R$ 200,00 counted toward a budget is refunded
- **THEN** the system reduces the actual amount by R$ 200,00 and recomputes the progress

#### Scenario: Transaction outside the period does not count
- **WHEN** a user records an expense in "Alimentação" dated September while the budget covers August
- **THEN** the system does not include that expense in the August budget

### Requirement: Budget Exceeded Alert
The system SHALL publish BudgetExceeded the first time a budget's actual amount exceeds its planned amount, carrying the budget, category, period, planned amount, actual amount and percentage used. The event MUST NOT be published again for the same budget period unless the budget returns below 100% and is exceeded again.

#### Scenario: Budget is exceeded
- **WHEN** spending in "Alimentação" reaches R$ 850,00 against a planned R$ 800,00
- **THEN** the system reports 106,25% used, flags the budget as exceeded and publishes BudgetExceeded

#### Scenario: No duplicate alert
- **WHEN** a further expense is recorded on a budget that is already flagged as exceeded
- **THEN** the system updates the progress but does not publish BudgetExceeded again

#### Scenario: Budget returns below the limit
- **WHEN** a refund brings an exceeded budget back below 100% and a new expense exceeds it again
- **THEN** the system publishes BudgetExceeded once more

### Requirement: Budget Period Closing
The system SHALL close a budget period once its end date has passed, freezing the actual amount and publishing BudgetPeriodClosed with the planned amount, the actual amount and the variance. A closed budget period MUST NOT be reopened and MUST NOT accept edits.

#### Scenario: Period closes
- **WHEN** the scheduled process detects a budget whose period ended with a planned amount of R$ 800,00 and an actual amount of R$ 850,00
- **THEN** the system closes the period and publishes BudgetPeriodClosed with a variance of -R$ 50,00

#### Scenario: Editing a closed budget
- **WHEN** a user attempts to change the planned amount of a budget whose period is closed
- **THEN** the system rejects the change

### Requirement: Manage Budgets
The system SHALL allow users to edit the planned amount of a budget whose period is not closed, to deactivate a budget, and to list the company's budgets for a given period with planned amount, actual amount, percentage used and remaining amount. Budgets MUST NOT be physically deleted.

#### Scenario: Edit the planned amount
- **WHEN** a user changes a budget's planned amount from R$ 800,00 to R$ 1.000,00 during the period
- **THEN** the system updates the planned amount, recomputes the progress and records an audit entry

#### Scenario: List budgets for a period
- **WHEN** a user requests the budgets for August 2026
- **THEN** the system returns each budget of that period with its planned amount, actual amount, percentage used and remaining amount

#### Scenario: Deactivate a budget
- **WHEN** a user deactivates a budget
- **THEN** the system marks it as inactive, preserves the record, and stops counting new transactions toward it
