# Metas Specification

## Purpose

Financial goals with a target amount, a deadline and a linked account, advanced by contributions until the target is reached, following their own state machine.

## Requirements

### Requirement: Create Goal
The system SHALL allow users to create a goal within a company with a name, a target amount greater than zero, a deadline and a linked active account. The goal currency SHALL be the currency of the linked account. A new goal starts with status "Created", a current amount of zero and 0% progress, and the system SHALL publish GoalCreated.

#### Scenario: Create a goal
- **WHEN** a user creates a goal "Viagem" with a target of R$ 15.000,00 and a deadline of 12/2027 linked to an active account
- **THEN** the system creates the goal with status "Created" and 0% progress, and publishes GoalCreated

#### Scenario: Goal with a non-positive target
- **WHEN** a user attempts to create a goal with a target amount of R$ 0,00
- **THEN** the system rejects the creation with a validation error

#### Scenario: Goal with a past deadline
- **WHEN** a user attempts to create a goal whose deadline is earlier than today
- **THEN** the system rejects the creation with a validation error

#### Scenario: Goal linked to an inactive account
- **WHEN** a user attempts to link a goal to an inactive account
- **THEN** the system rejects the creation

### Requirement: Goal Contribution
The system SHALL allow users to register a contribution to a goal whose status is "Created" or "In Progress", with an amount greater than zero, in the goal currency. Each contribution SHALL be recorded and SHALL increase the goal's current amount. The system SHALL publish ContributionMade with the amount, the resulting current amount and the progress percentage. A contribution MUST NOT be accepted when it would make the current amount exceed the target amount.

#### Scenario: First contribution
- **WHEN** a user contributes R$ 1.500,00 to a goal of R$ 15.000,00 with status "Created"
- **THEN** the goal transitions to "In Progress" with a current amount of R$ 1.500,00 and 10% progress, and the system publishes ContributionMade

#### Scenario: Contribution above the target
- **WHEN** a user attempts to contribute R$ 2.000,00 to a goal of R$ 15.000,00 whose current amount is R$ 14.000,00
- **THEN** the system rejects the contribution, since the current amount MUST NOT exceed the target amount

#### Scenario: Contribution with a non-positive amount
- **WHEN** a user attempts to contribute R$ 0,00
- **THEN** the system rejects the contribution with a validation error

#### Scenario: Contribution in a different currency
- **WHEN** a user attempts to contribute an amount in a currency different from the goal currency
- **THEN** the system rejects the contribution

### Requirement: Goal State Machine
The system SHALL enforce a goal lifecycle with states Created, In Progress, Achieved and Cancelled, and the transitions: Created → In Progress, In Progress → Achieved, Created → Cancelled, In Progress → Cancelled. Any transition out of "Achieved" or "Cancelled" MUST be rejected. When a contribution brings the current amount to the target amount, the goal SHALL transition to "Achieved" and the system SHALL publish GoalAchieved with the achievement date, the number of contributions and the final amount.

#### Scenario: Goal is achieved
- **WHEN** a contribution brings the current amount of a goal of R$ 15.000,00 to R$ 15.000,00
- **THEN** the goal transitions to "Achieved" with 100% progress and the system publishes GoalAchieved

#### Scenario: Contribution to an achieved goal
- **WHEN** a user attempts to contribute to a goal whose status is "Achieved"
- **THEN** the system rejects the contribution

#### Scenario: Cancel a goal
- **WHEN** a user cancels a goal whose status is "Created" or "In Progress"
- **THEN** the goal transitions to "Cancelled" and stops accepting contributions

#### Scenario: Reopen a cancelled goal
- **WHEN** a user attempts to move a cancelled goal back to "In Progress"
- **THEN** the system rejects the transition

### Requirement: Consult Goals
The system SHALL allow users to list the goals of the current company and to view an individual goal with its name, target amount, current amount, progress percentage, deadline, status, linked account and contribution history. Goals MUST NOT be physically deleted.

#### Scenario: View goal progress
- **WHEN** a user opens a goal of R$ 15.000,00 whose current amount is R$ 1.500,00
- **THEN** the system displays a current amount of R$ 1.500,00 and a progress of 10%

#### Scenario: List goals
- **WHEN** a user requests the list of goals for the active company
- **THEN** the system returns each goal with its target amount, current amount, progress and status

#### Scenario: Edit a goal
- **WHEN** a user changes the name, target amount or deadline of a goal that is not achieved or cancelled
- **THEN** the system updates the goal, recomputes the progress and records an audit entry
