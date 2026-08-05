/**
 * Minimal RFC 4180 CSV serialization.
 *
 * Thirty lines of code instead of a dependency, in line with the project's
 * policy on new packages. PDF and Excel would need a library and are out of
 * scope for this phase.
 */

/**
 * A report rendered as a table, ready to be serialized.
 */
export interface CsvTable {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Quotes a field when it contains a separator, a quote or a line break, doubling
 * any embedded quote — otherwise the file would stop being valid CSV.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = value instanceof Date ? value.toISOString() : String(value);

  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Serializes a table as CSV with a header line and a stable column order.
 */
export function toCsv(table: CsvTable): string {
  const lines = [table.columns.map(escapeCsvField).join(",")];

  for (const row of table.rows) {
    lines.push(row.map(escapeCsvField).join(","));
  }

  return lines.join("\r\n");
}

/**
 * Content-Disposition value for an attachment download.
 */
export function attachmentDisposition(filename: string): string {
  return `attachment; filename="${filename.replaceAll('"', "")}"`;
}
