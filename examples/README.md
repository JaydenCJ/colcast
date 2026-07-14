# colcast examples

A deliberately messy customer export and the mapping file that tames it.

- `contacts.schema.json` — a canonical CRM-import schema: nine typed
  fields with aliases, one regex pattern, an enum with value aliases,
  and tuned options.
- `messy.csv` — the kind of file customers actually upload: renamed
  headers (`SURNAME`, `Licence Count`), punctuation (`Is Active?`,
  `"MRR, USD"`), mixed date and number locales (`€1.234,50`,
  `03/11/2024`), accounting negatives (`(150)`), enum synonyms
  (`Premium`, `trial`) and two genuinely broken cells.

Run from the repository root (after `npm install && npm run build`):

```bash
# Show how each header will map (stage + score per column)
node dist/cli.js map examples/messy.csv --schema examples/contacts.schema.json

# Write canonical CSV + a JSON audit report
node dist/cli.js cast examples/messy.csv --schema examples/contacts.schema.json \
  --out /tmp/clean.csv --report /tmp/report.json

# CI gate: exits 1 because two cells cannot cast
node dist/cli.js check examples/messy.csv --schema examples/contacts.schema.json
```

The `check` failure is intentional: row 4 has seats `"not sure"` and the
date `2024-13-45`. The report names both, with row numbers and reasons.
