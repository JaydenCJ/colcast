/**
 * Schema loading and validation. A mapping file is plain JSON; this
 * module rejects malformed schemas with actionable messages *before*
 * any CSV is touched, and fills in defaults so the rest of the code
 * never re-checks optionality.
 */

import type { FieldSpec, FieldType, Schema, SchemaOptions } from "./types.js";
import { normalizeHeader } from "./normalize.js";

export const FIELD_TYPES: readonly FieldType[] = [
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "enum",
];

export const DEFAULT_OPTIONS: Required<SchemaOptions> = {
  fuzzyThreshold: 0.8,
  dayFirst: false,
  trim: true,
  nullValues: ["", "null", "n/a", "na", "none", "-", "--"],
};

/** Error thrown for any structural problem in a mapping file. */
export class SchemaError extends Error {
  override name = "SchemaError";
}

function bad(msg: string): never {
  throw new SchemaError(msg);
}

function checkStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    bad(`${where} must be an array of strings`);
  }
  return value as string[];
}

/** Validate one field spec (index used only for error messages). */
function validateField(raw: unknown, i: number): FieldSpec {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad(`fields[${i}] must be an object`);
  }
  const f = raw as Record<string, unknown>;
  if (typeof f.name !== "string" || f.name.trim() === "") {
    bad(`fields[${i}].name must be a non-empty string`);
  }
  const name = f.name;
  const type = (f.type ?? "string") as FieldType;
  if (!FIELD_TYPES.includes(type)) {
    bad(`fields[${i}] ("${name}"): unknown type "${String(f.type)}" (expected one of: ${FIELD_TYPES.join(", ")})`);
  }
  if (f.required !== undefined && typeof f.required !== "boolean") {
    bad(`fields[${i}] ("${name}").required must be a boolean`);
  }
  const aliases = f.aliases === undefined ? [] : checkStringArray(f.aliases, `fields[${i}] ("${name}").aliases`);
  const patterns = f.patterns === undefined ? [] : checkStringArray(f.patterns, `fields[${i}] ("${name}").patterns`);
  for (const p of patterns) {
    try {
      new RegExp(p, "i");
    } catch {
      bad(`fields[${i}] ("${name}"): invalid pattern ${JSON.stringify(p)}`);
    }
  }
  let values: string[] | undefined;
  if (type === "enum") {
    if (f.values === undefined) bad(`fields[${i}] ("${name}"): type "enum" requires "values"`);
    values = checkStringArray(f.values, `fields[${i}] ("${name}").values`);
    if (values.length === 0) bad(`fields[${i}] ("${name}").values must not be empty`);
  } else if (f.values !== undefined) {
    bad(`fields[${i}] ("${name}"): "values" is only valid for type "enum"`);
  }
  let valueAliases: Record<string, string[]> | undefined;
  if (f.valueAliases !== undefined) {
    if (type !== "enum") bad(`fields[${i}] ("${name}"): "valueAliases" is only valid for type "enum"`);
    if (typeof f.valueAliases !== "object" || f.valueAliases === null || Array.isArray(f.valueAliases)) {
      bad(`fields[${i}] ("${name}").valueAliases must be an object`);
    }
    valueAliases = {};
    for (const [canon, syns] of Object.entries(f.valueAliases as Record<string, unknown>)) {
      if (!(values as string[]).includes(canon)) {
        bad(`fields[${i}] ("${name}").valueAliases: "${canon}" is not in "values"`);
      }
      valueAliases[canon] = checkStringArray(syns, `fields[${i}] ("${name}").valueAliases["${canon}"]`);
    }
  }
  const out: FieldSpec = { name, type, required: f.required === true, aliases, patterns };
  if (values) out.values = values;
  if (valueAliases) out.valueAliases = valueAliases;
  if (typeof f.description === "string") out.description = f.description;
  return out;
}

/** Validate a parsed mapping file and apply option defaults. */
export function validateSchema(raw: unknown): Schema {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad("schema must be a JSON object with a \"fields\" array");
  }
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.fields) || s.fields.length === 0) {
    bad('schema.fields must be a non-empty array');
  }
  const fields = s.fields.map(validateField);

  // Canonical names must be unique — and unique *after normalization*,
  // otherwise two fields would silently compete for the same headers.
  const seen = new Map<string, string>();
  for (const f of fields) {
    const key = normalizeHeader(f.name);
    const prior = seen.get(key);
    if (prior !== undefined) {
      bad(`fields "${prior}" and "${f.name}" collide (both normalize to "${key}")`);
    }
    seen.set(key, f.name);
  }

  let options: Required<SchemaOptions> = { ...DEFAULT_OPTIONS };
  if (s.options !== undefined) {
    if (typeof s.options !== "object" || s.options === null || Array.isArray(s.options)) {
      bad("schema.options must be an object");
    }
    const o = s.options as Record<string, unknown>;
    if (o.fuzzyThreshold !== undefined) {
      if (typeof o.fuzzyThreshold !== "number" || o.fuzzyThreshold < 0 || o.fuzzyThreshold > 1) {
        bad("options.fuzzyThreshold must be a number in [0, 1]");
      }
      options.fuzzyThreshold = o.fuzzyThreshold;
    }
    if (o.dayFirst !== undefined) {
      if (typeof o.dayFirst !== "boolean") bad("options.dayFirst must be a boolean");
      options.dayFirst = o.dayFirst;
    }
    if (o.trim !== undefined) {
      if (typeof o.trim !== "boolean") bad("options.trim must be a boolean");
      options.trim = o.trim;
    }
    if (o.nullValues !== undefined) {
      options.nullValues = checkStringArray(o.nullValues, "options.nullValues").map((v) =>
        v.toLowerCase(),
      );
    }
  }
  return { fields, options };
}

/** Parse a mapping file's text (JSON) into a validated Schema. */
export function parseSchema(text: string): Schema {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    bad(`schema is not valid JSON: ${(e as Error).message}`);
  }
  return validateSchema(raw);
}

/** Resolved options for a validated schema (defaults always present). */
export function schemaOptions(schema: Schema): Required<SchemaOptions> {
  return { ...DEFAULT_OPTIONS, ...(schema.options ?? {}) };
}
