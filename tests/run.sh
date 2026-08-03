#!/usr/bin/env bash
# Contract tests. Run after any change to the contract, the schemas, or the validator.
#   0. SKILL.md frontmatter must be within the platform's upload limits
#   1. a known-good fixture must validate
#   2. a 1.0.0 snapshot must still validate, and so must a 1.1.0 one with the
#      optional dependency layer skipped
#   3. each class of real breakage must be rejected
#   4. building the dependency layer from raw captures must reproduce the fixture
#   5. the ds-graph adapter must produce a graph the viewer can read
set -euo pipefail
cd "$(dirname "$0")"
VALIDATE="$PWD/../skills/ds-snapshot/scripts/validate-snapshot.mjs"
TO_GRAPH="$PWD/../skills/ds-snapshot/scripts/to-ds-graph.mjs"
BUILD_DEPS="$PWD/../skills/ds-snapshot/scripts/build-dependencies.mjs"
MUTATE="$PWD/mutate.mjs"
SNAP="ds-snapshots/2026-08-03"
rm -rf .tmp

echo "0/5 SKILL.md frontmatter must be within the platform's limits"
# Uploading a skill fails outright when description is over 1024 characters, and the
# error only shows up at upload time. Catch it here instead.
node -e '
const fs = require("fs");
let bad = 0;
for (const skill of fs.readdirSync("../skills")) {
  const path = `../skills/${skill}/SKILL.md`;
  if (!fs.existsSync(path)) continue;
  const fm = fs.readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
  if (!fm) { console.log(`  FAIL: ${skill} has no frontmatter`); bad++; continue; }
  const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const desc = fm[1].match(/^description:\s*([\s\S]*?)(?=\n[a-z-]+:|$)/m)?.[1]?.trim() ?? "";
  if (name !== skill) { console.log(`  FAIL: ${skill} declares name "${name}"`); bad++; }
  if (!desc) { console.log(`  FAIL: ${skill} has no description`); bad++; }
  else if (desc.length > 1024) { console.log(`  FAIL: ${skill} description is ${desc.length} chars, the limit is 1024`); bad++; }
  else console.log(`  ${skill}: description ${desc.length}/1024 chars`);
}
if (bad) process.exit(1);
'

echo
echo "1/5 known-good fixture must pass"
node build-fixture.mjs ".tmp/good/$SNAP" >/dev/null
node "$VALIDATE" ".tmp/good/$SNAP" | tail -2 | sed 's/^/  /'

# Every case starts from a fresh copy of the good fixture and changes one thing, so
# a result here means the validator judged that change and nothing else.
# reset [files-to-delete...]
reset() {
  rm -rf .tmp/case
  cp -r .tmp/good .tmp/case
  for f in "$@"; do rm ".tmp/case/$SNAP/$f"; done
}
edit() { node "$MUTATE" ".tmp/case/$SNAP/$1" "$2"; }
accept() {
  if ! node "$VALIDATE" ".tmp/case/$SNAP" >/dev/null 2>&1; then
    echo "  FAIL: rejected a valid snapshot: $1"
    node "$VALIDATE" ".tmp/case/$SNAP" || true
    exit 1
  fi
  echo "  accepted: $1"
}
reject() {
  if node "$VALIDATE" ".tmp/case/$SNAP" >/dev/null 2>&1; then
    echo "  FAIL: accepted a snapshot with $1"
    exit 1
  fi
  echo "  rejected: $1"
}

echo
echo "2/5 older and dependency-free snapshots must still pass"

# A 1.0.0 snapshot predates the dependency layer. Its schemaVersion is what keeps it
# readable, so the 1.1.0-only checks must not fire on it.
reset dependencies.json
edit manifest.json 'd.schemaVersion="1.0.0"; d.generator.skillVersion="1.0.0"; delete d.dependencies; d.files=d.files.filter(f=>f.kind!=="dependencies")'
edit components.json 'd.schemaVersion="1.0.0"; for (const c of d.components) delete c.source'
accept "a 1.0.0 snapshot with no dependency layer"

# The user said no to dependencies. The keys stay present, the counts are zero, and
# dependencies.json is absent.
reset dependencies.json
edit manifest.json 'd.dependencies={captured:false,sources:[],counts:{bindings:0,aliases:0,nests:0,nestsUncaptured:0,typographyLinks:0,unresolvedBindings:0}}; d.files=d.files.filter(f=>f.kind!=="dependencies")'
accept "a 1.1.0 snapshot with the dependency layer skipped"

echo
echo "3/5 each class of breakage must be rejected"

# The original cases: a colour written as hex, plus an extension namespace that is
# both stray and an unsubstituted placeholder.
reset
edit tokens.json 'd.colour.blue["500"].$value="#0066cc"; d.colour.blue["700"].$extensions={"io.github.OWNER.ds-snapshot":{figmaName:"x",figmaType:"COLOR"}}'
reject "a broken value and a placeholder namespace"

