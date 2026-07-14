# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Declarative mapping files (JSON): typed canonical fields with
  `aliases`, case-insensitive regex `patterns`, `required` flags, enum
  `values` + `valueAliases`, and schema-level options (`fuzzyThreshold`,
  `dayFirst`, `trim`, `nullValues`) — all validated up front with the
  field index and name in every error message.
- A four-stage matching pipeline with strict precedence: exact name,
  alias, pattern, then fuzzy fallback. Rules always beat guesses.
- Header normalization shared by all stages: NFKC folding, camelCase
  and digit-boundary splitting, punctuation collapsing — so
  `E-Mail Address`, `EMAIL_ADDRESS` and `emailAddress` are one name.
- A hybrid fuzzy scorer (Jaro-Winkler + token-set Levenshtein ratio)
  with unambiguous business-abbreviation expansion (`qty`, `dob`, …),
  a configurable threshold, and deterministic one-to-one assignment.
- A rejected-candidates audit trail: every near-miss and conflict is
  reported with a reason (`below-threshold`, `field-taken`,
  `header-taken`) so thresholds and aliases are tunable from the report
  alone.
- Type casting to canonical forms with locale-aware tolerance:
  integers/numbers (currency symbols, both `1,234.56` and `1.234,56`
  conventions, accounting parentheses, safe-range checks), booleans
  (12 spellings), dates (ISO, numeric with `dayFirst`, month names,
  two-digit years — always emitted as `YYYY-MM-DD`, real-calendar
  validated), and enums with per-value synonyms. Ambiguous spellings
  fail with a quoted reason instead of being guessed.
- Cast reports (JSON): per-column mapping method + score, unmapped
  headers, missing required fields, per-field ok/empty/failed counts
  with capped row-level failures, and a single `summary.ok` flag.
- A dependency-free RFC 4180 CSV reader/writer: quoted fields, embedded
  newlines, CRLF/CR, BOM, bare mid-field quotes, custom delimiters.
- The `colcast` CLI: `map` (plan with stage + score per column), `cast`
  (canonical CSV on stdout, summary on stderr, `--out`, `--report`,
  `--passthrough`, `--keep-raw`, `--strict`), `check` (CI gate, exit 1
  on missing required fields or cast failures) and `init` (draft a
  schema from a CSV with conservative type inference). Exit codes
  0/1/2; stdin via `-`.
- A runnable example (`examples/messy.csv` + `contacts.schema.json`)
  exercising every stage and every cast family.
- Design contract in `docs/mapping-spec.md`; test suite: 90 node:test
  tests plus an end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/colcast/releases/tag/v0.1.0
