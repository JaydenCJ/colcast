// Similarity primitives. Scores gate whether a fuzzy match is accepted,
// so these tests pin exact values where the algorithm defines them and
// ordering properties everywhere else (A must beat B), never fragile
// float equality on hybrid outputs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  jaro,
  jaroWinkler,
  levRatio,
  levenshtein,
  similarity,
  tokenSetRatio,
} from "../dist/index.js";

test("levenshtein distances and the length-normalized ratio", () => {
  assert.equal(levenshtein("email", "email"), 0);
  assert.equal(levenshtein("email", "emails"), 1);
  assert.equal(levenshtein("email", "emeil"), 1);
  assert.equal(levenshtein("kitten", "sitting"), 3); // classic textbook case
  assert.equal(levenshtein("", "abc"), 3);

  assert.equal(levRatio("abc", "abc"), 1);
  assert.equal(levRatio("", ""), 1);
  assert.equal(levRatio("abcd", "abxd"), 0.75);
  assert.equal(levRatio("a", "z"), 0);
});

test("jaro matches reference values; winkler boosts shared prefixes", () => {
  // Canonical examples from the literature.
  assert.ok(Math.abs(jaro("martha", "marhta") - 0.9444444) < 1e-6);
  assert.ok(Math.abs(jaro("dixon", "dicksonx") - 0.7666666) < 1e-6);
  assert.equal(jaro("same", "same"), 1);
  assert.equal(jaro("", "abc"), 0);

  assert.ok(jaroWinkler("email", "emial") > jaro("email", "emial"));
  // No boost below the 0.7 gate.
  const low = jaro("abcdef", "uvwxyz");
  assert.equal(jaroWinkler("abcdef", "uvwxyz"), low);
});

test("tokenSetRatio: word order and duplicates never matter", () => {
  assert.equal(tokenSetRatio(["work", "email", "address"], ["email", "address", "work"]), 1);
  assert.equal(tokenSetRatio(["email", "email"], ["email"]), 1);
});

test("tokenSetRatio: a subset scores high but strictly below 1", () => {
  const s = tokenSetRatio(["email", "address"], ["email", "address", "work"]);
  assert.ok(s > 0.8, `subset should score high, got ${s}`);
  assert.ok(s < 1, "extra tokens must cost something");
});

test("tokenSetRatio: disjoint token sets fall back to string distance", () => {
  const s = tokenSetRatio(["revenue"], ["walrus"]);
  assert.ok(s < 0.5, `disjoint sets must score low, got ${s}`);
});

test("similarity: exact is 1, disjoint is low, symmetric and clamped", () => {
  assert.equal(similarity("email address", "email address"), 1);
  assert.ok(similarity("internal notes", "seats") < 0.6);

  const pairs = [
    ["email address", "e mail"],
    ["seats", "license count"],
    ["", "anything"],
  ];
  for (const [a, b] of pairs) {
    const ab = similarity(a, b);
    const ba = similarity(b, a);
    assert.equal(ab, ba, `similarity("${a}","${b}") must be symmetric`);
    assert.ok(ab >= 0 && ab <= 1);
  }
});

test("similarity: typo beats unrelated field for the same header", () => {
  const typo = similarity("emial", "email");
  const unrelated = similarity("emial", "company");
  assert.ok(typo > 0.85, `typo score too low: ${typo}`);
  assert.ok(typo > unrelated + 0.3);
});

test("similarity: reordered multi-word headers still score near 1", () => {
  const s = similarity("date signup", "signup date");
  assert.ok(s >= 0.99, `reorder should be free, got ${s}`);
});
