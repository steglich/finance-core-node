## Purpose

Defines the protections the HTTP API applies to every request regardless of which bounded context serves it: limiting request volume, resolving the real client address, declaring security headers, controlling which origins may call the API, and securing the transport to the database.

## ADDED Requirements

### Requirement: Request Rate Limiting
The system SHALL limit the number of requests accepted from a single client address within a time window, and SHALL reject requests beyond that limit with HTTP 429 and a header indicating when the client may retry. Authentication endpoints SHALL carry a stricter limit than the rest of the API, because each credential verification consumes a fixed and deliberately expensive amount of server CPU. Limits SHALL be configurable per environment.

#### Scenario: Repeated failed logins from one address
- **WHEN** a client exceeds the authentication rate limit within the configured window
- **THEN** the system rejects further authentication attempts with HTTP 429 and a retry indication, without performing password verification

#### Scenario: General traffic beyond the global limit
- **WHEN** a client exceeds the global rate limit on non-authentication routes
- **THEN** the system rejects the excess requests with HTTP 429

#### Scenario: Traffic within the limit
- **WHEN** a client sends requests at a rate below the configured limit
- **THEN** every request is processed normally

#### Scenario: Limits are independent per client address
- **WHEN** one client is being rate-limited
- **THEN** requests from other client addresses continue to be served

### Requirement: Client Address Resolution
The system SHALL resolve the address attributed to a request from the forwarding headers of trusted proxies when, and only when, proxy trust is enabled by configuration. The resolved address SHALL be the one used for rate limiting and for the access trail. When proxy trust is disabled, forwarding headers MUST be ignored so that a client cannot choose the address attributed to it.

#### Scenario: Behind a trusted proxy
- **WHEN** proxy trust is enabled and a request arrives through the proxy carrying forwarding headers
- **THEN** the originating client address, not the proxy address, is used for rate limiting and recorded in the access trail

#### Scenario: Forwarding headers without proxy trust
- **WHEN** proxy trust is disabled and a request carries forwarding headers
- **THEN** the system ignores those headers and attributes the request to the address of the direct connection

#### Scenario: Spoofed forwarding header cannot evade a limit
- **WHEN** a rate-limited client varies the forwarding header on each request while proxy trust is disabled
- **THEN** the requests continue to count against the same limit

### Requirement: Security Response Headers
The system SHALL include security headers on every HTTP response, covering at minimum strict transport security, content-type sniffing prevention, framing restriction, and referrer policy. Responses that deliver downloadable content SHALL carry these headers as well.

#### Scenario: Headers present on an API response
- **WHEN** a client receives any response from the API
- **THEN** the response carries the configured security headers

#### Scenario: Headers present on a file download
- **WHEN** a client downloads an exported report
- **THEN** the response carries the same security headers as any other response

### Requirement: Cross-Origin Access Control
The system SHALL permit cross-origin browser access only from origins on a configured allowlist, and SHALL reject preflight requests from origins absent from that list. The allowlist SHALL come from configuration, not from code, so that permissive development settings cannot reach production unchanged.

#### Scenario: Request from an allowed origin
- **WHEN** a browser on an allowlisted origin sends a preflight request
- **THEN** the system responds permitting the cross-origin call

#### Scenario: Request from an origin not on the list
- **WHEN** a browser on an origin absent from the allowlist sends a preflight request
- **THEN** the system does not grant cross-origin permission to that origin

#### Scenario: Allowlist is environment-specific
- **WHEN** the system runs in different environments
- **THEN** each environment applies the allowlist from its own configuration, and no origin is permitted by a value hardcoded in the source

### Requirement: Database Transport Security
The system SHALL connect to the database over an encrypted transport, with certificate verification governed by configuration so that verification can be required in environments that provide a trusted certificate authority. The transport setting MUST be explicit rather than inherited from whatever the connection string happens to specify.

#### Scenario: Encrypted connection established
- **WHEN** the system connects to the database with transport security configured
- **THEN** the connection is encrypted according to that configuration

#### Scenario: Certificate verification required
- **WHEN** certificate verification is required by configuration and the server presents a certificate that does not verify
- **THEN** the connection fails rather than proceeding unverified

### Requirement: Dependency Vulnerability Baseline
The project SHALL carry no known high or critical severity advisories in the dependencies shipped to production, and every dependency SHALL be pinned to an exact version.

#### Scenario: Auditing production dependencies
- **WHEN** a vulnerability audit runs against the production dependency tree
- **THEN** it reports no advisories of high or critical severity

#### Scenario: Dependency version pinning
- **WHEN** a dependency is added or updated
- **THEN** it is recorded at an exact version, without a range prefix
