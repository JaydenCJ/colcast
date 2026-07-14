#!/usr/bin/env node
/**
 * colcast CLI: `map` (show the mapping plan), `cast` (write canonical
 * CSV + report), `check` (CI gate: exit 1 unless the file is clean),
 * `init` (draft a schema from a CSV). Exit codes: 0 success, 1 check
 * failure, 2 usage error. All I/O is local files or stdin — no network.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "./csv.js";
import { parseSchema, SchemaError } from "./schema.js";
import { mapHeaders } from "./matcher.js";
import { castRows } from "./pipeline.js";
import { writeCsv } from "./csv.js";
import { draftSchema } from "./init.js";
import { renderMapping, renderReport } from "./report.js";
import { VERSION } from "./version.js";
import type { Schema } from "./types.js";

const USAGE = `colcast ${VERSION} — map messy CSV headers onto a canonical schema

Usage:
  colcast map   <input.csv> --schema <schema.json> [--json]
  colcast cast  <input.csv> --schema <schema.json> [--out <file>] [--report <file>]
                [--passthrough] [--keep-raw] [--strict]
  colcast check <input.csv> --schema <schema.json> [--json]
  colcast init  <input.csv> [--out <schema.json>]
  colcast --version | --help

Options:
  --schema <file>     mapping file (JSON) with fields, aliases, patterns
  --delimiter <char>  field delimiter (default ","; use "\\t" or ";")
  --threshold <0..1>  override the schema's fuzzy threshold
  --out <file>        output path (default: stdout)
  --report <file>     write the full cast report as JSON
  --passthrough       append unmapped input columns to the output
  --keep-raw          keep original text for cells that fail to cast
  --strict            cast: exit 1 when the report is not ok
  --json              map/check: print machine-readable JSON

Input "-" reads CSV from stdin.
Exit codes: 0 success · 1 check failed · 2 usage error.`;

class UsageError extends Error {}

interface Flags {
  schema?: string;
  delimiter: string;
  threshold?: number;
  out?: string;
  report?: string;
  passthrough: boolean;
  keepRaw: boolean;
  strict: boolean;
  json: boolean;
  positional: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    delimiter: ",",
    passthrough: false,
    keepRaw: false,
    strict: false,
    json: false,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--schema": flags.schema = next(); break;
      case "--delimiter": {
        let d = next();
        if (d === "\\t") d = "\t";
        if (d.length !== 1) throw new UsageError("--delimiter must be a single character");
        flags.delimiter = d;
        break;
      }
      case "--threshold": {
        const t = Number(next());
        if (!Number.isFinite(t) || t < 0 || t > 1) {
          throw new UsageError("--threshold must be a number in [0, 1]");
        }
        flags.threshold = t;
        break;
      }
      case "--out": flags.out = next(); break;
      case "--report": flags.report = next(); break;
      case "--passthrough": flags.passthrough = true; break;
      case "--keep-raw": flags.keepRaw = true; break;
      case "--strict": flags.strict = true; break;
      case "--json": flags.json = true; break;
      default:
        if (a.startsWith("--")) throw new UsageError(`unknown option ${a}`);
        flags.positional.push(a);
    }
  }
  return flags;
}

function readInput(path: string): string {
  return path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
}

function loadSchema(flags: Flags): Schema {
  if (flags.schema === undefined) {
    throw new UsageError("--schema <file> is required");
  }
  const schema = parseSchema(readFileSync(flags.schema, "utf8"));
  if (flags.threshold !== undefined) {
    schema.options = { ...(schema.options ?? {}), fuzzyThreshold: flags.threshold };
  }
  return schema;
}

function loadRows(flags: Flags): string[][] {
  const input = flags.positional[1];
  if (input === undefined) throw new UsageError("missing <input.csv>");
  if (flags.positional.length > 2) {
    throw new UsageError(`unexpected argument ${JSON.stringify(flags.positional[2])} (one input file per run)`);
  }
  const rows = parseCsv(readInput(input), { delimiter: flags.delimiter }).rows;
  if (rows.length === 0) throw new UsageError(`${input}: no rows (need at least a header row)`);
  return rows;
}

function emit(text: string, out?: string): void {
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text);
}

function cmdMap(flags: Flags): number {
  const schema = loadSchema(flags);
  const rows = loadRows(flags);
  const result = mapHeaders(rows[0] as string[], schema);
  emit(flags.json ? JSON.stringify(result, null, 2) + "\n" : renderMapping(result), flags.out);
  return 0;
}

function cmdCast(flags: Flags): number {
  const schema = loadSchema(flags);
  const rows = loadRows(flags);
  const { rows: outRows, report } = castRows(rows, schema, {
    passthrough: flags.passthrough,
    keepRaw: flags.keepRaw,
  });
  emit(writeCsv(outRows, flags.delimiter), flags.out);
  if (flags.report !== undefined) {
    writeFileSync(flags.report, JSON.stringify(report, null, 2) + "\n");
  }
  // Summary goes to stderr so stdout stays a clean CSV stream.
  process.stderr.write(renderReport(report));
  return flags.strict && !report.summary.ok ? 1 : 0;
}

function cmdCheck(flags: Flags): number {
  const schema = loadSchema(flags);
  const rows = loadRows(flags);
  const { report } = castRows(rows, schema, {});
  emit(flags.json ? JSON.stringify(report, null, 2) + "\n" : renderReport(report), flags.out);
  return report.summary.ok ? 0 : 1;
}

function cmdInit(flags: Flags): number {
  const rows = loadRows(flags);
  const schema = draftSchema(rows);
  emit(JSON.stringify(schema, null, 2) + "\n", flags.out);
  return 0;
}

export function main(argv: string[]): number {
  if (argv.includes("--version")) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  try {
    const flags = parseArgs(argv);
    const command = flags.positional[0];
    switch (command) {
      case "map": return cmdMap(flags);
      case "cast": return cmdCast(flags);
      case "check": return cmdCheck(flags);
      case "init": return cmdInit(flags);
      default:
        if (command === undefined) {
          throw new UsageError("missing command (expected map, cast, check or init)");
        }
        throw new UsageError(`unknown command ${JSON.stringify(command)} (expected map, cast, check or init)`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`colcast: ${e.message}\n`);
      process.stderr.write(`Run "colcast --help" for usage.\n`);
      return 2;
    }
    if (e instanceof SchemaError) {
      process.stderr.write(`colcast: schema error: ${e.message}\n`);
      return 2;
    }
    if (e instanceof Error && (e as { code?: string }).code === "ENOENT") {
      process.stderr.write(`colcast: file not found: ${(e as { path?: string }).path ?? e.message}\n`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
