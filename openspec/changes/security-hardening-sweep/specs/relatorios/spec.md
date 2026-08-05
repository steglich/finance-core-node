## MODIFIED Requirements

### Requirement: CSV Export
The system SHALL allow exporting any report as CSV, containing the same rows and columns as the rendered report, with a header line and a stable column order. Reports composed of more than one section, such as the net worth and the income tax reports, SHALL export each section with its own header block in a fixed order.

Exported fields SHALL be neutralized against formula interpretation by spreadsheet software: a field whose content begins with a character that a spreadsheet treats as the start of an expression SHALL be emitted so that the receiving application renders it as text. This applies to every field, including values originating from user-supplied names such as categories, people, accounts and cost centers.

#### Scenario: Export a report
- **WHEN** a user exports the spending-by-category report as CSV
- **THEN** the system returns a CSV file whose content matches the report data

#### Scenario: Values with separators
- **WHEN** an exported field contains a comma, a quote or a line break
- **THEN** the system escapes the field so the CSV remains valid

#### Scenario: Field that would be read as a formula
- **WHEN** a report row carries a user-supplied name beginning with a formula-introducing character, such as a category named `=cmd|'/c calc'!A1`
- **THEN** the exported field is emitted so that a spreadsheet displays it as literal text rather than evaluating it

#### Scenario: Neutralization preserves the value
- **WHEN** a neutralized field is read back by a CSV parser
- **THEN** the original value remains recoverable and the file remains valid CSV

#### Scenario: Export a multi-section report
- **WHEN** a user exports the net worth report as CSV
- **THEN** the file contains the asset section and the liability section, each with its own header, in a stable order
