/**
 * Shared types for colcast: the declarative schema that describes the
 * canonical shape, the mapping decisions the matcher produces, and the
 * cast report the pipeline emits. Everything here is plain data — the
 * whole library is pure functions over these structures.
 */

/** Canonical value types a field can declare. */
export type FieldType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "enum";

/** One canonical field in the target schema. */
export interface FieldSpec {
  /** Canonical output column name (unique within a schema). */
  name: string;
  /** Value type every cell of this column is cast to. Default: "string". */
  type?: FieldType;
  /** When true, an input column MUST map here or the run is not ok. */
  required?: boolean;
  /** Exact synonyms, compared after header normalization. */
  aliases?: string[];
  /**
   * Case-insensitive regular expressions tested against the raw
   * (trimmed) header. First field whose pattern matches wins the stage.
   */
  patterns?: string[];
  /** Allowed values for type "enum" (matched case-insensitively). */
  values?: string[];
  /** Per-value synonyms for type "enum": canonical -> synonyms. */
  valueAliases?: Record<string, string[]>;
  /** Human note; carried into `colcast init` output and reports. */
  description?: string;
}

/** Schema-level options (all optional; defaults in `schema.ts`). */
export interface SchemaOptions {
  /** Minimum fuzzy score (0..1) to accept a fuzzy match. Default 0.8. */
  fuzzyThreshold?: number;
  /** Interpret ambiguous numeric dates as day-first (DMY). Default false. */
  dayFirst?: boolean;
  /** Trim surrounding whitespace from every cell before casting. Default true. */
  trim?: boolean;
  /** Cell spellings treated as empty (after trim), e.g. "N/A". */
  nullValues?: string[];
}

/** A declarative mapping file: the unit `colcast --schema` loads. */
export interface Schema {
  fields: FieldSpec[];
  options?: SchemaOptions;
}

/** How a header ended up mapped to a field. */
export type MatchMethod = "exact" | "alias" | "pattern" | "fuzzy";

/** One accepted header -> field decision. */
export interface ColumnMapping {
  /** Raw header text as it appeared in the input. */
  header: string;
  /** Zero-based input column index. */
  index: number;
  /** Canonical field name the column maps to. */
  field: string;
  /** Pipeline stage that produced the match. */
  method: MatchMethod;
  /** Similarity score; 1 for rule stages, the fuzzy score otherwise. */
  score: number;
}

/** A fuzzy candidate that scored above zero but was not accepted. */
export interface RejectedCandidate {
  header: string;
  index: number;
  field: string;
  score: number;
  reason: "below-threshold" | "field-taken" | "header-taken";
}

/** Full result of matching a header row against a schema. */
export interface MappingResult {
  mappings: ColumnMapping[];
  /** Input headers no field claimed. */
  unmapped: { header: string; index: number }[];
  /** Required field names with no mapped column. */
  missingRequired: string[];
  /** Near-misses, useful for tuning thresholds and aliases. */
  rejected: RejectedCandidate[];
}

/** One cell that failed to cast. */
export interface CastFailure {
  /** 1-based data row number (header excluded). */
  row: number;
  /** Raw cell text that failed. */
  value: string;
  reason: string;
}

/** Per-field cast statistics. */
export interface FieldCastStats {
  field: string;
  type: FieldType;
  ok: number;
  empty: number;
  failed: number;
  /** First failures, capped at `REPORT_FAILURE_CAP` per field. */
  failures: CastFailure[];
}

/** The auditable artifact `colcast cast --report` writes. */
export interface CastReport {
  tool: "colcast";
  version: string;
  input: { columns: number; rows: number };
  mapping: ColumnMapping[];
  unmapped: { header: string; index: number }[];
  missingRequired: string[];
  rejected: RejectedCandidate[];
  fields: FieldCastStats[];
  summary: {
    mappedColumns: number;
    unmappedColumns: number;
    castFailures: number;
    /** true iff nothing required is missing and no cell failed to cast. */
    ok: boolean;
  };
}

/** Options for the cast pipeline (CLI flags map 1:1 onto these). */
export interface CastOptions {
  /** Append unmapped input columns after canonical ones. Default false. */
  passthrough?: boolean;
  /** On cast failure keep the raw text instead of emptying the cell. Default false. */
  keepRaw?: boolean;
}

/** Result of running the full pipeline over a parsed CSV. */
export interface CastResult {
  /** Canonical header row followed by cast data rows. */
  rows: string[][];
  report: CastReport;
}
