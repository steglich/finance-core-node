## Purpose

Exchange rates between currency pairs on a given date, and the conversion of monetary values using the rate in force on the date of the fact rather than the current one — the foundation for every multi-currency reading in the system.

## ADDED Requirements

### Requirement: Register Exchange Rate
The system SHALL allow users to register an exchange rate for a company with: a source currency, a target currency, a rate greater than zero and a date. Both currencies MUST be supported ISO 4217 codes and MUST be different from each other. Registering a rate for a pair and date that already has one SHALL replace it. The system SHALL publish ExchangeRateRegistered.

#### Scenario: Register a rate
- **WHEN** a user registers a USD→BRL rate of 5,20 for 15/07/2026
- **THEN** the system stores the rate and publishes ExchangeRateRegistered

#### Scenario: Rate with identical currencies
- **WHEN** a user attempts to register a BRL→BRL rate
- **THEN** the system rejects the registration with a validation error

#### Scenario: Non-positive rate
- **WHEN** a user attempts to register a rate of 0
- **THEN** the system rejects the registration with a validation error

#### Scenario: Unsupported currency
- **WHEN** a user attempts to register a rate for a currency code that is not supported
- **THEN** the system rejects the registration with a validation error

#### Scenario: Replace the rate of a date
- **WHEN** a user registers a USD→BRL rate for 15/07/2026 and a corrected one for the same date
- **THEN** the system keeps only the corrected rate for that date

### Requirement: Rate Lookup by Date
The system SHALL resolve the rate for a currency pair on a reference date as the most recent registered rate whose date is not later than the reference date. When no rate exists for the pair, the system SHALL resolve the inverse pair and use its reciprocal. When neither exists, the lookup SHALL fail explicitly rather than assume a rate of 1.

#### Scenario: Rate of the date of the fact
- **WHEN** a conversion for 20/07/2026 is requested and USD→BRL rates exist for 15/07/2026 and 25/07/2026
- **THEN** the system uses the rate of 15/07/2026

#### Scenario: Inverse pair
- **WHEN** a BRL→USD conversion is requested and only USD→BRL rates are registered
- **THEN** the system uses the reciprocal of the USD→BRL rate of the date

#### Scenario: No rate available
- **WHEN** a conversion is requested for a pair that has no registered rate on or before the reference date
- **THEN** the system returns an error stating that no exchange rate is available for that pair and date

#### Scenario: Same currency needs no rate
- **WHEN** a conversion from BRL to BRL is requested
- **THEN** the system returns the original amount without requiring any registered rate

### Requirement: Value Conversion
The system SHALL convert a monetary value between currencies by multiplying it by the resolved rate and rounding the result to cents. The conversion result SHALL carry the original amount, the original currency, the rate used and the date of that rate, so that any converted figure can be traced back to its rate.

#### Scenario: Convert a value
- **WHEN** $50.00 is converted to BRL on a date whose USD→BRL rate is 5,20
- **THEN** the system returns R$ 260,00 along with the rate 5,20 and the date it came from

#### Scenario: Traceable conversion
- **WHEN** any consolidated figure is presented in a display currency
- **THEN** each converted component reports the rate and the rate date used

### Requirement: Historical Rates Are Immutable in Use
Consolidated readings and reports MUST convert each fact using the rate in force on the date of that fact, never the current rate. Recomputing the same report over the same past period MUST yield the same converted values as long as no rate of that period is corrected.

#### Scenario: Past report keeps past rates
- **WHEN** a user re-runs a report for July 2026 in December 2026
- **THEN** the values converted are the same as when the report was first produced, using July rates

#### Scenario: Current rate is not applied retroactively
- **WHEN** a new USD→BRL rate is registered for today
- **THEN** transactions and positions dated in previous months keep their original converted values

### Requirement: List Exchange Rates
The system SHALL allow users to list the exchange rates of the current company, filterable by currency pair and by date range, ordered by date descending.

#### Scenario: List rates of a pair
- **WHEN** a user lists USD→BRL rates for the last 90 days
- **THEN** the system returns those rates ordered from the most recent to the oldest

### Requirement: Exchange Rate Company Isolation
Exchange rates SHALL belong to exactly one company and SHALL only be readable and writable within that company's scope, taken from the authenticated context.

#### Scenario: Rate of another company
- **WHEN** a user authenticated for company A lists exchange rates
- **THEN** only company A rates are returned
