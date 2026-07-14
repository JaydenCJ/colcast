/**
 * RFC 4180 CSV reader/writer, dependency-free.
 *
 * The parser is a single-pass state machine: it handles quoted fields,
 * escaped quotes (`""`), embedded delimiters and newlines inside quotes,
 * CRLF/LF/CR line endings, and a UTF-8 BOM. It is deliberately tolerant
 * of the things real exports get wrong — a quote appearing mid-field is
 * kept literally rather than aborting the import.
 */

export interface ParseOptions {
  /** Field delimiter. Default ",". Use "\t" or ";" for other exports. */
  delimiter?: string;
}

export interface ParseResult {
  /** All records, including the header row (first element). */
  rows: string[][];
}

/** Parse CSV text into rows of string cells. */
export function parseCsv(text: string, options: ParseOptions = {}): ParseResult {
  const delim = options.delimiter ?? ",";
  if (delim.length !== 1) {
    throw new Error(`delimiter must be a single character, got ${JSON.stringify(delim)}`);
  }
  // Strip a UTF-8 BOM so the first header never carries an invisible prefix.
  if (text.startsWith("\uFEFF")) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false; // distinguishes "" (one empty cell) from no cell

  const pushCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "" && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === '"') {
      // Bare quote mid-field: real-world exports do this; keep it literal.
      cell += ch;
    } else if (ch === delim) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  // Flush the final record unless the file ended exactly at a row boundary.
  if (cell !== "" || cellStarted || row.length > 0) pushRow();

  // Drop trailing rows that are entirely empty (a very common export tail).
  while (rows.length > 0) {
    const last = rows[rows.length - 1] as string[];
    if (last.every((c) => c === "")) rows.pop();
    else break;
  }
  return { rows };
}

/** Quote a single cell per RFC 4180 (only when necessary). */
export function encodeCell(value: string, delimiter = ","): string {
  if (
    value.includes('"') ||
    value.includes(delimiter) ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Serialize rows back to CSV text (LF line endings, trailing newline). */
export function writeCsv(rows: string[][], delimiter = ","): string {
  return rows.map((r) => r.map((c) => encodeCell(c, delimiter)).join(delimiter) + "\n").join("");
}
