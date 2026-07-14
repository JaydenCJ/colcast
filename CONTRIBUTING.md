# Contributing to colcast

Issues, discussions and pull requests are all welcome — this project
aims to stay a single predictable kernel: zero runtime dependencies,
deterministic mapping decisions, and a report that explains every one
of them.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner).

```bash
git clone https://github.com/JaydenCJ/colcast.git
cd colcast
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check on the bundled messy CSV
```

`scripts/smoke.sh` drives the compiled CLI through the full surface —
map, cast, check, init, stdin, `--strict`, `--passthrough`, the JSON
report and the exit codes — and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean
   (strict mode plus `noUncheckedIndexedAccess` is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the parser, normalizer, matcher and casters all take plain
   data in and return plain data out — never streams or file handles).
5. Anything that changes a mapping decision, a canonical cast form or
   the report shape must update `docs/mapping-spec.md` — that document
   is contract.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — colcast reads local files and stdin, writes
  local files and stdout, and sends nothing anywhere.
- Determinism is API: the same CSV and schema must always produce the
  same mapping, the same cast output and the same report. No wall-clock
  values, no randomness, no locale-dependent behavior.
- Casting must never guess silently. If a spelling is ambiguous
  (`1,23,4`, `(-5)`), fail with a reason rather than picking one
  interpretation.
- The CLI exit codes (0 clean / 1 check failed / 2 usage error) and the
  stdout-is-pure-CSV rule for `cast` must not change meaning within a
  major version.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `colcast --version` output, the mapping file, and a
minimal CSV (headers plus one or two rows) that reproduces the problem
— for mapping bugs, the `colcast map --json` output shows exactly which
stage and score produced the bad decision and is the most useful single
artifact.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
