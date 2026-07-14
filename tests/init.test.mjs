// Schema drafting (`colcast init`): conservative type inference and safe
// canonical names. A draft that guesses a type wrong poisons the very
// first `cast` a new user runs, so inference only commits when every
// sampled cell agrees.
import assert from "node:assert/strict";
import test from "node:test";
import { draftSchema, validateSchema } from "../dist/index.js";

const byName = (schema, name) => schema.fields.find((f) => f.name === name);

test("headers become snake_case canonical names", () => {
  const s = draftSchema([["E-Mail Address", "firstName"], []]);
  assert.equal(s.fields[0].name, "e_mail_address");
  assert.equal(s.fields[1].name, "first_name");
});

test("no redundant alias when the raw header already normalizes to the name", () => {
  const s = draftSchema([["E-Mail Address"], []]);
  // "E-Mail Address" and "e_mail_address" collapse to the same form, so
  // an alias would be dead weight in the draft.
  assert.equal(s.fields[0].aliases, undefined);
});

test("blank and duplicate headers get safe deterministic names", () => {
  const blank = draftSchema([["a", "", "c"]]);
  assert.equal(blank.fields[1].name, "column_2");

  const dup = draftSchema([["email", "Email", "EMAIL"]]);
  assert.deepEqual(
    dup.fields.map((f) => f.name),
    ["email", "email_2", "email_3"],
  );
  // "email_2" normalizes to "email 2" != "email", so the alias keeps the
  // second column reachable by its original spelling.
  assert.deepEqual(dup.fields[1].aliases, ["Email"]);
});

test("type inference: unanimous columns commit, mixed columns stay string", () => {
  const s = draftSchema([
    ["ints", "floats", "bools", "dates", "mixed"],
    ["1", "1.5", "yes", "2026-07-13", "1"],
    ["2,000", "$2.50", "no", "Jul 1, 2026", "hello"],
    ["-3", "3", "TRUE", "7/4/2026", "2026-01-01"],
  ]);
  assert.equal(byName(s, "ints").type, "integer");
  assert.equal(byName(s, "floats").type, "number");
  assert.equal(byName(s, "bools").type, "boolean");
  assert.equal(byName(s, "dates").type, "date");
  assert.equal(byName(s, "mixed").type, "string");
});

test("null spellings do not block inference; all-empty columns stay string", () => {
  const s = draftSchema([
    ["seats", "empty"],
    ["5", "n/a"],
    ["N/A", ""],
    ["7", "-"],
  ]);
  assert.equal(byName(s, "seats").type, "integer");
  assert.equal(byName(s, "empty").type, "string");
});

test("integer wins over number and boolean for pure 0/1 columns", () => {
  // 0/1 columns are more usefully integers; booleans need words to prove
  // intent (documented ordering in src/init.ts).
  const s = draftSchema([["flag"], ["0"], ["1"], ["1"]]);
  assert.equal(s.fields[0].type, "integer");
});

test("the draft is itself a valid schema", () => {
  const s = draftSchema([
    ["E-Mail", "Seats", "Sign-up"],
    ["a@example.test", "5", "2026-07-01"],
  ]);
  const validated = validateSchema(s);
  assert.equal(validated.fields.length, 3);
});

test("empty input (no header row) throws", () => {
  assert.throws(() => draftSchema([]), /header row/);
});
