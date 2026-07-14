/**
 * The full colcast pipeline: map the header row, cast every data cell,
 * and assemble the report. This is the function the CLI's `cast` and
 * `check` commands call and the primary library entry point.
 */

import type {
  CastOptions,
  CastReport,
  CastResult,
  FieldCastStats,
  FieldSpec,
  Schema,
} from "./types.js";
import { mapHeaders } from "./matcher.js";
import { castValue } from "./cast.js";
import { schemaOptions } from "./schema.js";
import { VERSION } from "./version.js";

/** Cap on stored failures per field so reports stay bounded. */
export const REPORT_FAILURE_CAP = 25;

/**
 * Run mapping + casting over parsed CSV rows (header row first).
 * Output columns are in schema order; unmapped input columns are dropped
 * unless `passthrough` keeps them (appended, original headers).
 */
export function castRows(
  rows: string[][],
  schema: Schema,
  castOpts: CastOptions = {},
): CastResult {
  if (rows.length === 0) {
    throw new Error("input has no rows (need at least a header row)");
  }
  const headers = rows[0] as string[];
  const dataRows = rows.slice(1);
  const opts = schemaOptions(schema);
  const mapping = mapHeaders(headers, schema);

  // field name -> input column index (for mapped fields only)
  const sourceIndex = new Map<string, number>();
  for (const m of mapping.mappings) sourceIndex.set(m.field, m.index);

  const stats: FieldCastStats[] = schema.fields.map((f) => ({
    field: f.name,
    type: f.type ?? "string",
    ok: 0,
    empty: 0,
    failed: 0,
    failures: [],
  }));

  const passthroughCols = castOpts.passthrough === true ? mapping.unmapped : [];
  const outHeader = [
    ...schema.fields.map((f) => f.name),
    ...passthroughCols.map((u) => u.header),
  ];
  const outRows: string[][] = [outHeader];

  for (let r = 0; r < dataRows.length; r++) {
    const inRow = dataRows[r] as string[];
    const outRow: string[] = [];
    for (let f = 0; f < schema.fields.length; f++) {
      const field = schema.fields[f] as FieldSpec;
      const stat = stats[f] as FieldCastStats;
      const src = sourceIndex.get(field.name);
      if (src === undefined) {
        outRow.push("");
        continue;
      }
      const raw = inRow[src] ?? "";
      const outcome = castValue(raw, field, opts);
      if (outcome.kind === "value") {
        stat.ok++;
        outRow.push(outcome.value);
      } else if (outcome.kind === "empty") {
        stat.empty++;
        outRow.push("");
      } else {
        stat.failed++;
        if (stat.failures.length < REPORT_FAILURE_CAP) {
          stat.failures.push({ row: r + 1, value: raw, reason: outcome.reason });
        }
        outRow.push(castOpts.keepRaw === true ? raw : "");
      }
    }
    for (const u of passthroughCols) outRow.push(inRow[u.index] ?? "");
    outRows.push(outRow);
  }

  const castFailures = stats.reduce((n, s) => n + s.failed, 0);
  const report: CastReport = {
    tool: "colcast",
    version: VERSION,
    input: { columns: headers.length, rows: dataRows.length },
    mapping: mapping.mappings,
    unmapped: mapping.unmapped,
    missingRequired: mapping.missingRequired,
    rejected: mapping.rejected,
    fields: stats,
    summary: {
      mappedColumns: mapping.mappings.length,
      unmappedColumns: mapping.unmapped.length,
      castFailures,
      ok: mapping.missingRequired.length === 0 && castFailures === 0,
    },
  };
  return { rows: outRows, report };
}
