/**
 * `colcast init`: draft a starter mapping file from a CSV's own headers
 * and a sample of its data. Types are inferred conservatively — a column
 * is only typed integer/number/boolean/date when *every* non-empty
 * sampled cell casts cleanly; anything else stays a string. The draft is
 * a starting point for a human, never a final schema.
 */

import type { FieldType, Schema } from "./types.js";
import { normalizeHeader } from "./normalize.js";
import { castValue } from "./cast.js";
import { DEFAULT_OPTIONS } from "./schema.js";

/** Rows sampled per column when inferring a type. */
export const INIT_SAMPLE_ROWS = 200;

function inferType(samples: string[]): FieldType {
  const nonEmpty = samples.filter(
    (s) => !DEFAULT_OPTIONS.nullValues.includes(s.trim().toLowerCase()),
  );
  if (nonEmpty.length === 0) return "string";
  const allCast = (type: FieldType): boolean =>
    nonEmpty.every(
      (s) => castValue(s, { name: "probe", type }, DEFAULT_OPTIONS).kind === "value",
    );
  // Order matters: integer is tried before number, and both before
  // boolean — so a pure 0/1 column comes out an integer; boolean only
  // wins when the column mixes word spellings like yes/no.
  if (allCast("integer")) return "integer";
  if (allCast("number")) return "number";
  if (allCast("boolean")) return "boolean";
  if (allCast("date")) return "date";
  return "string";
}

/** Build a draft schema from parsed CSV rows (header row first). */
export function draftSchema(rows: string[][]): Schema {
  if (rows.length === 0) {
    throw new Error("input has no rows (need at least a header row)");
  }
  const headers = rows[0] as string[];
  const sample = rows.slice(1, 1 + INIT_SAMPLE_ROWS);
  const usedNames = new Set<string>();

  const fields = headers.map((raw, i) => {
    let name = normalizeHeader(raw).replace(/ /g, "_");
    if (name === "") name = `column_${i + 1}`;
    // De-duplicate collapsed names deterministically.
    let unique = name;
    let n = 2;
    while (usedNames.has(unique)) unique = `${name}_${n++}`;
    usedNames.add(unique);

    const samples = sample.map((r) => r[i] ?? "");
    const type = inferType(samples);
    const spec: { name: string; type: FieldType; aliases?: string[] } = {
      name: unique,
      type,
    };
    // Keep the original spelling reachable when it differs.
    if (normalizeHeader(raw) !== normalizeHeader(unique) && raw.trim() !== "") {
      spec.aliases = [raw.trim()];
    }
    return spec;
  });

  return { fields, options: { fuzzyThreshold: DEFAULT_OPTIONS.fuzzyThreshold } };
}
