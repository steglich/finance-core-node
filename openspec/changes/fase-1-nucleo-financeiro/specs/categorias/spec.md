## Purpose

Infinite hierarchical classification of financial transactions for organization, reporting, and analysis.

## ADDED Requirements

### Requirement: Create Category
The system SHALL allow users to create categories with a name, type (EXPENSE or INCOME), optional color, optional icon, and optional parent category. Categories SHALL support infinite hierarchy (a category may have a parent and may be a parent to subcategories).

#### Scenario: Create top-level category
- **WHEN** a user creates category "Alimentação" with type "EXPENSE"
- **THEN** the system creates the category at the root level

#### Scenario: Create subcategory
- **WHEN** a user creates category "Restaurante" with parent "Alimentação"
- **THEN** the system creates the subcategory nested under "Alimentação"

#### Scenario: Create category with color and icon
- **WHEN** a user creates category "Transporte" with color "#FF5733" and icon "car"
- **THEN** the system stores and displays the color and icon

### Requirement: Edit Category
The system SHALL allow users to edit category name, type, color, icon, and parent. The system SHALL register audit entries for changes.

#### Scenario: Move category in hierarchy
- **WHEN** a user moves "Restaurante" from parent "Alimentação" to parent "Lazer"
- **THEN** the system updates the parent reference and records an audit entry

### Requirement: Delete Category
The system SHALL allow users to delete a category only if it has no transactions linked to it and has no subcategories.

#### Scenario: Delete empty category
- **WHEN** a user deletes a category with no transactions and no subcategories
- **THEN** the system removes the category

#### Scenario: Delete category with transactions
- **WHEN** a user attempts to delete a category that is linked to one or more transactions
- **THEN** the system prevents deletion and returns an error

### Requirement: Category Hierarchy
The system SHALL return categories in their hierarchical structure. A category MUST NOT be its own ancestor (no circular references).

#### Scenario: View category tree
- **WHEN** a user requests the category list
- **THEN** the system returns categories organized by hierarchy, with subcategories nested under their parents

#### Scenario: Prevent circular reference
- **WHEN** a user attempts to set a category's parent to one of its own descendants
- **THEN** the system rejects the operation

### Requirement: Category Does Not Alter Transaction Behavior
The system SHALL use categories solely for classification. Changing a transaction's category MUST NOT alter the transaction's value, balance impact, or status.

#### Scenario: Reclassify a transaction
- **WHEN** a user changes a R$ 100 transaction's category from "Alimentação > Restaurante" to "Lazer"
- **THEN** the transaction value, account balance, and status remain unchanged
