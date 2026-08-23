#!/usr/bin/env bash
# Contract tests. Run after any change to the contract, the schemas, or the validator.
#   0. SKILL.md frontmatter must be within the platform's upload limits
#   1. a known-good fixture must validate
#   2. a 1.0.0 snapshot must still validate, and so must a 1.1.0 one with the
#      optional dependency layer skipped; and two collections holding the same
#      variable name must both survive, which is what contract 2.0.0 exists for
#   3. each class of real breakage must be rejected
#   4. building the dependency layer from raw captures must reproduce the fixture
#   5. the ds-graph adapter must produce a graph the viewer can read
#   6. the single-file bundle must round-trip a snapshot byte for byte
#   7. any .skill bundle in dist/ must match the skill folder it was built from
set -euo pipefail
cd "$(dirname "$0")"
VALIDATE="$PWD/../skills/ds-snapshot-figma/scripts/validate-snapshot.mjs"
TO_GRAPH="$PWD/../skills/ds-snapshot-figma/scripts/to-ds-graph.mjs"
TO_BUNDLE="$PWD/../skills/ds-snapshot-figma/scripts/to-bundle.mjs"
FROM_BUNDLE="$PWD/../skills/ds-snapshot-figma/scripts/from-bundle.mjs"
BUILD_DEPS="$PWD/../skills/ds-snapshot-figma/scripts/build-dependencies.mjs"
MUTATE="$PWD/mutate.mjs"
SNAP="ds-snapshots/2026-08-03"
rm -rf .tmp

echo "0/7 SKILL.md frontmatter must be within the platform's limits"
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
echo "1/7 known-good fixture must pass"
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
# Rejecting is not enough when the point of a case is which diagnosis it draws: a
# self-reference reported as a circular chain sends anyone debugging it the wrong way.
# The validator exits non-zero on a rejection, so its output goes to a file rather
# than through a pipe, which pipefail would otherwise read as a failure of the grep.
says() {
  node "$VALIDATE" ".tmp/case/$SNAP" >.tmp/said.txt 2>&1 || true
  if ! grep -q "$1" .tmp/said.txt; then
    echo "  FAIL: expected the report to say \"$1\""
    cat .tmp/said.txt
    exit 1
  fi
  echo "  said so in as many words: $2"
}

echo
echo "2/7 older and dependency-free snapshots must still pass"

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
echo "2b/6 two collections holding the same variable name must both survive"
# The whole reason for contract 2.0.0. Figma only makes a variable name unique within
# its collection, so a snapshot that cannot hold both is losing real data silently.
node -e '
const t = require("./.tmp/good/ds-snapshots/2026-08-03/tokens.json");
const p = t.Primitives?.space?.md, s = t.Semantic?.space?.md;
if (!p || !s) { console.log("  FAIL: tokens.json does not hold both collections space/md"); process.exit(1); }
if (s.$value !== "{Primitives.space.md}") { console.log("  FAIL: the cross-collection alias did not survive"); process.exit(1); }
if (!t.Primitives?.Spacing?.gutter) { console.log("  FAIL: a collection whose name contains / did not become nested groups"); process.exit(1); }
const d = require("./.tmp/good/ds-snapshots/2026-08-03/dependencies.json");
if (!d.aliases.some(a => a.from === "Semantic.space.md" && a.to === "Primitives.space.md")) {
  console.log("  FAIL: the dependency layer dropped the cross-collection alias"); process.exit(1);
}
console.log("  both space/md tokens present, the alias between them recorded, Primitives/Spacing nested");
'

echo
echo "3/7 each class of breakage must be rejected"

# Contract 2.0.0: a token path is its collection followed by its name, which is what
# makes the path a complete identity. Each way of breaking that is its own case.
reset
edit tokens.json 'd.space = d.Primitives.space; delete d.Primitives.space'
reject "a 2.0.0 token whose path does not start with its collection"

reset
edit tokens.json 'delete d.Primitives.space.md.$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaCollection'
reject "a 2.0.0 token with no figmaCollection in its extensions"