reset
edit manifest.json 'd.dependencies.captured=false; d.dependencies.sources=[]; for (const k of Object.keys(d.dependencies.counts)) d.dependencies.counts[k]=0'
reject "a dependency file present when captured is false"

reset
edit dependencies.json 'd.components[0].bindings[0].token="colour.does.not.exist"'
reject "a binding to a token that is not in tokens.json"

reset
edit dependencies.json 'd.components[1].nests[0].id="actions/ghost"'
reject "a nested component that is not in components.json"

reset
edit dependencies.json 'd.components[0].id="actions/not-a-component"'
reject "an entry for a component that is not in the inventory"

reset
edit dependencies.json 'd.components[0].typography=["body.nope"]'
reject "a typography link that is not in typography.json"

# dependencies.aliases must agree with the references already in the mode files,
# in both directions.
reset
edit dependencies.json 'd.aliases[1].to="colour.blue.700"'
reject "an alias that disagrees with the per-mode token file"

reset
edit dependencies.json 'd.aliases=d.aliases.slice(0,1)'
reject "an alias the mode files hold but dependencies.json omits"

reset
edit dependencies.json 'd.aliases[0].mode="Twilight"'
reject "an alias in a mode no collection declares"

reset
edit manifest.json 'd.dependencies.counts.bindings=99'
reject "a manifest dependency count that does not match the data"

reset
edit dependencies.json 'const c=d.components[0]; c.bindings=[]; c.typography=[]; c.nests=[]; c.nestsUncaptured=[]; c.unresolvedBindings=[]'
reject "a component entry with no links at all"

reset
edit dependencies.json 'delete d.components[0].nestsUncaptured'
reject "a missing link array"

reset
edit dependencies.json 'd.components[0].bindings.reverse()'
reject "unsorted bindings"

reset
edit dependencies.json 'd.components[1].bindings.push({token:"layout.gutter",properties:["paddingTop"]})'
reject "a duplicate bound token"

reset
edit dependencies.json 'd.components[0].bindings[0].properties=["paddingTop","fills"]'
reject "unsorted properties within a binding"

reset
edit components.json 'delete d.components[0].source'
reject "a component with no source in a 1.1.0 snapshot"

reset
edit manifest.json 'd.dependencies.sources[0].componentsWalked=500'
reject "more components walked than the inventory holds"

echo
echo "4/5 raw captures must build the same dependencies.json by hand or by script"
# Proves the mapping rules in references/dependency-capture.md and the script agree,
# and that a bridge envelope, an unwrapped result, and two source files all work.
reset dependencies.json
node "$BUILD_DEPS" ".tmp/case/$SNAP" .tmp/good/ds-snapshots/captures/*.json >/dev/null
node -e '
const fs = require("fs");
const a = fs.readFileSync(".tmp/case/ds-snapshots/2026-08-03/dependencies.json", "utf8");
const b = fs.readFileSync(".tmp/good/ds-snapshots/2026-08-03/dependencies.json", "utf8");
if (a !== b) {
  console.log("  FAIL: the script did not reproduce the hand-written dependencies.json");
  process.exit(1);
}
console.log("  script output is byte-identical to the hand-written fixture");
'
accept "a dependency layer built from raw captures by script"

echo
echo "5/5 the ds-graph adapter must produce a readable graph"
node "$TO_GRAPH" ".tmp/good/$SNAP" ".tmp/graph.json" >/dev/null
node -e '
const g = require("./.tmp/graph.json");
const ids = new Set(g.nodes.map(n => n.id));
const dangling = g.edges.filter(e => !ids.has(e.from) || !ids.has(e.to));
if (dangling.length) { console.log("  FAIL: " + dangling.length + " dangling links"); process.exit(1); }
for (const k of ["component", "token", "primitive", "textStyle"]) {
  if (!g.nodes.some(n => n.kind === k)) { console.log("  FAIL: no " + k + " nodes"); process.exit(1); }
}
for (const t of ["BINDS", "ALIASES", "NESTS", "USES_TEXT_STYLE"]) {
  if (!g.edges.some(e => e.type === t)) { console.log("  FAIL: no " + t + " links"); process.exit(1); }
}
if (!g.nodes.some(n => n.external)) { console.log("  FAIL: uncaptured nesting did not become an external node"); process.exit(1); }
if (!g.nodes.some(n => n.unresolved)) { console.log("  FAIL: an unresolved binding did not become an unresolved node"); process.exit(1); }
console.log("  " + g.nodes.length + " nodes, " + g.edges.length + " links, all four node kinds and all four link types, nothing dangling");
'
# The layer is what makes a graph possible, so without it the adapter must refuse
# rather than emit an empty one.
reset dependencies.json
if node "$TO_GRAPH" ".tmp/case/$SNAP" ".tmp/nope.json" >/dev/null 2>&1; then
  echo "  FAIL: the adapter produced a graph from a snapshot with no dependency layer"
  exit 1
fi
echo "  refused a snapshot with no dependency layer"

rm -rf .tmp
echo
echo "PASS: contract tests green"
