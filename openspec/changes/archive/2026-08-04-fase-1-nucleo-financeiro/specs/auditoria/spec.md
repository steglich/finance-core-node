## Purpose

Immutable recording of domain events and entity change history for full traceability, compliance, and reconstruction of the timeline of any financial entity.

## ADDED Requirements

### Requirement: Domain Event Logging
The system SHALL publish and persist domain events for all significant domain operations. Each event SHALL include: event type, entity ID, payload, timestamp, and the actor who triggered it. The event log SHALL be append-only and immutable.

#### Scenario: Transaction event logged
- **WHEN** a transaction is confirmed
- **THEN** the system persists a TransactionPosted event with the full transaction payload, timestamp, and the user who confirmed it

#### Scenario: Transfer event logged
- **WHEN** a transfer is completed
- **THEN** the system persists a TransferCompleted event with the transfer ID, source and destination account IDs, amount, and the user who executed it

### Requirement: Entity Change History
The system SHALL record an audit entry for every modification to a domain entity. Each entry SHALL include: timestamp, user ID, entity type, entity ID, operation (CREATE, UPDATE, status change), changed fields, and the previous and new values.

#### Scenario: Track transaction edit
- **WHEN** a user changes a transaction's amount from R$ 100,00 to R$ 120,00
- **THEN** the system records an audit entry with the old value "100.00", new value "120.00", field "amount", operation "UPDATE", and the user who made the change

#### Scenario: Track installment due date change
- **WHEN** a user changes an installment's due date from "2024-08-10" to "2024-08-15"
- **THEN** the system records an audit entry capturing the field, old value, new value, and the user

### Requirement: Access Logs
The system SHALL log authentication events including: successful logins, failed login attempts, logouts, and password changes. Each log entry SHALL include timestamp, user ID (when applicable), IP address, and event type.

#### Scenario: Failed login logged
- **WHEN** a login attempt fails due to incorrect credentials
- **THEN** the system logs a failed authentication event with the email, IP address, and timestamp

#### Scenario: Successful login logged
- **WHEN** a user successfully authenticates
- **THEN** the system logs a successful authentication event with the user ID, IP address, and timestamp

### Requirement: Query Entity History
The system SHALL allow users to query the chronological history of changes for any entity, reconstructing the full timeline of modifications.

#### Scenario: View transaction history
- **WHEN** a user requests the history of transaction #1234
- **THEN** the system returns all audit entries for that transaction in chronological order: creation, edits, and status changes

### Requirement: Audit Log Immutability
The system SHALL ensure that audit and event log records are append-only. Once written, an audit entry MUST NOT be modified or deleted.

#### Scenario: Attempt to delete audit entry
- **WHEN** any operation attempts to modify or delete an existing audit entry
- **THEN** the system rejects the operation

### Requirement: Audit Retention
The system SHALL retain audit and event log records for a minimum of 5 years from the date of recording, in compliance with fiscal requirements.

#### Scenario: Audit records older than 5 years
- **WHEN** audit records exceed 5 years
- **THEN** the system MAY archive them but MUST NOT permanently delete them
