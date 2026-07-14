// The castRows pipeline: canonical column order, per-field statistics,
// failure capping, passthrough/keep-raw modes, and the report's ok flag —
// the contract downstream import code and CI gates depend on.
import assert from "node:assert/strict";
import test from "node:test";
import { castRows, REPORT_FAILURE_CAP, validateSchema } from "../dist/index.js";
import { contactsSchema } from "./helpers.mjs";

const schema = () => validateSchema(contactsSchema());

const input = [
  ["E-Mail", "Given Name", "Seats", "Signed Up", "Active", "Plan", "Notes"],
  ["ada@example.test", "Ada", "120", "2024-11-03", "yes", "PRO", "vip"],
  ["grace@example.test", "Grace", "not sure", "bad date", "TRUE", "professional", ""],
];

test("output header is schema order; values are canonical forms", () => {
  const { rows } = castRows(input, schema());
  assert.deepEqual(rows[0], ["email", "first_name", "seats", "signed_up", "active", "plan"]);
  assert.deepEqual(rows[1], ["ada@example.test", "Ada", "120", "2024-11-03", "true", "pro"]);
});

test("failed casts empty the cell by default; keepRaw preserves the text", () => {
  const dflt = castRows(input, schema()).rows;
  assert.equal(dflt[2][2], ""); // "not sure" seats
  assert.equal(dflt[2][3], ""); // "bad date"

  const kept = castRows(input, schema(), { keepRaw: true }).rows;
  assert.equal(kept[2][2], "not sure");
  assert.equal(kept[2][3], "bad date");
});

test("passthrough appends unmapped columns with original headers", () => {
  const { rows } = castRows(input, schema(), { passthrough: true });
  assert.equal(rows[0].at(-1), "Notes");
  assert.equal(rows[1].at(-1), "vip");
  const dflt = castRows(input, schema());
  assert.equal(dflt.rows[0].includes("Notes"), false);
});

test("unmapped fields produce empty output columns, counted as missing when required", () => {
  const noEmail = [["Given Name"], ["Ada"]];
  const { rows, report } = castRows(noEmail, schema());
  assert.equal(rows[1][0], ""); // email column exists but is empty
  assert.deepEqual(report.missingRequired, ["email"]);
  assert.equal(report.summary.ok, false);
});

test("report statistics: per-field counts, row numbers, tool identity", () => {
  const { report } = castRows(input, schema());
  const seats = report.fields.find((f) => f.field === "seats");
  assert.equal(seats.ok, 1);
  assert.equal(seats.failed, 1);
  assert.deepEqual(seats.failures[0], {
    row: 2,
    value: "not sure",
    reason: 'not an integer: "not sure"',
  });
  const plan = report.fields.find((f) => f.field === "plan");
  assert.equal(plan.ok, 2);

  assert.equal(report.tool, "colcast");
  assert.match(report.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(report.input, { columns: 7, rows: 2 });
});

test("summary.ok is true only when nothing required is missing and no cast failed", () => {
  const clean = [
    ["email", "seats"],
    ["a@example.test", "1"],
  ];
  const { report } = castRows(clean, schema());
  assert.equal(report.summary.castFailures, 0);
  assert.deepEqual(report.missingRequired, []);
  assert.equal(report.summary.ok, true);
  const dirty = castRows(input, schema()).report;
  assert.equal(dirty.summary.ok, false);
  assert.equal(dirty.summary.castFailures, 2);
});

test("stored failures are capped per field, the count keeps counting", () => {
  const rows = [["email", "seats"]];
  for (let i = 0; i < REPORT_FAILURE_CAP + 10; i++) {
    rows.push([`u${i}@example.test`, "garbage"]);
  }
  const { report } = castRows(rows, schema());
  const seats = report.fields.find((f) => f.field === "seats");
  assert.equal(seats.failed, REPORT_FAILURE_CAP + 10);
  assert.equal(seats.failures.length, REPORT_FAILURE_CAP);
});

test("short data rows are treated as empty cells, not crashes", () => {
  const ragged = [
    ["email", "seats"],
    ["a@example.test"], // missing seats cell entirely
  ];
  const { rows, report } = castRows(ragged, schema());
  assert.equal(rows[1][2], "");
  assert.equal(report.summary.castFailures, 0);
});

test("header-only input works; input with no header row throws", () => {
  const { rows, report } = castRows([["email"]], schema());
  assert.equal(rows.length, 1);
  assert.equal(report.input.rows, 0);
  assert.equal(report.summary.ok, true);

  assert.throws(() => castRows([], schema()), /header row/);
});
