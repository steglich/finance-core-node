## ADDED Requirements

### Requirement: Token Type Separation
The system SHALL issue access tokens and refresh tokens that are cryptographically distinguishable from one another. Each token SHALL carry a type claim, an issuer and an audience, and verification SHALL reject a token whose type does not match the one expected at that point of use. A refresh token MUST NOT be accepted as proof of authentication on a protected route, and an access token MUST NOT be accepted as grounds for issuing new credentials.

#### Scenario: Refresh token presented as a bearer credential
- **WHEN** a client sends a valid, unexpired refresh token in the `Authorization: Bearer` header of a protected route
- **THEN** the system rejects the request as unauthorized

#### Scenario: Access token presented for renewal
- **WHEN** a client submits a valid, unexpired access token to the token renewal endpoint
- **THEN** the system rejects the renewal as unauthorized

#### Scenario: Token from another issuer or audience
- **WHEN** a request carries a token that is correctly signed but whose issuer or audience does not match the ones this system expects
- **THEN** the system rejects the request as unauthorized

#### Scenario: Correct token used in its own role
- **WHEN** a client sends a valid access token to a protected route, or a valid refresh token to the renewal endpoint
- **THEN** the system accepts it and proceeds

### Requirement: Refresh Revalidation
The system SHALL re-verify, at every token renewal, that the subject of the refresh token is still an active user and is still linked to the company carried by that token. Renewal SHALL fail when either condition no longer holds, so that a refresh token cannot outlive the access it represents.

#### Scenario: User deactivated after the refresh token was issued
- **WHEN** a client renews with a refresh token whose user has since been deactivated
- **THEN** the system refuses to issue new credentials and returns an authentication error

#### Scenario: User removed from the company after the refresh token was issued
- **WHEN** a client renews with a refresh token scoped to a company the user no longer belongs to
- **THEN** the system refuses to issue new credentials and returns an authentication error

#### Scenario: User still active and still linked
- **WHEN** a client renews with a refresh token whose user is active and still linked to the token's company
- **THEN** the system issues a new access token and a new refresh token

### Requirement: Signing Secret Strength
The system SHALL validate the strength of the token signing secret during startup and SHALL refuse to start when the secret is absent or shorter than 32 bytes. A weak secret MUST NOT be accepted silently.

#### Scenario: Weak signing secret
- **WHEN** the process starts with a signing secret shorter than 32 bytes
- **THEN** startup fails with an explicit configuration error and the server does not accept requests

#### Scenario: Absent signing secret
- **WHEN** the process starts with no signing secret configured
- **THEN** startup fails with an explicit configuration error

## MODIFIED Requirements

### Requirement: User Authentication
The system SHALL authenticate users by email and password. On success, the system SHALL return a session token and the list of companies the user belongs to. The system SHALL allow the user to select which company to operate within without re-authentication.

Every authentication failure — unknown email, wrong password, or inactive account — SHALL produce the same HTTP status and the same message, and MUST NOT echo the submitted email back to the client. The system SHALL perform equivalent password-verification work whether or not the email corresponds to an existing account, so that response time does not disclose account existence.

#### Scenario: Successful login
- **WHEN** a user submits valid email and password credentials
- **THEN** the system returns a session token and the list of linked companies

#### Scenario: Invalid credentials
- **WHEN** a user submits incorrect email or password
- **THEN** the system rejects authentication with "Email ou senha incorretos"

#### Scenario: Unknown email is indistinguishable from wrong password
- **WHEN** one login attempt uses an unregistered email and another uses a registered email with the wrong password
- **THEN** both receive the same status code and the same message, and neither response body contains the submitted email

#### Scenario: Response time does not disclose account existence
- **WHEN** a login attempt is made for an unregistered email
- **THEN** the system performs password-verification work equivalent to the registered-email path before responding

#### Scenario: Inactive user
- **WHEN** an inactive user attempts to log in
- **THEN** the system rejects authentication with the same status and message as any other failed attempt

#### Scenario: Switch company without re-authentication
- **WHEN** an authenticated user selects a different company from their list
- **THEN** the system switches the active context without requiring a new login

### Requirement: Password Recovery
The system SHALL allow users to request password recovery by email. The system SHALL send a recovery email with a time-limited reset link. Until the reset flow is implemented, the reset endpoint SHALL declare itself unimplemented rather than reporting success; it MUST NOT claim a password was changed when no change occurred.

#### Scenario: Recovery request for existing email
- **WHEN** a user requests password recovery for a registered email
- **THEN** the system sends a recovery email with a reset link valid for a limited time

#### Scenario: Recovery request for unknown email
- **WHEN** a user requests password recovery for an unregistered email
- **THEN** the system responds generically without revealing that the email is not registered

#### Scenario: Reset endpoint while the flow is unimplemented
- **WHEN** a client submits a password reset request
- **THEN** the system responds that the operation is not implemented, and no password is changed

### Requirement: Session Token Expiration
The system SHALL reject requests carrying an expired, malformed, or otherwise invalid token. Access tokens SHALL be short-lived and refresh tokens SHALL be longer-lived, and the two lifetimes SHALL be independent: the expiry of one MUST NOT extend the usable life of the other.

#### Scenario: Expired token
- **WHEN** a request is made with an expired token
- **THEN** the system rejects the request with an authentication error

#### Scenario: Malformed or unsigned token
- **WHEN** a request carries a token that is malformed or not signed by this system
- **THEN** the system rejects the request with an authentication error

#### Scenario: Long refresh lifetime does not extend access
- **WHEN** an access token has expired but its matching refresh token has not
- **THEN** protected routes reject the access token, and access is regained only by renewing through the refresh flow

### Requirement: Profile Management
The system SHALL allow administrators to create, edit, and delete profiles within a company. Each profile SHALL consist of a name and a set of granular permissions. A permission SHALL be expressed as a resource paired with an action drawn from the system's defined action vocabulary, and the values stored by the system — including those provisioned by default — MUST match that vocabulary exactly, so that a permission check resolves as intended. A profile with assigned users MUST NOT be deleted.

#### Scenario: Create a profile
- **WHEN** an administrator creates a profile "Operador" with read and write permissions on transactions
- **THEN** the system creates the profile with the specified permissions

#### Scenario: Default profile permissions resolve
- **WHEN** a permission check runs against a profile provisioned with the system's default permissions
- **THEN** the check resolves against the defined action vocabulary and grants the access those defaults were meant to convey

#### Scenario: Permission outside the vocabulary
- **WHEN** a permission is provisioned with a resource or action outside the defined vocabulary
- **THEN** the system rejects it rather than storing a value no check can ever match

#### Scenario: Delete profile with assigned users
- **WHEN** an administrator attempts to delete a profile that has users assigned to it
- **THEN** the system prevents deletion and suggests reassigning users first
