# Recorrencias Specification

## Purpose

Configuration and automatic generation of recurring financial transactions with flexible periodicities, termination conditions, and lifecycle management (pause, cancel, reactivate).

## Requirements

### Requirement: Create Recurrence
The system SHALL allow users to create recurring transaction configurations with: description, amount, account, category, periodicity (daily, weekly, biweekly, monthly, quarterly, semiannual, annual), and start date. Optional fields include end date or maximum number of occurrences. The system SHALL generate the first transaction on the start date.

#### Scenario: Create monthly recurrence without end
- **WHEN** a user creates a recurrence of R$ 39,90 monthly for "Netflix", starting 2024-08-01, with no end date
- **THEN** the system creates the recurrence configuration and generates the first transaction on 2024-08-01

#### Scenario: Create recurrence with end date
- **WHEN** a user creates a recurrence of R$ 500,00 monthly, starting 2024-01-01, ending 2024-12-01
- **THEN** the system creates the recurrence and sets the end date; no transactions are generated beyond 2024-12-01

#### Scenario: Create recurrence with max occurrences
- **WHEN** a user creates a recurrence of R$ 200,00 weekly with a maximum of 10 occurrences
- **THEN** the system creates the recurrence; after the 10th transaction is generated, the recurrence is marked as completed

### Requirement: Recurrence Periodicity
The system SHALL support the following periodicities: daily, weekly, biweekly (every 2 weeks), monthly, quarterly (every 3 months), semiannual (every 6 months), and annual.

#### Scenario: Biweekly recurrence
- **WHEN** a user creates a biweekly recurrence starting 2024-08-01
- **THEN** transactions are generated on 2024-08-01, 2024-08-15, 2024-08-29, etc.

### Requirement: Pause Recurrence
The system SHALL allow users to pause an active recurrence. While paused, no new transactions SHALL be generated. The system SHALL allow reactivation, resuming from the next scheduled date.

#### Scenario: Pause and resume
- **WHEN** a user pauses a monthly recurrence, then resumes it 3 months later
- **THEN** no transactions are generated during the pause period, and generation resumes from the next scheduled date after reactivation

### Requirement: Cancel Recurrence
The system SHALL allow users to cancel a recurrence. Cancellation SHALL stop future transaction generation but SHALL NOT affect transactions that have already been generated.

#### Scenario: Cancel recurrence
- **WHEN** a user cancels a recurrence that has already generated 5 transactions
- **THEN** the 5 existing transactions remain unchanged, and no new transactions are generated

### Requirement: Recurrence Schedule Calculation
The system SHALL calculate the next occurrence date based on the periodicity and the start date. The system SHALL handle month-end edge cases (e.g., a monthly recurrence starting on the 31st of a month).

#### Scenario: Monthly recurrence on 31st
- **WHEN** a monthly recurrence starts on 2024-01-31
- **THEN** the next occurrence is on 2024-02-29 (last day of February in a leap year), then 2024-03-31

### Requirement: Invalid Recurrence Configuration
The system SHALL reject recurrence configurations where the end date is before the start date, or where the maximum occurrences is zero or negative.

#### Scenario: End date before start date
- **WHEN** a user creates a recurrence with start date 2024-08-01 and end date 2024-07-01
- **THEN** the system rejects the configuration with a validation error
