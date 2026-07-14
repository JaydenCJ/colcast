/**
 * Human-readable rendering of mapping plans and cast reports. The JSON
 * forms are the machine contract; these renderers exist so `colcast map`
 * and `colcast check` read well in a terminal without any styling deps.
 */

import type { CastReport, MappingResult } from "./types.js";

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/** Render an aligned plain-text table (no ANSI, pipe-safe). */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i] as number)).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n") + "\n";
}

/** Text rendering of `colcast map` (the mapping plan). */
export function renderMapping(result: MappingResult): string {
  let out = "";
  if (result.mappings.length > 0) {
    out += renderTable(
      ["#", "header", "->", "field", "via", "score"],
      result.mappings.map((m) => [
        String(m.index),
        m.header,
        "->",
        m.field,
        m.method,
        m.score.toFixed(2),
      ]),
    );
  } else {
    out += "no columns mapped\n";
  }
  if (result.unmapped.length > 0) {
    out += `\nunmapped columns (${result.unmapped.length}): ` +
      result.unmapped.map((u) => JSON.stringify(u.header)).join(", ") + "\n";
  }
  if (result.missingRequired.length > 0) {
    out += `missing required fields: ${result.missingRequired.join(", ")}\n`;
  }
  // Only surface near-misses that explain a problem: an unmapped header
  // or a missing required field. Full detail lives in the JSON output.
  const unmappedSet = new Set(result.unmapped.map((u) => u.index));
  const missingSet = new Set(result.missingRequired);
  for (const r of result.rejected) {
    if (r.reason !== "below-threshold") continue;
    if (!unmappedSet.has(r.index) && !missingSet.has(r.field)) continue;
    out += `note: ${JSON.stringify(r.header)} ~ ${r.field} scored ${r.score.toFixed(2)} (below threshold)\n`;
  }
  return out;
}

/** Text rendering of a cast report summary (`colcast cast` / `check`). */
export function renderReport(report: CastReport): string {
  let out = "";
  out += `columns: ${report.summary.mappedColumns}/${report.input.columns} mapped`;
  if (report.summary.unmappedColumns > 0) {
    out += ` (${report.summary.unmappedColumns} unmapped)`;
  }
  out += `\nrows: ${report.input.rows}\n`;
  const failing = report.fields.filter((f) => f.failed > 0);
  if (failing.length > 0) {
    out += `cast failures: ${report.summary.castFailures}\n`;
    for (const f of failing) {
      out += `  ${f.field} (${f.type}): ${f.failed} failed\n`;
      for (const x of f.failures.slice(0, 3)) {
        out += `    row ${x.row}: ${x.reason}\n`;
      }
      if (f.failed > 3) out += `    … ${f.failed - 3} more (see --report JSON)\n`;
    }
  }
  if (report.missingRequired.length > 0) {
    out += `missing required fields: ${report.missingRequired.join(", ")}\n`;
  }
  out += report.summary.ok ? "result: OK\n" : "result: FAIL\n";
  return out;
}
