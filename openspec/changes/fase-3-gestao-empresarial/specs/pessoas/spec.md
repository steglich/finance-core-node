## Purpose

Registry of the natural and legal persons a company deals with, classified as customers, suppliers or payees, together with the payee bank details and the derived customer and supplier ledgers that summarise what is owed in each direction.

## ADDED Requirements

### Requirement: Register Person
The system SHALL allow users to register a person within a company with a name, a person type (INDIVIDUAL or LEGAL_ENTITY) and a document — CPF for INDIVIDUAL, CNPJ for LEGAL_ENTITY. Optional fields are email, phone and address. The document MUST be structurally valid for its type and MUST be unique within the company. The email, when provided, MUST be a valid email address. A new person starts active, and the system SHALL publish PersonRegistered.

#### Scenario: Register an individual
- **WHEN** a user registers "João Silva" as INDIVIDUAL with a valid CPF
- **THEN** the system creates the person as active and publishes PersonRegistered

#### Scenario: Register a legal entity
- **WHEN** a user registers "Fornecedor XYZ" as LEGAL_ENTITY with a valid CNPJ
- **THEN** the system creates the person as active

#### Scenario: Invalid document
- **WHEN** a user attempts to register an INDIVIDUAL with a CPF whose check digits are wrong
- **THEN** the system rejects the registration with a validation error

#### Scenario: Document type does not match person type
- **WHEN** a user attempts to register an INDIVIDUAL informing a CNPJ
- **THEN** the system rejects the registration with a validation error

#### Scenario: Duplicate document in the same company
- **WHEN** a user attempts to register a person whose document already belongs to another person of the same company
- **THEN** the system rejects the registration with a duplicate entity error

#### Scenario: Same document in another company
- **WHEN** a user registers a person whose document already exists in a different company
- **THEN** the system accepts the registration, since uniqueness is scoped to the company

### Requirement: Classify Person
The system SHALL allow a person to carry one or more classifications: CUSTOMER, SUPPLIER or PAYEE. Classifications SHALL be assignable and removable independently, and the same person MAY hold several at once. A classification MUST NOT be removed while it is referenced by an open record — CUSTOMER while the person has charges that are not paid or cancelled, SUPPLIER while the person has payables that are not paid or cancelled.

#### Scenario: Classify as customer
- **WHEN** a user marks "João Silva" as CUSTOMER
- **THEN** the person appears in the customer list of the company

#### Scenario: Person is customer and supplier
- **WHEN** a user marks the same person as CUSTOMER and SUPPLIER
- **THEN** the person appears in both lists

#### Scenario: Remove a classification in use
- **WHEN** a user attempts to remove the CUSTOMER classification of a person who has an issued charge
- **THEN** the system rejects the removal

#### Scenario: List by classification
- **WHEN** a user requests the list of suppliers
- **THEN** the system returns only the active people of the company classified as SUPPLIER

### Requirement: Payee Bank Details
The system SHALL allow registering one or more bank accounts for a person classified as PAYEE, each with either a PIX key or a bank/branch/account triple, plus an optional label. A PIX key MUST be one of the accepted forms: CPF, CNPJ, email, phone or random key (UUID). One bank account per payee MAY be flagged as the default.

#### Scenario: Register a PIX key
- **WHEN** a user registers a PIX key of type email for payee "Maria"
- **THEN** the system stores the bank detail and it becomes selectable when composing a payment

#### Scenario: Invalid PIX key
- **WHEN** a user attempts to register a PIX key that matches none of the accepted forms
- **THEN** the system rejects it with a validation error

#### Scenario: Bank details for a non-payee
- **WHEN** a user attempts to register bank details for a person not classified as PAYEE
- **THEN** the system rejects the operation

#### Scenario: Change the default bank account
- **WHEN** a user flags a second bank account of the payee as the default
- **THEN** the system clears the flag from the previous one, so at most one default exists

### Requirement: Customer Ledger
The system SHALL provide, for a person classified as CUSTOMER, a derived view containing the total outstanding amount, the date and amount of the last charge, and the history of charges with status, due date, original amount and settled amount. The outstanding total SHALL be the sum of the amounts still due on charges whose status is Issued or Overdue, including penalty and interest accrued on overdue ones. No amount in this view is stored — all values are derived from the charges.

#### Scenario: Outstanding total of a customer
- **WHEN** a customer has three unpaid charges of R$ 500,00 each
- **THEN** the customer ledger shows an outstanding total of R$ 1.500,00

#### Scenario: Paid charges do not count
- **WHEN** a customer has two paid charges and one issued charge of R$ 500,00
- **THEN** the outstanding total is R$ 500,00 and the history lists all three charges

#### Scenario: Customer with no charges
- **WHEN** a user opens the ledger of a customer with no charges
- **THEN** the system returns an outstanding total of zero and an empty history

### Requirement: Supplier Ledger
The system SHALL provide, for a person classified as SUPPLIER, a derived view containing the total amount owed, the list of pending payables ordered by due date ascending, and the amount already overdue. The owed total SHALL be the sum of the outstanding amounts of payables whose status is Pending or Overdue.

#### Scenario: Supplier with pending payments
- **WHEN** a supplier has payables of R$ 1.000,00 due next week and R$ 300,00 overdue
- **THEN** the supplier ledger shows R$ 1.300,00 owed, R$ 300,00 of it overdue, with the overdue one listed first

#### Scenario: Supplier without pending payments
- **WHEN** a user opens the ledger of a supplier whose payables are all paid
- **THEN** the system returns an owed total of zero

### Requirement: Manage People
The system SHALL allow users to list, filter and view the people of the current company, to edit their name, email, phone and address, and to deactivate a person. A person's document and person type MUST NOT be edited after registration. People MUST NOT be physically deleted; deactivation SHALL be rejected while the person has charges or payables that are not paid or cancelled. Every registration, edit, classification change and deactivation SHALL be recorded in the audit log.

#### Scenario: Edit a person
- **WHEN** a user changes the phone and address of a person
- **THEN** the system updates the person and records an audit entry

#### Scenario: Edit an immutable field
- **WHEN** a user attempts to change the document of an existing person
- **THEN** the system rejects the edit

#### Scenario: Deactivate a person
- **WHEN** a user deactivates a person with no open charges or payables
- **THEN** the person stops appearing in the default lists and can no longer be selected on new records

#### Scenario: Deactivate a person with open records
- **WHEN** a user attempts to deactivate a person with an overdue charge
- **THEN** the system rejects the deactivation

#### Scenario: Person of another company
- **WHEN** a user requests a person that belongs to a different company
- **THEN** the system returns a not-found error