reset
edit tokens/primitives.value.json 'd.Primitives.space.sm.$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaCollection="Semantic"'
reject "a per-mode file holding a token from another collection"

# figmaVariableId is what lets two snapshots of one file be compared through a rename,
# so it is always present, always Figma's own id, and never shared by two tokens.
reset
edit tokens.json 'delete d.Primitives.space.md.$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaVariableId'
reject "a 2.0.0 token with no figmaVariableId in its extensions"

reset
edit tokens.json 'd.Semantic.space.md.$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaVariableId="VariableID:1:3"'
reject "two tokens claiming the same Figma variable id"
says "has been written twice" "one Figma variable written twice, not two variables"

# The transport may genuinely have no ids to give. That is a gap worth stating, not a
# reason to fail the export, and the key stays present as an empty string either way.
reset
edit tokens.json 'const N="io.github.tiagopedras-twinkl.ds-snapshot"; const w=o=>{for(const v of Object.values(o)){if(v&&typeof v==="object"){if(v.$extensions?.[N])v.$extensions[N].figmaVariableId="";else w(v)}}}; w(d)'
accept "a snapshot whose transport supplied no variable ids"
says "cannot be compared to another by variable" "which comparison the empty ids cost"

# A token pointing at its own path. Before 2.0.0 this was also what a cross-collection
# alias looked like; now it can only be a real cycle, and the message says so.
reset
edit tokens.json 'd.Semantic.space.md.$value="{Semantic.space.md}"'
reject "a token that aliases its own path"
says "aliases itself" "a self-reference, not a circular chain"

reset
edit manifest.json 'd.notes.unmapped[0].kind="component"'
reject "an unmapped reason recorded against the wrong kind"

reset
edit manifest.json 'd.notes.unmapped[0].reason="made this one up on the day"'
accept "an unmapped reason outside the contract's table"
says "not one of the strings fixed in output-contract.md" "warned, so the improvisation is visible and the note is not dropped"

# The original cases: a colour written as hex, plus an extension namespace that is
# both stray and an unsubstituted placeholder.
reset
edit tokens.json 'const b=d.Primitives.colour.blue; b["500"].$value="#0066cc"; b["700"].$extensions={"io.github.OWNER.ds-snapshot":{figmaCollection:"Primitives",figmaName:"colour/blue/700",figmaType:"COLOR"}}'
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
echo "4/7 raw captures must build the same dependencies.json by hand or by script"
# Proves the mapping rules in references/dependency-capture.md and the script agree,
# and that a bridge envelope, an unwrapped result, two source files, and text style ids
# in either raw Figma form all work.
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
echo "5/7 the ds-graph adapter must produce a readable graph"
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

echo
echo "6/7 the single-file bundle must round-trip a snapshot byte for byte"
# The bundle is only worth having if it is interchangeable with the folder, so the
# test is equality of every file plus a clean validation of the unpacked copy.
node "$TO_BUNDLE" ".tmp/good/$SNAP" ".tmp/bundle.json" >/dev/null
node -e '
const fs = require("fs");
const b = JSON.parse(fs.readFileSync(".tmp/bundle.json", "utf8"));
const src = ".tmp/good/ds-snapshots/2026-08-03";
const listed = ["manifest.json", ...b.files["manifest.json"].files.map(f => f.path)].sort();
const packed = Object.keys(b.files).sort();
if (listed.join() !== packed.join()) {
  console.log("  FAIL: bundle holds " + packed.join(", ") + ", manifest lists " + listed.join(", "));
  process.exit(1);
}
// Each part keeps its own format: the token documents are still valid DTCG on their own.
for (const p of ["tokens.json", "typography.json"]) {
  if (!b.files[p].$schema?.includes("designtokens.org")) {
    console.log("  FAIL: " + p + " lost its $schema inside the bundle");
    process.exit(1);
  }
}
console.log("  " + packed.length + " files packed, token documents still standalone DTCG");
'
node "$FROM_BUNDLE" ".tmp/bundle.json" ".tmp/unpacked" >/dev/null
diff -r ".tmp/good/$SNAP" ".tmp/unpacked" >/dev/null || {
  echo "  FAIL: the unpacked snapshot differs from the original"
  diff -r ".tmp/good/$SNAP" ".tmp/unpacked" || true
  exit 1
}
echo "  unpacked copy is byte-identical to the original folder"
node "$VALIDATE" ".tmp/unpacked" >/dev/null 2>&1 || {
  echo "  FAIL: the unpacked snapshot does not validate"
  node "$VALIDATE" ".tmp/unpacked" || true
  exit 1
}
echo "  unpacked copy validates against the contract"

