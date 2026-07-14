// Text renderers for `map` and `check`: aligned columns, actionable
// notes, and stable wording. These strings end up in terminals and CI
// logs, so the tests pin the pieces scripts are likely to grep for.
import assert from "node:assert/strict";
import test from "node:test";
import { castRows, mapHeaders, renderMapping, renderReport, renderTable, validateSchema } from "../dist/index.js";
import { contactsSchema } from "./helpers.mjs";

const schema = () => validateSchema(contactsSchema());

test("renderTable aligns columns and never leaves trailing spaces", () => {
  const out = renderTable(["a", "long header"], [["xx", "y"], ["x", "value"]]);
  const lines = out.split("\n");
  assert.equal(lines[0], "a   long header");
  assert.equal(lines[1], "--  -----------");
  for (const line of lines) {
    assert.equal(line, line.trimEnd(), "no trailing whitespace");
  }
});

test("renderMapping shows every mapping with method and score", () => {
  const r = mapHeaders(["E-Mail", "Given Name", "Emial Adress"], schema());
  const out = renderMapping(r);
  assert.match(out, /E-Mail\s+->\s+email\s+alias\s+1\.00/);
  assert.match(out, /Given Name\s+->\s+first_name\s+alias/);
});

test("renderMapping lists unmapped/missing and notes only explanatory near-misses", () => {
  const r = mapHeaders(["Notes"], schema());
  const out = renderMapping(r);
  assert.match(out, /unmapped columns \(1\): "Notes"/);
  assert.match(out, /missing required fields: email/);

  // "Emial" would map at 0.8 but not at 0.99 — the note must appear then.
  const strict = validateSchema(contactsSchema({ options: { fuzzyThreshold: 0.99 } }));
  const noted = renderMapping(mapHeaders(["Emial"], strict));
  assert.match(noted, /note: "Emial" ~ email scored 0\.\d+ \(below threshold\)/);
  // With everything cleanly mapped, no notes clutter the plan.
  const clean = renderMapping(mapHeaders(["email", "seats"], schema()));
  assert.equal(clean.includes("note:"), false);
});

test("renderReport summarizes counts and ends with OK or FAIL", () => {
  const good = castRows([["email"], ["a@example.test"]], schema());
  assert.match(renderReport(good.report), /columns: 1\/1 mapped/);
  assert.match(renderReport(good.report), /result: OK\n$/);
  const bad = castRows([["email", "seats"], ["a@example.test", "many"]], schema());
  const out = renderReport(bad.report);
  assert.match(out, /cast failures: 1/);
  assert.match(out, /seats \(integer\): 1 failed/);
  assert.match(out, /row 1: not an integer/);
  assert.match(out, /result: FAIL\n$/);
});

test("renderReport truncates long failure lists and points at --report", () => {
  const rows = [["email", "seats"]];
  for (let i = 0; i < 10; i++) rows.push([`u${i}@example.test`, "x"]);
  const { report } = castRows(rows, schema());
  const out = renderReport(report);
  assert.match(out, /… 7 more \(see --report JSON\)/);
});
