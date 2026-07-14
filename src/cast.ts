/**
 * Cell casting: turn the messy spellings customers actually export into
 * one canonical text form per declared type. Casting never throws — a
 * cell either becomes a value, is recognized as empty, or fails with a
 * human-readable reason that lands in the cast report.
 *
 * Canonical output forms:
 *   integer  "42" / "-7"           (no separators, no leading zeros)
 *   number   "1234567.89"          (JS shortest round-trip decimal)
 *   boolean  "true" / "false"
 *   date     "2026-07-13"          (ISO 8601 calendar date)
 *   enum     the canonical value exactly as listed in the schema
 *   string   the cell text (trimmed unless options.trim is false)
 */

import type { FieldSpec, SchemaOptions } from "./types.js";

export type CastOutcome =
  | { kind: "value"; value: string }
  | { kind: "empty" }
  | { kind: "fail"; reason: string };

const ok = (value: string): CastOutcome => ({ kind: "value", value });
const fail = (reason: string): CastOutcome => ({ kind: "fail", reason });
const EMPTY: CastOutcome = { kind: "empty" };

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "1", "on"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "0", "off"]);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Cast one cell against a field spec. */
export function castValue(
  raw: string,
  field: FieldSpec,
  options: Required<SchemaOptions>,
): CastOutcome {
  const text = options.trim ? raw.trim() : raw;
  if (options.nullValues.includes(text.trim().toLowerCase())) return EMPTY;

  switch (field.type ?? "string") {
    case "string":
      return ok(text);
    case "integer":
      return castInteger(text);
    case "number":
      return castNumber(text);
    case "boolean":
      return castBoolean(text);
    case "date":
      return castDate(text, options.dayFirst);
    case "enum":
      return castEnum(text, field);
  }
}

/* ------------------------------- numbers ------------------------------- */

/**
 * Normalize numeric spellings: currency symbols, spaces used as digit
 * groups, accounting parentheses, thousands separators in both the
 * `1,234.56` and `1.234,56` conventions. Ambiguous group/decimal usage
 * (e.g. `1,23,4`) fails rather than guessing.
 */
function normalizeNumeric(text: string): string | null {
  let s = text.normalize("NFKC").trim();
  if (s === "") return null;
  let negative = false;
  // Accounting negatives: (1,234.50)
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = (paren[1] as string).trim();
  }
  // Currency symbols and codes on either side.
  s = s.replace(/^(?:[$€£¥₹]|USD|EUR|GBP|JPY)\s*/i, "");
  s = s.replace(/\s*(?:[$€£¥₹]|USD|EUR|GBP|JPY)$/i, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    if (paren) return null; // "(-5)" is nonsense; refuse to guess
    negative = true;
    s = s.slice(1);
  }
  s = s.trim();
  // Spaces or thin spaces as digit groups: "1 234 567"
  s = s.replace(/[\s  ]/g, "");
  if (!/^[\d.,]+(?:[eE][+-]?\d+)?$/.test(s) || !/\d/.test(s)) return null;

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    // Both present: the right-most separator is the decimal point.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const dec = lastComma > lastDot ? "," : ".";
    const grp = dec === "," ? "." : ",";
    if ((dec === "," ? commas : dots) !== 1) return null;
    s = s.split(grp).join("");
    s = s.replace(dec, ".");
  } else if (commas === 1 && dots === 0) {
    // A single comma is a thousands separator only when grouping fits
    // (`1,234`); otherwise it is a decimal comma (`3,14`).
    s = /^\d{1,3},\d{3}$/.test(s) ? s.replace(",", "") : s.replace(",", ".");
  } else if (commas > 1) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return null;
    s = s.split(",").join("");
  } else if (dots > 1) {
    // Multiple dots can only be `1.234.567` style grouping.
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(s)) return null;
    s = s.split(".").join("");
  }
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  return (negative ? "-" : "") + s;
}

function castNumber(text: string): CastOutcome {
  const norm = normalizeNumeric(text);
  if (norm === null) return fail(`not a number: ${JSON.stringify(text)}`);
  const n = Number(norm);
  if (!Number.isFinite(n)) return fail(`not a finite number: ${JSON.stringify(text)}`);
  return ok(String(n));
}

