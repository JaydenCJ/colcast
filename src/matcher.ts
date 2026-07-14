/**
 * The mapping pipeline: decide which input header feeds which canonical
 * field. Four stages, strictly ordered so declarative rules always beat
 * guesses:
 *
 *   1. exact   — normalized header equals the normalized field name
 *   2. alias   — normalized header equals a normalized alias
 *   3. pattern — a field regex matches the raw (trimmed) header
 *   4. fuzzy   — best hybrid similarity >= threshold
 *
 * Assignment is one-to-one and deterministic: within a stage, ties break
 * by score (fuzzy only), then input column order, then schema field
 * order. Everything the matcher *almost* did is surfaced in `rejected`
 * so a threshold or missing alias is debuggable from the report alone.
 */

import type {
  ColumnMapping,
  MappingResult,
  MatchMethod,
  RejectedCandidate,
  Schema,
} from "./types.js";
import { fuzzyForm, normalizeHeader } from "./normalize.js";
import { similarity } from "./similarity.js";
import { schemaOptions } from "./schema.js";

interface Candidate {
  headerIndex: number;
  fieldIndex: number;
  method: MatchMethod;
  score: number;
}

const STAGE_ORDER: Record<MatchMethod, number> = {
  exact: 0,
  alias: 1,
  pattern: 2,
  fuzzy: 3,
};

/** Map a header row onto a schema. Pure and deterministic. */
export function mapHeaders(headers: string[], schema: Schema): MappingResult {
  const opts = schemaOptions(schema);
  const threshold = opts.fuzzyThreshold;
  const fields = schema.fields;

  const normHeaders = headers.map((h) => normalizeHeader(h));
  const fuzzyHeaders = headers.map((h) => fuzzyForm(h));

  // Precompute per-field lookup keys.
  const fieldNorm = fields.map((f) => normalizeHeader(f.name));
  const fieldAliasNorm = fields.map((f) => (f.aliases ?? []).map((a) => normalizeHeader(a)));
  const fieldPatterns = fields.map((f) => (f.patterns ?? []).map((p) => new RegExp(p, "i")));
  // Fuzzy candidates per field: the name plus every alias, expanded.
  const fieldFuzzyForms = fields.map((f) => {
    const names = [f.name, ...(f.aliases ?? [])];
    return [...new Set(names.map((n) => fuzzyForm(n)))];
  });

  const candidates: Candidate[] = [];
  for (let h = 0; h < headers.length; h++) {
    const norm = normHeaders[h] as string;
    if (norm === "") continue; // blank headers can never be matched
    const raw = (headers[h] as string).trim();
    const fz = fuzzyHeaders[h] as string;
    for (let f = 0; f < fields.length; f++) {
      if (norm === fieldNorm[f]) {
        candidates.push({ headerIndex: h, fieldIndex: f, method: "exact", score: 1 });
        continue; // exact subsumes everything else for this pair
      }
      if ((fieldAliasNorm[f] as string[]).includes(norm)) {
        candidates.push({ headerIndex: h, fieldIndex: f, method: "alias", score: 1 });
        continue;
      }
      if ((fieldPatterns[f] as RegExp[]).some((re) => re.test(raw))) {
        candidates.push({ headerIndex: h, fieldIndex: f, method: "pattern", score: 1 });
        continue;
      }
      let best = 0;
      for (const form of fieldFuzzyForms[f] as string[]) {
        const s = similarity(fz, form);
        if (s > best) best = s;
      }
      if (best > 0) {
        candidates.push({ headerIndex: h, fieldIndex: f, method: "fuzzy", score: best });
      }
    }
  }

  // Deterministic priority: stage, then score desc, then column, then field.
  candidates.sort((a, b) => {
    const stage = STAGE_ORDER[a.method] - STAGE_ORDER[b.method];
    if (stage !== 0) return stage;
    if (a.score !== b.score) return b.score - a.score;
    if (a.headerIndex !== b.headerIndex) return a.headerIndex - b.headerIndex;
    return a.fieldIndex - b.fieldIndex;
  });

  const headerTaken = new Array<boolean>(headers.length).fill(false);
  const fieldTaken = new Array<boolean>(fields.length).fill(false);
  const mappings: ColumnMapping[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const c of candidates) {
    const header = headers[c.headerIndex] as string;
    const field = (fields[c.fieldIndex] as { name: string }).name;
    const base = { header, index: c.headerIndex, field, score: round6(c.score) };
    if (c.method === "fuzzy" && c.score < threshold) {
      rejected.push({ ...base, reason: "below-threshold" });
      continue;
    }
    if (fieldTaken[c.fieldIndex]) {
      rejected.push({ ...base, reason: "field-taken" });
      continue;
    }
    if (headerTaken[c.headerIndex]) {
      rejected.push({ ...base, reason: "header-taken" });
      continue;
    }
    headerTaken[c.headerIndex] = true;
    fieldTaken[c.fieldIndex] = true;
    mappings.push({ header, index: c.headerIndex, field, method: c.method, score: round6(c.score) });
  }

  mappings.sort((a, b) => a.index - b.index);

  const unmapped = headers
    .map((header, index) => ({ header, index }))
    .filter((h) => !headerTaken[h.index]);
  const missingRequired = fields
    .filter((f, i) => f.required === true && !fieldTaken[i])
    .map((f) => f.name);

  // Only keep rejections that explain something: near-misses within 0.15
  // of the threshold, or conflicts. Noise below that is dropped.
  const explained = rejected.filter(
    (r) => r.reason !== "below-threshold" || r.score >= Math.max(0, threshold - 0.15),
  );

  return { mappings, unmapped, missingRequired, rejected: explained };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
