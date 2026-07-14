#!/usr/bin/env bash
# Smoke test for colcast: exercises the real CLI end to end on a messy
# customer-style CSV — map, cast, check, init, exit codes and the JSON
# report. No network, idempotent, runs from a clean checkout (after
# `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in map cast check init --schema --threshold "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 with a diagnostic on stderr.
set +e
$CLI frobnicate >/dev/null 2>"$WORKDIR/err"; code=$?
set -e
[ "$code" -eq 2 ] || fail "unknown command should exit 2, got $code"
grep -q "^colcast: " "$WORKDIR/err" || fail "usage error must print a diagnostic"
echo "[smoke] usage errors ok (exit 2)"

# 4. map: the bundled messy example maps 9/10 columns via all four stages.
$CLI map "$ROOT/examples/messy.csv" --schema "$ROOT/examples/contacts.schema.json" > "$WORKDIR/plan"
for stage in exact alias pattern fuzzy; do
  grep -q "$stage" "$WORKDIR/plan" || fail "mapping plan missing stage $stage"
done
grep -q 'unmapped columns (1): "Internal Notes"' "$WORKDIR/plan" || fail "unmapped column not reported"
echo "[smoke] map ok (all four stages exercised)"

# 5. cast: canonical CSV on stdout, summary on stderr, report as JSON.
$CLI cast "$ROOT/examples/messy.csv" --schema "$ROOT/examples/contacts.schema.json" \
  --report "$WORKDIR/report.json" > "$WORKDIR/out.csv" 2> "$WORKDIR/summary"
head -1 "$WORKDIR/out.csv" | grep -q "^email,first_name,last_name,company,seats,mrr,signed_up,active,plan$" \
  || fail "cast header row wrong"
grep -q "ada@example.test,Ada,Lovelace,Analytical Engines Ltd,120,4860,2024-11-03,true,enterprise" "$WORKDIR/out.csv" \
  || fail "cast row 1 not canonical"
grep -q "grace@example.test,Grace,Hopper,Flowmatic Inc,15,1234.5," "$WORKDIR/out.csv" \
  || fail "European decimal not normalized"
grep -q "cast failures: 2" "$WORKDIR/summary" || fail "summary should count 2 failures"
node -e "
  const r = require('$WORKDIR/report.json');
  if (r.tool !== 'colcast') throw new Error('report.tool');
  if (r.summary.mappedColumns !== 9) throw new Error('mappedColumns: ' + r.summary.mappedColumns);
  if (r.summary.castFailures !== 2) throw new Error('castFailures: ' + r.summary.castFailures);
  if (r.summary.ok !== false) throw new Error('ok flag');
" || fail "report JSON wrong"
echo "[smoke] cast ok (canonical CSV + JSON report)"

# 6. check: exit 1 on the dirty example, exit 0 once cleaned.
set +e
$CLI check "$ROOT/examples/messy.csv" --schema "$ROOT/examples/contacts.schema.json" > "$WORKDIR/check"; code=$?
set -e
[ "$code" -eq 1 ] || fail "check on dirty data should exit 1, got $code"
grep -q "result: FAIL" "$WORKDIR/check" || fail "check should print FAIL"
cat > "$WORKDIR/clean.csv" <<'CSV'
E-Mail Address,firstName,SURNAME,Licence Count
ada@example.test,Ada,Lovelace,120
CSV
$CLI check "$WORKDIR/clean.csv" --schema "$ROOT/examples/contacts.schema.json" > "$WORKDIR/check2" \
  || fail "check on clean data should exit 0"
grep -q "result: OK" "$WORKDIR/check2" || fail "check should print OK"
echo "[smoke] check ok (exit 1 dirty, exit 0 clean)"

# 7. init: draft a schema from headers+data, then cast with it directly.
$CLI init "$WORKDIR/clean.csv" --out "$WORKDIR/draft.json" || fail "init failed"
node -e "
  const s = require('$WORKDIR/draft.json');
  const seats = s.fields.find(f => f.name === 'licence_count');
  if (!seats || seats.type !== 'integer') throw new Error('inferred type wrong');
" || fail "draft schema wrong"
$CLI cast "$WORKDIR/clean.csv" --schema "$WORKDIR/draft.json" 2>/dev/null > "$WORKDIR/draftcast.csv" \
  || fail "cast with drafted schema failed"
head -1 "$WORKDIR/draftcast.csv" | grep -q "licence_count" || fail "drafted cast header wrong"
echo "[smoke] init ok (draft round-trips into cast)"

# 8. stdin, --strict and --passthrough through a real pipe.
printf 'E-Mail,Notes\nada@example.test,vip\n' \
  | $CLI cast - --schema "$ROOT/examples/contacts.schema.json" --passthrough 2>/dev/null > "$WORKDIR/pipe.csv"
head -1 "$WORKDIR/pipe.csv" | grep -q ",Notes$" || fail "--passthrough should keep Notes"
set +e
printf 'E-Mail,Licence Count\nada@example.test,lots\n' \
  | $CLI cast - --schema "$ROOT/examples/contacts.schema.json" --strict >/dev/null 2>&1; code=$?
set -e
[ "$code" -eq 1 ] || fail "--strict on bad data should exit 1, got $code"
echo "[smoke] stdin/--strict/--passthrough ok"

echo "SMOKE OK"
