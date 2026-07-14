/**
 * colcast public API. Everything is pure and synchronous: parse a CSV,
 * load a schema, map headers, cast rows, render reports. The CLI in
 * `cli.ts` is a thin shell over exactly these functions.
 */

export { parseCsv, writeCsv, encodeCell } from "./csv.js";
export type { ParseOptions, ParseResult } from "./csv.js";
export { normalizeHeader, tokens, expandTokens, fuzzyForm } from "./normalize.js";
export { levenshtein, levRatio, jaro, jaroWinkler, tokenSetRatio, similarity } from "./similarity.js";
export { parseSchema, validateSchema, schemaOptions, SchemaError, DEFAULT_OPTIONS, FIELD_TYPES } from "./schema.js";
export { mapHeaders } from "./matcher.js";
export { castValue } from "./cast.js";
export type { CastOutcome } from "./cast.js";
export { castRows, REPORT_FAILURE_CAP } from "./pipeline.js";
export { draftSchema, INIT_SAMPLE_ROWS } from "./init.js";
export { renderMapping, renderReport, renderTable } from "./report.js";
export { VERSION } from "./version.js";
export type {
  CastFailure,
  CastOptions,
  CastReport,
  CastResult,
  ColumnMapping,
  FieldCastStats,
  FieldSpec,
  FieldType,
  MappingResult,
  MatchMethod,
  RejectedCandidate,
  Schema,
  SchemaOptions,
} from "./types.js";
