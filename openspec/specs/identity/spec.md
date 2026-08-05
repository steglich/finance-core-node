# Identity Specification

## Purpose

Authentication, user management, company management, and role-based access control for the Finance Core platform.

## Requirements

### Requirement: User Registration
The system SHALL allow visitors to register with name, email, and password. Upon successful registration, the system SHALL automatically create a personal company for the user and assign them the "Administrator" profile.

#### Scenario: Successful registration
- **WHEN** a visitor submits name "João Silva", email "joao@email.com", and a valid password
- **THEN** the system creates a user account, a personal company, and assigns the Administrator profile to the user in that company

#### Scenario: Duplicate email
- **WHEN** a visitor submits an email that is already registered
- **THEN** the system rejects the registration and returns the message "Email já está em uso"

### Requirement: User Authentication
The system SHALL authenticate users by email and password. On success, the system SHALL return a session token and the list of companies the user belongs to. The system SHALL allow the user to select which company to operate within without re-authentication.

#### Scenario: Successful login
- **WHEN** a user submits valid email and password credentials
- **THEN** the system returns a session token and the list of linked companies

#### Scenario: Invalid credentials
- **WHEN** a user submits incorrect email or password
- **THEN** the system rejects authentication with "Email ou senha incorretos"

#### Scenario: Inactive user
- **WHEN** an inactive user attempts to log in
- **THEN** the system rejects authentication with "Usuário desativado. Contate o administrador"

#### Scenario: Switch company without re-authentication
- **WHEN** an authenticated user selects a different company from their list
- **THEN** the system switches the active context without requiring a new login

### Requirement: Password Recovery
The system SHALL allow users to request password recovery by email. The system SHALL send a recovery email with a time-limited reset link.

#### Scenario: Recovery request for existing email
- **WHEN** a user requests password recovery for a registered email
- **THEN** the system sends a recovery email with a reset link valid for a limited time

#### Scenario: Recovery request for unknown email
- **WHEN** a user requests password recovery for an unregistered email
- **THEN** the system responds generically without revealing that the email is not registered

### Requirement: Company Management
The system SHALL allow users to create multiple companies. A company MUST have a name, type (PF for individual or PJ for business), and a default currency. The creator SHALL be assigned the Administrator profile automatically. The system SHALL seed default categories when a company is created.

#### Scenario: Create a new company
- **WHEN** a user creates a company named "Consultoria ABC" with type "PJ" and default currency "BRL"
- **THEN** the system creates the company, seeds default categories, and assigns the user as Administrator

#### Scenario: List user companies
- **WHEN** an authenticated user requests their companies
- **THEN** the system returns all companies where the user has an active profile

### Requirement: Profile Management
The system SHALL allow administrators to create, edit, and delete profiles within a company. Each profile SHALL consist of a name and a set of granular permissions. A profile with assigned users MUST NOT be deleted.

#### Scenario: Create a profile
- **WHEN** an administrator creates a profile "Operador" with permissions "financeiro.transacao.criar" and "financeiro.transacao.ler"
- **THEN** the system creates the profile with the specified permissions

#### Scenario: Delete profile with assigned users
- **WHEN** an administrator attempts to delete a profile that has users assigned to it
- **THEN** the system prevents deletion and suggests reassigning users first

### Requirement: User Invitations
The system SHALL allow administrators to invite users to a company by email, specifying a profile. The invited user SHALL receive an invitation email and, upon acceptance, SHALL be linked to the company with the specified profile.

#### Scenario: Invite a user
- **WHEN** an administrator invites "maria@email.com" with profile "Operador"
- **THEN** the system sends an invitation email and creates a pending invitation

#### Scenario: Accepted invitation
- **WHEN** the invited user accepts the invitation
- **THEN** the user is linked to the company with the "Operador" profile

### Requirement: User Removal
The system SHALL allow administrators to remove users from a company. The removed user SHALL immediately lose access to that company's data.

#### Scenario: Remove user from company
- **WHEN** an administrator removes user "joao@email.com" from the company
- **THEN** the user loses all access to the company's resources

### Requirement: Session Token Expiration
The system SHALL expire session tokens after 24 hours of inactivity. The system SHALL reject requests with expired or invalid tokens.

#### Scenario: Expired token
- **WHEN** a request is made with a token that has been inactive for more than 24 hours
- **THEN** the system rejects the request with an authentication error

### Requirement: Password Security
The system SHALL store passwords using a cryptographic hash algorithm (bcrypt or argon2). The system MUST NOT store or log plain-text passwords.

#### Scenario: Password storage
- **WHEN** a user registers or changes their password
- **THEN** the system hashes the password before storage, and the plain-text password is never stored