function castInteger(text: string): CastOutcome {
  const norm = normalizeNumeric(text);
  if (norm === null) return fail(`not an integer: ${JSON.stringify(text)}`);
  const n = Number(norm);
  if (!Number.isFinite(n)) return fail(`not an integer: ${JSON.stringify(text)}`);
  if (!Number.isInteger(n)) return fail(`not a whole number: ${JSON.stringify(text)}`);
  if (!Number.isSafeInteger(n)) return fail(`integer out of safe range: ${JSON.stringify(text)}`);
  return ok(String(n));
}

/* ------------------------------- booleans ------------------------------ */

function castBoolean(text: string): CastOutcome {
  const w = text.trim().toLowerCase();
  if (TRUE_WORDS.has(w)) return ok("true");
  if (FALSE_WORDS.has(w)) return ok("false");
  return fail(`not a boolean: ${JSON.stringify(text)}`);
}

/* --------------------------------- dates ------------------------------- */

function daysInMonth(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] as number;
}

function isoDate(y: number, m: number, d: number): CastOutcome | null {
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return ok(`${y}-${mm}-${dd}`);
}

/** Two-digit years pivot at 70: 69 -> 2069, 70 -> 1970. */
function expandYear(y: number): number {
  return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
}

/**
 * Accepted date spellings (time-of-day suffixes are ignored):
 *   2026-07-13, 2026/07/13, 2026.07.13, 20260713, 2026-07-13T09:30:00Z
 *   7/13/2026 or 13/7/2026 (dayFirst decides when both parts <= 12)
 *   13.07.2026, 13-07-26
 *   Jul 13, 2026 · 13 Jul 2026 · July 13 2026 · 13-Jul-2026
 */
function castDate(text: string, dayFirst: boolean): CastOutcome {
  let s = text.trim();
  // Drop a time-of-day / timezone suffix ("T09:30", " 09:30:00", "Z").
  s = s.replace(/[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:am|pm))?(?:\s*(?:Z|UTC|[+-]\d{2}:?\d{2}))?$/i, "");
  s = s.trim();

  let m: RegExpExecArray | null;

  // ISO-ish: year first.
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const r = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return r ?? fail(`not a calendar date: ${JSON.stringify(text)}`);
  }
  // Compact ISO: 20260713.
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const r = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return r ?? fail(`not a calendar date: ${JSON.stringify(text)}`);
  }
  // Numeric day/month pairs with 2- or 4-digit years.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]));
    // A component > 12 disambiguates regardless of dayFirst.
    let day: number, month: number;
    if (a > 12 && b <= 12) [day, month] = [a, b];
    else if (b > 12 && a <= 12) [day, month] = [b, a];
    else if (dayFirst) [day, month] = [a, b];
    else [day, month] = [b, a];
    const r = isoDate(y, month, day);
    return r ?? fail(`not a calendar date: ${JSON.stringify(text)}`);
  }
  // Month-name forms.
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[(m[1] as string).toLowerCase()];
    if (month === undefined) return fail(`unknown month: ${JSON.stringify(m[1])}`);
    const r = isoDate(expandYear(Number(m[3])), month, Number(m[2]));
    return r ?? fail(`not a calendar date: ${JSON.stringify(text)}`);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]+)\.?[-,\s]\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[(m[2] as string).toLowerCase()];
    if (month === undefined) return fail(`unknown month: ${JSON.stringify(m[2])}`);
    const r = isoDate(expandYear(Number(m[3])), month, Number(m[1]));
    return r ?? fail(`not a calendar date: ${JSON.stringify(text)}`);
  }
  return fail(`unrecognized date: ${JSON.stringify(text)}`);
}

/* --------------------------------- enums ------------------------------- */

function enumKey(v: string): string {
  return v.normalize("NFKC").trim().toLowerCase();
}

function castEnum(text: string, field: FieldSpec): CastOutcome {
  const values = field.values ?? [];
  const key = enumKey(text);
  for (const v of values) {
    if (enumKey(v) === key) return ok(v);
  }
  const aliases = field.valueAliases ?? {};
  for (const [canon, syns] of Object.entries(aliases)) {
    if (syns.some((syn) => enumKey(syn) === key)) return ok(canon);
  }
  return fail(`not one of [${values.join(", ")}]: ${JSON.stringify(text)}`);
}
