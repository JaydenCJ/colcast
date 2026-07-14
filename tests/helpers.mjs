// Shared test helpers: a runner for the compiled CLI, temp-file plumbing,
// and a tiny schema factory. Everything is offline and deterministic —
// the CLI runs against fixed argv and in-memory stdin, never a network.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "dist", "cli.js");

/**
 * Run the compiled CLI. Returns { stdout, stderr, code }; never throws on
 * non-zero exit so tests can assert failure paths, and captures stderr on
 * success too (cast prints its summary there).
 */
export function runCli(args, { input = "" } = {}) {
  const r = spawnSync("node", [CLI, ...args], { input, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 0 };
}

/** Fresh temp dir per call; the OS reclaims it, tests never share state. */
export function tempDir() {
  return mkdtempSync(join(tmpdir(), "colcast-test-"));
}

/** Write a file into a temp dir and return its path. */
export function tempFile(name, content) {
  const p = join(tempDir(), name);
  writeFileSync(p, content);
  return p;
}

/** Minimal contacts-style schema used across matcher/pipeline/CLI tests. */
export function contactsSchema(extra = {}) {
  return {
    fields: [
      { name: "email", type: "string", required: true, aliases: ["e-mail", "mail"] },
      { name: "first_name", type: "string", aliases: ["given name"] },
      { name: "seats", type: "integer" },
      { name: "signed_up", type: "date" },
      { name: "active", type: "boolean" },
      {
        name: "plan",
        type: "enum",
        values: ["free", "pro", "enterprise"],
        valueAliases: { pro: ["professional"] },
      },
    ],
    ...extra,
  };
}

/** Default resolved options, mirroring src/schema.ts DEFAULT_OPTIONS. */
export const OPTS = {
  fuzzyThreshold: 0.8,
  dayFirst: false,
  trim: true,
  nullValues: ["", "null", "n/a", "na", "none", "-", "--"],
};
