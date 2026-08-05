/**
 * Minimal RFC 4180 CSV serialization.
 *
 * Thirty lines of code instead of a dependency, in line with the project's
 * policy on new packages. PDF and Excel would need a library and are out of
 * scope for this phase.
 */

/**
 * One section of a multi-section report — the assets block of the net worth
 * report, for instance. Each carries its own header.
 */
export interface CsvSection {
  title: string;
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}

/**
 * A report rendered as a table, ready to be serialized.
 *
 * A report made of more than one block fills `sections` as well; `columns` and
 * `rows` then hold the flattened view, so a client that ignores sections still
 * gets every row.
 */
export interface CsvTable {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  sections?: readonly CsvSection[] | undefined;
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
 *
 * A multi-section report is written section by section, each preceded by its
 * title and its own header line and separated by a blank line, in a fixed
 * order — one file, still valid CSV, and readable block by block.
 */
export function toCsv(table: CsvTable): string {
  if (table.sections && table.sections.length > 0) {
    const blocks = table.sections.map((section) =>
      [
        escapeCsvField(section.title),
        section.columns.map(escapeCsvField).join(","),
        ...section.rows.map((row) => row.map(escapeCsvField).join(",")),
      ].join("\r\n"),
    );

    return blocks.join("\r\n\r\n");
  }

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
