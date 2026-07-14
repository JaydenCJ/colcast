// End-to-end CLI tests against the compiled dist/cli.js: real argv, real
// files in temp dirs, real stdin, real exit codes. These prove the whole
// pipeline is reachable from a shell, and pin the exit-code contract CI
// gates depend on (0 clean, 1 check failed, 2 usage error).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { contactsSchema, ROOT, runCli, tempDir, tempFile } from "./helpers.mjs";

const SCHEMA = tempFile("schema.json", JSON.stringify(contactsSchema()));
const CSV = [
  "E-Mail,Given Name,Seats,Plan",
  "ada@example.test,Ada,120,PRO",
  "grace@example.test,Grace,15,professional",
  "",
].join("\n");
const CSV_FILE = tempFile("in.csv", CSV);
const DIRTY_FILE = tempFile("dirty.csv", "E-Mail,Seats\nada@example.test,lots\n");

test("--version matches package.json; --help documents commands and exit codes", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);

  const help = runCli(["--help"]);
  assert.equal(help.code, 0);
  for (const word of ["map", "cast", "check", "init", "--schema", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
  const bare = runCli([]);
  assert.equal(bare.code, 0);
  assert.ok(bare.stdout.includes("Usage:"));
});

test("map prints the plan; --json emits the full MappingResult", () => {
  const plain = runCli(["map", CSV_FILE, "--schema", SCHEMA]);
  assert.equal(plain.code, 0);
  assert.match(plain.stdout, /E-Mail\s+->\s+email\s+alias/);
  const json = runCli(["map", CSV_FILE, "--schema", SCHEMA, "--json"]);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.mappings.length, 4);
  assert.deepEqual(parsed.missingRequired, []);
});

test("cast writes canonical CSV to stdout, summary to stderr", () => {
  const { stdout, stderr, code } = runCli(["cast", CSV_FILE, "--schema", SCHEMA]);
  assert.equal(code, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines[0], "email,first_name,seats,signed_up,active,plan");
  assert.equal(lines[1], "ada@example.test,Ada,120,,,pro");
  assert.match(stderr, /columns: 4\/4 mapped/);
  assert.equal(stdout.includes("columns:"), false, "stdout must stay pure CSV");
});

test("cast --out and --report write files; report JSON is complete", () => {
  const dir = tempDir();
  const out = join(dir, "out.csv");
  const rep = join(dir, "report.json");
  const { code } = runCli(["cast", CSV_FILE, "--schema", SCHEMA, "--out", out, "--report", rep]);
  assert.equal(code, 0);
  assert.match(readFileSync(out, "utf8"), /^email,first_name/);
  const report = JSON.parse(readFileSync(rep, "utf8"));
  assert.equal(report.tool, "colcast");
  assert.equal(report.summary.ok, true);
  assert.equal(report.mapping.length, 4);
});

test("cast exits 0 on dirty data unless --strict", () => {
  const soft = runCli(["cast", DIRTY_FILE, "--schema", SCHEMA]);
  assert.equal(soft.code, 0);
  const strict = runCli(["cast", DIRTY_FILE, "--schema", SCHEMA, "--strict"]);
  assert.equal(strict.code, 1);
  assert.match(strict.stderr, /result: FAIL/);
});

test("cast --passthrough and --keep-raw flow through to the output", () => {
  const withNotes = tempFile("notes.csv", "E-Mail,Notes\nada@example.test,vip\n");
  const pt = runCli(["cast", withNotes, "--schema", SCHEMA, "--passthrough"]);
  assert.match(pt.stdout.split("\n")[0], /,Notes$/);
  const kr = runCli(["cast", DIRTY_FILE, "--schema", SCHEMA, "--keep-raw"]);
  assert.match(kr.stdout, /,lots,/);
});

