// The mapping pipeline: stage precedence, one-to-one assignment,
// determinism, threshold behavior, and the rejected-candidate audit
// trail. These are the decisions a data team has to be able to trust
// blind — a silently wrong mapping is worse than no mapping.
import assert from "node:assert/strict";
import test from "node:test";
import { mapHeaders, validateSchema } from "../dist/index.js";
import { contactsSchema } from "./helpers.mjs";

const schema = () => validateSchema(contactsSchema());

function mappingFor(headers, s = schema()) {
  const result = mapHeaders(headers, s);
  const byField = Object.fromEntries(result.mappings.map((m) => [m.field, m]));
  return { result, byField };
}

test("exact and alias stages match on the normalized form", () => {
  const exact = mappingFor(["EMAIL", "First-Name"]).byField;
  assert.equal(exact.email.method, "exact");
  assert.equal(exact.first_name.method, "exact");
  assert.equal(exact.email.score, 1);

  const alias = mappingFor(["E-MAIL", "Given Name"]).byField;
  assert.equal(alias.email.method, "alias");
  assert.equal(alias.first_name.method, "alias");
});

test("pattern: regex on the raw header wins over fuzzy", () => {
  const s = validateSchema({
    fields: [{ name: "email", patterns: ["^e-?mail\\b", "correo"] }],
  });
  const { byField } = mappingFor(["Correo electrónico"], s);
  assert.equal(byField.email.method, "pattern");
});

test("fuzzy: typos and re-ordered words map when above threshold", () => {
  const { byField } = mappingFor(["Emial", "Name First"]);
  assert.equal(byField.email.method, "fuzzy");
  assert.ok(byField.email.score >= 0.8);
  assert.equal(byField.first_name.method, "fuzzy");
});

test("fuzzy: abbreviation expansion matches Qty-style headers", () => {
  const s = validateSchema({ fields: [{ name: "quantity", type: "integer" }] });
  const { byField } = mappingFor(["Qty"], s);
  assert.equal(byField.quantity.method, "fuzzy");
});

test("below-threshold candidates are rejected; raising it demotes a match to a note", () => {
  const { result } = mappingFor(["Internal Notes"]);
  assert.equal(result.mappings.length, 0);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].header, "Internal Notes");

  const base = validateSchema(contactsSchema({ options: { fuzzyThreshold: 0.8 } }));
  const strict = validateSchema(contactsSchema({ options: { fuzzyThreshold: 0.99 } }));
  assert.equal(mapHeaders(["Emial"], base).mappings.length, 1);
  const r = mapHeaders(["Emial"], strict);
  assert.equal(r.mappings.length, 0);
  const miss = r.rejected.find((x) => x.field === "email");
  assert.equal(miss.reason, "below-threshold");
  assert.ok(miss.score >= 0.85);
});

test("assignment is one-to-one in both directions", () => {
  // Two headers both plausibly mean email; exact must win the field and
  // the loser must appear in rejected with reason field-taken.
  const { result, byField } = mappingFor(["email", "e-mail"]);
  assert.equal(byField.email.header, "email");
  assert.equal(byField.email.method, "exact");
  const loser = result.rejected.find((x) => x.header === "e-mail" && x.field === "email");
  assert.equal(loser.reason, "field-taken");

  const three = mappingFor(["email", "seats", "active"]).result;
  const indices = three.mappings.map((m) => m.index);
  assert.equal(new Set(indices).size, indices.length);
});

test("stage precedence: exact beats alias beats pattern beats fuzzy", () => {
  const s = validateSchema({
    fields: [
      { name: "email" }, // exact target
      { name: "contact_email", aliases: ["email"] }, // alias also claims "email"
    ],
  });
  const { byField } = mappingFor(["email"], s);
  // The single header must go to the exact-stage field, not the alias.
  assert.equal(byField.email.header, "email");
  assert.equal(byField.email.method, "exact");
  assert.equal(byField.contact_email, undefined);
});

test("ties broken by input column order, deterministically", () => {
  const s = validateSchema({ fields: [{ name: "email" }] });
  // Two identical headers (dirty exports do this): first column wins.
  const r = mapHeaders(["Email", "Email"], s);
  assert.equal(r.mappings.length, 1);
  assert.equal(r.mappings[0].index, 0);
  assert.equal(r.rejected.find((x) => x.index === 1).reason, "field-taken");
});

test("missingRequired lists required fields nothing claimed", () => {
  const { result } = mappingFor(["seats", "plan"]);
  assert.deepEqual(result.missingRequired, ["email"]);
});

test("blank headers are never matched to anything", () => {
  const { result } = mappingFor(["", "  ", "email"]);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].index, 2);
  assert.equal(result.unmapped.length, 2);
});

test("mappings come back sorted by input column index", () => {
  const { result } = mappingFor(["plan", "email", "seats"]);
  assert.deepEqual(result.mappings.map((m) => m.index), [0, 1, 2]);
});

test("the same input always produces the same output (stability probe)", () => {
  const headers = ["E-Mail Address", "Given Name", "Licence Count", "Sign up", "Plan Tier"];
  const a = JSON.stringify(mapHeaders(headers, schema()));
  for (let i = 0; i < 5; i++) {
    assert.equal(JSON.stringify(mapHeaders(headers, schema())), a);
  }
});
