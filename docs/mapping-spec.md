# colcast mapping files and matching pipeline

This document is the contract for `--schema` files and the mapping
decisions colcast makes with them. Behavior described here is stable
API within a major version; the test suite pins every rule.

## Mapping file format

A mapping file is a JSON object with a `fields` array and an optional
`options` object:

```json
{
  "fields": [
    {
      "name": "email",
      "type": "string",
      "required": true,
      "aliases": ["e-mail", "mail", "email address"],
      "patterns": ["^e-?mail\\b"],
      "description": "Primary contact email"
    },
    {
      "name": "plan",
      "type": "enum",
      "values": ["free", "pro", "enterprise"],
      "valueAliases": { "pro": ["professional", "premium"] }
    }
  ],
  "options": { "fuzzyThreshold": 0.8, "dayFirst": false }
}
```

### Field keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Canonical output column name. Must be unique after normalization. |
| `type` | string | no | One of `string`, `integer`, `number`, `boolean`, `date`, `enum`. Default `string`. |
| `required` | boolean | no | When `true`, an unmapped field makes the run not ok (`check` exits 1). |
| `aliases` | string[] | no | Exact synonyms, compared after normalization. |
| `patterns` | string[] | no | Case-insensitive regexes tested against the raw trimmed header. |
| `values` | string[] | `enum` only | Allowed canonical values. |
| `valueAliases` | object | no (`enum` only) | Map of canonical value to accepted synonyms. |
| `description` | string | no | Human note, carried through untouched. |

### Options

| Key | Default | Effect |
|---|---|---|
| `fuzzyThreshold` | `0.8` | Minimum hybrid similarity (0..1) for the fuzzy stage to accept. |
| `dayFirst` | `false` | Read ambiguous `03/11/2024` as 3 November instead of March 11. |
| `trim` | `true` | Trim surrounding whitespace from every cell before casting. |
| `nullValues` | `["", "null", "n/a", "na", "none", "-", "--"]` | Cell spellings treated as empty (case-insensitive). |

Structural mistakes — unknown types, invalid regexes, `valueAliases`
that reference values not in `values`, colliding field names — are
rejected when the schema loads, with the field index and name in the
error message. A schema never fails halfway through a cast.

## Header normalization

Rule stages compare headers and names in a shared canonical form:

1. Unicode NFKC (full-width forms fold: `ＥＭＡＩＬ` → `EMAIL`)
2. camelCase / PascalCase boundaries become spaces (`firstName` → `first name`)
3. lower-case
4. letter/digit boundaries become spaces (`address1` → `address 1`)
5. every run of non-alphanumeric characters becomes one space
6. whitespace collapsed and trimmed

So `"E-Mail  Address"`, `"EMAIL_ADDRESS"` and `"emailAddress"` are all
`email address`. Headers that normalize to the empty string (blank or
symbol-only) are never matched.

## The four stages

For every header × field pair the matcher takes the **first** stage
that applies; a later stage can never override an earlier one:

| # | Stage | Compares | Score |
|---|---|---|---|
| 1 | `exact` | normalized header == normalized `name` | 1 |
| 2 | `alias` | normalized header == a normalized alias | 1 |
| 3 | `pattern` | any regex in `patterns` matches the raw trimmed header | 1 |
| 4 | `fuzzy` | hybrid similarity vs `name` + every alias | best score |

The fuzzy stage first expands a small fixed table of unambiguous
business abbreviations (`qty` → `quantity`, `dob` → `date of birth`,
…) on both sides, then scores `max(jaroWinkler, tokenSetRatio)`:
Jaro-Winkler catches typos (`Emial`), the token-set ratio catches
re-ordered and partially overlapping multi-word headers (`Signed Up
Date` vs `signup date`). Rule stages never see abbreviation expansion —
declared rules stay literal and predictable.

## Assignment

Matching is globally one-to-one. All candidates are sorted by stage,
then score (descending), then input column index, then schema field
order, and accepted greedily. The ordering makes the result fully
deterministic: the same input and schema always produce the same
mapping, byte for byte.

Everything that loses is kept in `rejected` with a reason:

| Reason | Meaning |
|---|---|
| `below-threshold` | fuzzy score under `fuzzyThreshold` (near-misses within 0.15 are reported) |
| `field-taken` | another header claimed the field at higher priority |
| `header-taken` | this header already mapped to another field |

`colcast map` prints below-threshold notes only when they explain an
unmapped header or a missing required field; `--json` always carries
the full list.

## Cast report

`colcast cast --report report.json` writes the full audit artifact:
the mapping table (method + score per column), unmapped headers,
missing required fields, rejected candidates, and per-field cast
statistics (`ok` / `empty` / `failed` counts plus the first 25 failures
with 1-based row numbers, raw text and reason). `summary.ok` is `true`
exactly when no required field is missing and no cell failed to cast —
the same condition `colcast check` turns into its exit code.