# A folder that does not match its own manifest must not bundle: a bundle that looks
# whole but is not is worse than no bundle.
reset dependencies.json
if node "$TO_BUNDLE" ".tmp/case/$SNAP" ".tmp/nope.json" >/dev/null 2>&1; then
  echo "  FAIL: bundled a folder missing a file its manifest lists"
  exit 1
fi
echo "  refused a folder missing a file its manifest lists"

# Unpacking must never write outside the folder the user named, and must never
# silently overwrite one that already has something in it.
node -e '
const fs = require("fs");
fs.writeFileSync(".tmp/evil.json", JSON.stringify({
  bundleVersion: "1.0.0",
  files: { "manifest.json": {}, "../escaped.json": {} },
}));
'
if node "$FROM_BUNDLE" ".tmp/evil.json" ".tmp/evil-out" >/dev/null 2>&1; then
  echo "  FAIL: unpacked a bundle containing a path outside the target folder"
  exit 1
fi
echo "  refused a bundle with a path outside the target folder"
if node "$FROM_BUNDLE" ".tmp/bundle.json" ".tmp/good/$SNAP" >/dev/null 2>&1; then
  echo "  FAIL: unpacked over a folder that already had files in it"
  exit 1
fi
echo "  refused to unpack over a non-empty folder"

echo
echo "7/7 dist bundles must match the skills they were built from"
# A .skill is a zip built by hand, so it goes stale silently: a skill gains a
# script, nobody re-zips, and the gap only shows up on upload as a missing file.
# dist/ is gitignored and a fresh clone has none, so an absent bundle is not a
# failure — only one that exists and disagrees with its source.
if [ ! -d ../dist ]; then
  echo "  no dist/ — nothing built here yet, skipping"
else
  stale=0
  built=0
  for dir in ../skills/*/; do
    skill=$(basename "$dir")
    bundle="../dist/$skill.skill"
    [ -f "$bundle" ] || continue
    built=$((built + 1))
    # Compare the file list, then every file's contents. A matching list with
    # changed contents is the more likely drift of the two: SKILL.md gets edited
    # far more often than a script gets added.
    src=$(cd ../skills && find "$skill" -type f ! -name ".DS_Store" | sort)
    bun=$(unzip -Z1 "$bundle" | grep -v '/$' | sort)
    if [ "$src" != "$bun" ]; then
      echo "  FAIL: $skill.skill holds different files from skills/$skill"
      diff <(echo "$src") <(echo "$bun") | sed 's/^/    /' || true
      stale=$((stale + 1))
      continue
    fi
    rm -rf .tmp/dist-check
    mkdir -p .tmp/dist-check
    unzip -q "$bundle" -d .tmp/dist-check
    if diff -r -q --exclude=.DS_Store "../skills/$skill" ".tmp/dist-check/$skill" >/dev/null; then
      echo "  $skill.skill matches its source"
    else
      echo "  FAIL: $skill.skill was built from older sources"
      diff -r -q --exclude=.DS_Store "../skills/$skill" ".tmp/dist-check/$skill" | sed 's/^/    /' || true
      stale=$((stale + 1))
    fi
  done
  if [ "$built" -eq 0 ]; then
    echo "  dist/ holds no bundles yet, skipping"
  elif [ "$stale" -gt 0 ]; then
    echo "  rebuild with: cd skills && zip -rq -X ../dist/<skill>.skill <skill> -x '*.DS_Store'"
    exit 1
  fi
fi

rm -rf .tmp
echo
echo "PASS: contract tests green"
