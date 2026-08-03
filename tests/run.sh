#!/usr/bin/env bash
# Contract tests. Run after any change to the contract, the schemas, or the validator.
#   1. a known-good fixture snapshot must validate
#   2. a snapshot with a broken value, a stray namespace, or an unsubstituted
#      placeholder must be rejected
set -euo pipefail
cd "$(dirname "$0")"
VALIDATE=../skills/ds-snapshot/scripts/validate-snapshot.mjs
rm -rf .tmp

echo "1/2 known-good fixture must pass"
node build-fixture.mjs .tmp/good/ds-snapshots/2026-08-03 >/dev/null
node "$VALIDATE" .tmp/good/ds-snapshots/2026-08-03

echo
echo "2/2 broken fixture must be rejected"
cp -r .tmp/good .tmp/bad
node -e '
const fs = require("fs");
const dir = ".tmp/bad/ds-snapshots/2026-08-03";
const t = JSON.parse(fs.readFileSync(dir + "/tokens.json"));
t.colour.blue["500"].$value = "#0066cc";
t.colour.blue["700"].$extensions = { "io.github.OWNER.ds-snapshot": { figmaName: "x", figmaType: "COLOR" } };
fs.writeFileSync(dir + "/tokens.json", JSON.stringify(t, null, 2) + "\n");
'
if node "$VALIDATE" .tmp/bad/ds-snapshots/2026-08-03 >/dev/null 2>&1; then
  echo "FAIL: validator accepted a broken snapshot"
  exit 1
fi
echo "  rejected as expected"

rm -rf .tmp
echo
echo "PASS: contract tests green"
