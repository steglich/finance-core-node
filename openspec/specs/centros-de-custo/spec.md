# Centros de Custo Specification

## Purpose

Hierarchical organisational units used to classify transactions and budgets, so that spending can be analysed by department or project independently of the accounting category.

## Requirements

### Requirement: Create Cost Center
The system SHALL allow users to create a cost center within a company with a name, an optional description and an optional parent cost center. The name MUST be unique among the siblings of the same parent within the company. The parent MUST belong to the same company and MUST be active. A new cost center starts active.

#### Scenario: Create a root cost center
- **WHEN** a user creates the cost center "Marketing" with no parent
- **THEN** the system creates it as an active root cost center

#### Scenario: Create a child cost center
- **WHEN** a user creates "Mídia Paga" with parent "Marketing"
- **THEN** the system creates it as a child of "Marketing"

#### Scenario: Duplicate name among siblings
- **WHEN** a user attempts to create a second "Marketing" at the root of the same company
- **THEN** the system rejects the creation with a duplicate entity error

#### Scenario: Same name under different parents
- **WHEN** a user creates "Eventos" under "Marketing" while an "Eventos" already exists under "RH"
- **THEN** the system accepts the creation

#### Scenario: Parent of another company
- **WHEN** a user attempts to create a cost center whose parent belongs to a different company
- **THEN** the system rejects the creation

### Requirement: Cost Center Hierarchy
The system SHALL maintain the cost center hierarchy as an acyclic tree with a maximum depth of three levels. A cost center MUST NOT be its own ancestor, and reparenting MUST be rejected when it would create a cycle or exceed the maximum depth.

#### Scenario: Cycle through reparenting
- **WHEN** a user attempts to set a cost center's parent to one of its own descendants
- **THEN** the system rejects the operation with a validation error

#### Scenario: Exceeding maximum depth
- **WHEN** a user attempts to create a fourth-level cost center
- **THEN** the system rejects the creation with a validation error

#### Scenario: Move a subtree
- **WHEN** a user changes the parent of "Mídia Paga" from "Marketing" to "Comercial"
- **THEN** the system moves the cost center with its descendants and keeps the tree acyclic

### Requirement: Classify by Cost Center
The system SHALL allow a cost center to be selected when registering or editing a transaction and when creating a budget. The selected cost center MUST belong to the current company and MUST be active. Classifying by cost center MUST NOT change the behaviour of the transaction — it does not affect amounts, balances or the state machine — following the same principle as categories.

#### Scenario: Classify an expense
- **WHEN** a user registers an expense selecting cost center "Marketing"
- **THEN** the system stores the cost center on the transaction and the amount, balance and status are unchanged compared to the same expense without one

#### Scenario: Inactive cost center
- **WHEN** a user attempts to register a transaction selecting an inactive cost center
- **THEN** the system rejects the transaction with a validation error

#### Scenario: Transaction without cost center
- **WHEN** a user registers a transaction without selecting a cost center
- **THEN** the system accepts it, since the classification is optional

### Requirement: Manage Cost Centers
The system SHALL allow users to list the cost centers of the current company as a tree, to view one with its descendants, to edit its name, description and parent, and to deactivate it. Cost centers MUST NOT be physically deleted. Deactivating a cost center SHALL also deactivate its descendants, and MUST be rejected while any active budget references it. Transactions already classified with a deactivated cost center keep the classification for historical reporting.

#### Scenario: List as a tree
- **WHEN** a user requests the list of cost centers
- **THEN** the system returns the active cost centers of the company organised as a tree

#### Scenario: Deactivate a cost center with children
- **WHEN** a user deactivates "Marketing", which has the child "Mídia Paga"
- **THEN** the system deactivates both and neither can be selected on new records

#### Scenario: Deactivate a cost center used by a budget
- **WHEN** a user attempts to deactivate a cost center referenced by an active budget
- **THEN** the system rejects the deactivation

#### Scenario: Historical transactions are preserved
- **WHEN** a cost center is deactivated after transactions were classified with it
- **THEN** those transactions keep the cost center and still appear in reports for past periods
