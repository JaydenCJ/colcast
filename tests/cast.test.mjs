// Cell casting: every messy spelling that must land in one canonical
// form, and every ambiguous spelling that must fail loudly instead of
// guessing. Silent misparses (03/11 as the wrong month, "1,234" as 1.234)
// are the class of bug this module exists to prevent.
import assert from "node:assert/strict";
import test from "node:test";
import { castValue } from "../dist/index.js";
import { OPTS } from "./helpers.mjs";

const cast = (raw, field, opts = {}) =>
  castValue(raw, { name: "f", ...field }, { ...OPTS, ...opts });

const value = (o) => {
  assert.equal(o.kind, "value", `expected value, got ${JSON.stringify(o)}`);
  return o.value;
};
const failReason = (o) => {
  assert.equal(o.kind, "fail", `expected fail, got ${JSON.stringify(o)}`);
  return o.reason;
};

/* ------------------------------ null/empty ----------------------------- */

test("null spellings become empty for every type; custom nullValues extend the set", () => {
  for (const type of ["string", "integer", "number", "boolean", "date"]) {
    assert.equal(cast("N/A", { type }).kind, "empty");
    assert.equal(cast("  ", { type }).kind, "empty");
    assert.equal(cast("--", { type }).kind, "empty");
  }

  const o = cast("unknown", { type: "integer" }, { nullValues: ["", "unknown"] });
  assert.equal(o.kind, "empty");
});

/* -------------------------------- string ------------------------------- */

test("string trims by default and keeps whitespace when trim=false", () => {
  assert.equal(value(cast("  hello  ", { type: "string" })), "hello");
  assert.equal(value(castValue("  hello  ", { name: "f", type: "string" }, { ...OPTS, trim: false })), "  hello  ");
});

/* ------------------------------- integers ------------------------------ */

test("integer: signs, separators, currency, accounting parentheses", () => {
  assert.equal(value(cast("42", { type: "integer" })), "42");
  assert.equal(value(cast("-7", { type: "integer" })), "-7");
  assert.equal(value(cast("+7", { type: "integer" })), "7");
  assert.equal(value(cast("1,234,567", { type: "integer" })), "1234567");
  assert.equal(value(cast("$4,860", { type: "integer" })), "4860");
  assert.equal(value(cast("1 234 567", { type: "integer" })), "1234567");

  assert.equal(value(cast("(150)", { type: "integer" })), "-150");
  assert.equal(value(cast("($1,500)", { type: "integer" })), "-1500");
});

test("integer: fractions, words, bad grouping and unsafe magnitudes all fail", () => {
  assert.match(failReason(cast("3.5", { type: "integer" })), /whole number/);
  assert.match(failReason(cast("not sure", { type: "integer" })), /not an integer/);
  assert.match(failReason(cast("1,23,4", { type: "integer" })), /not an integer/);
  assert.match(failReason(cast("(-5)", { type: "integer" })), /not an integer/);

  assert.match(failReason(cast("9007199254740993", { type: "integer" })), /safe range/);
});

/* -------------------------------- numbers ------------------------------ */

test("number: US and European decimals cast; currency strips from either side", () => {
  assert.equal(value(cast("1,234.56", { type: "number" })), "1234.56");
  assert.equal(value(cast("1.234,56", { type: "number" })), "1234.56");
  assert.equal(value(cast("3,14", { type: "number" })), "3.14");
  assert.equal(value(cast("1.234.567", { type: "number" })), "1234567");

  assert.equal(value(cast("€1.234,50", { type: "number" })), "1234.5");
  assert.equal(value(cast("1234.50 USD", { type: "number" })), "1234.5");
  assert.equal(value(cast("¥1000", { type: "number" })), "1000");
});

test("number: scientific notation passes; ambiguous text fails", () => {
  assert.equal(value(cast("1.5e3", { type: "number" })), "1500");

  assert.equal(failReason(cast("12 units", { type: "number" })).includes("12 units"), true);
  assert.equal(cast("1,2,3", { type: "number" }).kind, "fail");
  assert.equal(cast(".", { type: "number" }).kind, "fail");
});

/* ------------------------------- booleans ------------------------------ */

test("boolean: the full synonym table casts; anything else fails", () => {
  for (const t of ["true", "TRUE", "Yes", "y", "1", "on", "T"]) {
    assert.equal(value(cast(t, { type: "boolean" })), "true", t);
  }
  for (const f of ["false", "No", "n", "0", "off", "F"]) {
    assert.equal(value(cast(f, { type: "boolean" })), "false", f);
  }

  assert.equal(cast("maybe", { type: "boolean" }).kind, "fail");
  assert.equal(cast("2", { type: "boolean" }).kind, "fail");
});

/* --------------------------------- dates ------------------------------- */

test("date: ISO variants normalize to YYYY-MM-DD, datetime suffixes ignored", () => {
  assert.equal(value(cast("2026-07-13", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("2026/7/3", { type: "date" })), "2026-07-03");
  assert.equal(value(cast("2026.07.13", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("20260713", { type: "date" })), "2026-07-13");

  assert.equal(value(cast("2026-07-13T09:30:00Z", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("2026-07-13 09:30", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("7/13/2026 9:30 PM", { type: "date" })), "2026-07-13");
});

test("date: dayFirst resolves 03/11 both ways", () => {
  assert.equal(value(cast("03/11/2024", { type: "date" })), "2024-03-11");

  assert.equal(value(cast("03/11/2024", { type: "date" }, { dayFirst: true })), "2024-11-03");

  assert.equal(value(cast("13/07/2026", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("07/13/2026", { type: "date" }, { dayFirst: true })), "2026-07-13");
});

test("date: month names in both orders, with ordinals and dashes", () => {
  assert.equal(value(cast("Jul 13, 2026", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("13 July 2026", { type: "date" })), "2026-07-13");
  assert.equal(value(cast("3rd Nov 2024", { type: "date" })), "2024-11-03");
  assert.equal(value(cast("13-Jul-2026", { type: "date" })), "2026-07-13");

  assert.equal(value(cast("1/5/26", { type: "date" })), "2026-01-05");
  assert.equal(value(cast("1/5/99", { type: "date" })), "1999-01-05");
});

test("date: impossible dates and prose fail with quoted reasons", () => {
  assert.equal(cast("2024-13-45", { type: "date" }).kind, "fail");
  assert.equal(cast("2023-02-29", { type: "date" }).kind, "fail");
  assert.equal(value(cast("2024-02-29", { type: "date" })), "2024-02-29");
  assert.equal(cast("2026-04-31", { type: "date" }).kind, "fail");

  assert.match(failReason(cast("next tuesday", { type: "date" })), /"next tuesday"/);
});

/* --------------------------------- enums ------------------------------- */

const plan = {
  type: "enum",
  values: ["free", "pro", "enterprise"],
  valueAliases: { pro: ["professional", "premium"], free: ["trial"] },
};

test("enum: canonical values and value aliases match case-insensitively", () => {
  assert.equal(value(cast("PRO", plan)), "pro");
  assert.equal(value(cast(" Enterprise ", plan)), "enterprise");

  assert.equal(value(cast("Professional", plan)), "pro");
  assert.equal(value(cast("premium", plan)), "pro");
  assert.equal(value(cast("trial", plan)), "free");
});

test("enum: unknown values fail and the reason lists the allowed set", () => {
  const reason = failReason(cast("platinum", plan));
  assert.match(reason, /free, pro, enterprise/);
});