test("check exits 0/1 with a summary; --json emits the machine-readable report", () => {
  const good = runCli(["check", CSV_FILE, "--schema", SCHEMA]);
  assert.equal(good.code, 0);
  assert.match(good.stdout, /result: OK/);
  const bad = runCli(["check", DIRTY_FILE, "--schema", SCHEMA]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /result: FAIL/);

  const json = runCli(["check", DIRTY_FILE, "--schema", SCHEMA, "--json"]);
  assert.equal(json.code, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.summary.ok, false);
  assert.equal(report.summary.castFailures, 1);
});

test("init drafts a schema that immediately works for cast", () => {
  const dir = tempDir();
  const schemaOut = join(dir, "draft.json");
  const init = runCli(["init", CSV_FILE, "--out", schemaOut]);
  assert.equal(init.code, 0);
  const draft = JSON.parse(readFileSync(schemaOut, "utf8"));
  assert.equal(draft.fields.find((f) => f.name === "seats").type, "integer");
  const cast = runCli(["cast", CSV_FILE, "--schema", schemaOut]);
  assert.equal(cast.code, 0);
  assert.match(cast.stdout.split("\n")[0], /^e_mail,given_name,seats,plan$/);
});

test("stdin input via '-' works for map and cast", () => {
  const { stdout, code } = runCli(["cast", "-", "--schema", SCHEMA], { input: CSV });
  assert.equal(code, 0);
  assert.match(stdout, /^email,/);
});

test("--delimiter handles semicolon and the \\t spelling", () => {
  const semi = tempFile("semi.csv", "E-Mail;Seats\nada@example.test;5\n");
  const r = runCli(["cast", semi, "--schema", SCHEMA, "--delimiter", ";"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^email;first_name;seats/);
  const tab = tempFile("tab.tsv", "E-Mail\tSeats\nada@example.test\t5\n");
  const t = runCli(["map", tab, "--schema", SCHEMA, "--delimiter", "\\t", "--json"]);
  assert.equal(JSON.parse(t.stdout).mappings.length, 2);
});

test("--threshold overrides the schema's fuzzy threshold", () => {
  const typo = tempFile("typo.csv", "Emial\nada@example.test\n");
  const loose = runCli(["map", typo, "--schema", SCHEMA, "--json"]);
  assert.equal(JSON.parse(loose.stdout).mappings.length, 1);
  const strict = runCli(["map", typo, "--schema", SCHEMA, "--threshold", "0.99", "--json"]);
  assert.equal(JSON.parse(strict.stdout).mappings.length, 0);
});

test("usage and schema errors exit 2 with diagnostics on stderr", () => {
  const cases = [
    ["frobnicate"],
    ["map", CSV_FILE], // missing --schema
    ["map", "--schema", SCHEMA], // missing input
    ["map", CSV_FILE, "--schema", SCHEMA, "--threshold", "5"],
    ["map", CSV_FILE, "--schema", SCHEMA, "--bogus-flag"],
  ];
  for (const args of cases) {
    const { code, stderr } = runCli(args);
    assert.equal(code, 2, `expected exit 2 for: ${args.join(" ")}`);
    assert.match(stderr, /^colcast: /);
  }

  const badSchema = tempFile("bad.json", JSON.stringify({ fields: [{ name: "x", type: "uuid" }] }));
  const broken = runCli(["map", CSV_FILE, "--schema", badSchema]);
  assert.equal(broken.code, 2);
  assert.match(broken.stderr, /schema error: .*unknown type "uuid"/);

  const missing = runCli(["map", "no-such-file.csv", "--schema", SCHEMA]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /file not found/);
  assert.equal(missing.stderr.includes("at "), false, "no stack trace on user errors");
});

test("the bundled example maps and casts exactly as documented", () => {
  const csv = join(ROOT, "examples", "messy.csv");
  const schema = join(ROOT, "examples", "contacts.schema.json");
  const map = runCli(["map", csv, "--schema", schema, "--json"]);
  assert.equal(map.code, 0);
  const parsed = JSON.parse(map.stdout);
  assert.equal(parsed.mappings.length, 9);
  assert.deepEqual(parsed.unmapped.map((u) => u.header), ["Internal Notes"]);
  const check = runCli(["check", csv, "--schema", schema]);
  assert.equal(check.code, 1, "the example is deliberately dirty");
});
