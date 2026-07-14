// Schema validation: a mapping file is customer-facing configuration, so
// every structural mistake must be caught up front with a message that
// names the exact field — not surface later as a bizarre mapping.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, parseSchema, SchemaError, schemaOptions, validateSchema } from "../dist/index.js";

test("a minimal schema validates and fills defaults", () => {
  const s = validateSchema({ fields: [{ name: "email" }] });
  assert.equal(s.fields[0].type, "string");
  assert.equal(s.fields[0].required, false);
  assert.deepEqual(s.fields[0].aliases, []);
  assert.equal(schemaOptions(s).fuzzyThreshold, DEFAULT_OPTIONS.fuzzyThreshold);
});

test("parseSchema rejects invalid JSON and top-level shape errors name the problem", () => {
  assert.throws(() => parseSchema("{not json"), SchemaError);
  assert.throws(() => parseSchema("{not json"), /not valid JSON/);

  assert.throws(() => validateSchema([]), /JSON object/);
  assert.throws(() => validateSchema({}), /fields/);
  assert.throws(() => validateSchema({ fields: [] }), /non-empty/);
});

test("field errors carry the index and field name", () => {
  assert.throws(() => validateSchema({ fields: [{ name: "" }] }), /fields\[0\]\.name/);
  assert.throws(
    () => validateSchema({ fields: [{ name: "x", type: "uuid" }] }),
    /fields\[0\] \("x"\): unknown type "uuid"/,
  );
  assert.throws(
    () => validateSchema({ fields: [{ name: "x", aliases: [1] }] }),
    /aliases must be an array of strings/,
  );
});

test("invalid regex patterns are rejected at load time, not match time", () => {
  assert.throws(
    () => validateSchema({ fields: [{ name: "x", patterns: ["(unclosed"] }] }),
    /invalid pattern/,
  );
});

test("enum rules: values required, valueAliases must reference values", () => {
  assert.throws(() => validateSchema({ fields: [{ name: "x", type: "enum" }] }), /requires "values"/);
  assert.throws(
    () => validateSchema({ fields: [{ name: "x", type: "enum", values: [] }] }),
    /must not be empty/,
  );
  assert.throws(
    () =>
      validateSchema({
        fields: [{ name: "x", type: "enum", values: ["a"], valueAliases: { b: ["z"] } }],
      }),
    /"b" is not in "values"/,
  );
  assert.throws(
    () => validateSchema({ fields: [{ name: "x", values: ["a"] }] }),
    /only valid for type "enum"/,
  );
});

test("field names must be unique after normalization", () => {
  assert.throws(
    () => validateSchema({ fields: [{ name: "first_name" }, { name: "First Name" }] }),
    /collide/,
  );
});

test("options are validated: threshold range, types, nullValues casing", () => {
  assert.throws(
    () => validateSchema({ fields: [{ name: "x" }], options: { fuzzyThreshold: 2 } }),
    /\[0, 1\]/,
  );
  assert.throws(
    () => validateSchema({ fields: [{ name: "x" }], options: { dayFirst: "yes" } }),
    /dayFirst/,
  );
  const s = validateSchema({
    fields: [{ name: "x" }],
    options: { nullValues: ["UNKNOWN", "-"] },
  });
  // Stored lower-cased so cell comparison is case-insensitive.
  assert.deepEqual(schemaOptions(s).nullValues, ["unknown", "-"]);
});
