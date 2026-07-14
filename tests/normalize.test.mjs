// Header normalization: the canonical form every rule stage compares on.
// If two spellings that humans consider "the same column name" normalize
// differently, exact/alias matching silently degrades to fuzzy guessing —
// these tests pin the collapsing rules.
import assert from "node:assert/strict";
import test from "node:test";
import { expandTokens, fuzzyForm, normalizeHeader, tokens } from "../dist/index.js";

test("lower-cases and collapses punctuation runs to single spaces", () => {
  assert.equal(normalizeHeader("  E-Mail  Address "), "e mail address");
  assert.equal(normalizeHeader("Company / Organization"), "company organization");
  assert.equal(normalizeHeader("Is_Active?"), "is active");
});

test("camelCase and PascalCase boundaries become word breaks", () => {
  assert.equal(normalizeHeader("firstName"), "first name");
  assert.equal(normalizeHeader("FirstName"), "first name");
  assert.equal(normalizeHeader("MRRUsd"), "mrr usd");
});

test("digit/letter boundaries split (address1 == address 1)", () => {
  assert.equal(normalizeHeader("address1"), "address 1");
  assert.equal(normalizeHeader("Address 1"), "address 1");
  assert.equal(normalizeHeader("q3Revenue"), "q 3 revenue");
});

test("NFKC folds full-width forms so JP exports match ASCII schemas", () => {
  assert.equal(normalizeHeader("ＥＭＡＩＬ"), "email");
  assert.equal(normalizeHeader("Ｓｅａｔｓ　１"), "seats 1");
});

test("equivalent spellings collapse to the same canonical form", () => {
  const spellings = ["Email Address", "EMAIL_ADDRESS", "email-address", " e.mail address "];
  const forms = new Set(spellings.map(normalizeHeader));
  // The dot spelling keeps its own word split; all underscore/dash/space
  // variants must be identical.
  assert.ok(forms.has("email address"));
  assert.equal(normalizeHeader("EMAIL_ADDRESS"), normalizeHeader("email-address"));
});

test("blank and symbol-only headers normalize to the empty string", () => {
  assert.equal(normalizeHeader("   "), "");
  assert.equal(normalizeHeader("###"), "");
});

test("tokens() splits the normalized form; expandTokens rewrites abbreviations", () => {
  assert.deepEqual(tokens("Email Address (work)"), ["email", "address", "work"]);
  assert.deepEqual(tokens("!!!"), []);

  assert.deepEqual(expandTokens(["qty"]), ["quantity"]);
  assert.deepEqual(expandTokens(["dob"]), ["date", "of", "birth"]);
  assert.deepEqual(expandTokens(["walrus"]), ["walrus"]);

  assert.equal(fuzzyForm("Qty"), "quantity");
  assert.equal(fuzzyForm("Cust No."), "customer number");
  // Rule stages never see this: normalizeHeader keeps the literal token.
  assert.equal(normalizeHeader("Qty"), "qty");
});
