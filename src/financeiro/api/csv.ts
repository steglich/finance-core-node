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
 * Characters a spreadsheet reads as the start of an expression. A category or
 * person named `=cmd|'/c calc'!A1` is free user input on our side and an
 * executable formula on the side of whoever opens the export.
 */
const FORMULA_INTRODUCERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** A signed decimal number, optionally in exponent notation. */
const NUMERIC_LITERAL = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Prefixes a field that a spreadsheet would evaluate, so it is rendered as
 * literal text. The apostrophe is the recognized convention: spreadsheets strip
 * it on display and on re-import, so the value stays recoverable — it is not
 * byte-identical, which is the accepted trade-off.
 */
function neutralizeFormula(text: string): string {
  const first = text[0];

  if (first === undefined || !FORMULA_INTRODUCERS.has(first)) {
    return text;
  }

  // A negative amount also starts with `-`, and reports are full of them.
  // Neutralizing those would turn every liability and every negative result
  // into text in the spreadsheet. A well-formed numeric literal cannot carry a
  // formula payload, so it is exempt — `-1500` stays a number, while
  // `-1+cmd|'/c calc'!A1` does not parse as one and is neutralized.
  if (NUMERIC_LITERAL.test(text)) {
    return text;
  }

  return `'${text}`;
}

/**
 * Quotes a field when it contains a separator, a quote or a line break, doubling
 * any embedded quote — otherwise the file would stop being valid CSV — and
 * neutralizes anything a spreadsheet would evaluate as a formula.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = value instanceof Date ? value.toISOString() : String(value);
  const text = neutralizeFormula(raw);

  // A neutralized field is always quoted: the apostrophe only reads as an
  // escape hint to the spreadsheet when the cell is a quoted string.
  return NEEDS_QUOTING.test(text) || text !== raw
    ? `"${text.replaceAll('"', '""')}"`
    : text;
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
