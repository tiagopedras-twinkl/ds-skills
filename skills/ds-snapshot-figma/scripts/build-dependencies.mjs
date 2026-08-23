#!/usr/bin/env node
// Turns raw dependency captures into dependencies.json, and fills in the manifest's
// dependency block.
//
// Usage: node build-dependencies.mjs <snapshot-dir> <capture-file...>
//
// Each capture file is what one figma_execute step returned, or the file the bridge
// auto-saved when the result was over ~50KB. Pass them in any order and any number:
// the shape of each payload says which step it came from. Bridge envelopes are
// unwrapped automatically.
//
// The mapping from Figma names to snapshot ids is not guessed. Every token in
// tokens.json records its original figmaName and figmaCollection in $extensions,
// every typography token records its figmaStyleId, and components.json records each
// component's name and path — so the snapshot describes its own mapping. That is what
// the extension namespace is for, and it is why this conversion is reproducible rather
// than a re-derivation of the sanitising rules.
//
// A capture labels a variable "<collection>/<name>", and both halves may contain "/"
// of their own — collections called "Primitives/Spacing" are ordinary. So the label is
// never split. It is rebuilt from the two extension fields and matched whole.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [snapshotDir, ...captureFiles] = process.argv.slice(2);
if (!snapshotDir || captureFiles.length === 0) {
  console.error("usage: node build-dependencies.mjs <snapshot-dir> <capture-file...>");
  process.exit(1);
}

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const readSnapshot = (rel, required = true) => {
  const abs = join(snapshotDir, rel);
  if (!existsSync(abs)) {
    if (required) fail(`${abs} is missing; run the inventory steps before the dependency layer`);
    return null;
  }
  return JSON.parse(readFileSync(abs, "utf8"));
};

const tokens = readSnapshot("tokens.json");
const typography = readSnapshot("typography.json");
const inventory = readSnapshot("components.json");
const manifest = readSnapshot("manifest.json", false);

// ------------------------------------------------- indexes, built from the snapshot

// Walk a DTCG document, handing back each token's path and its $extensions payload.
function* walk(node, path = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$") || typeof value !== "object" || value === null) continue;
    if ("$value" in value) yield [[...path, key].join("."), value.$extensions ?? {}];
    else yield* walk(value, [...path, key]);
  }
}
const nsPayload = (extensions) => {
  const ns = Object.keys(extensions).find((k) => k.endsWith(".ds-snapshot"));
  return ns ? extensions[ns] ?? {} : {};
};

// Capture label "<collection>/<name>" -> token path. Rebuilt from the snapshot's own
// extensions, so it is the same string the capture produced, character for character.
const tokenByLabel = new Map();
let sawFigmaName = false;
for (const [path, ext] of walk(tokens)) {
  const { figmaName, figmaCollection } = nsPayload(ext);
  if (!figmaName) continue;
  sawFigmaName = true;
  if (!figmaCollection) continue;
  tokenByLabel.set(`${figmaCollection}/${figmaName}`, path);
}
if (!sawFigmaName) {
  fail("no token in tokens.json carries a figmaName extension, so the capture cannot be mapped onto it");
}
if (!tokenByLabel.size) {
  fail(
    "no token in tokens.json carries a figmaCollection extension.\n" +
      "That arrived with contract 2.0.0, and without it a capture label cannot be matched onto a token:\n" +
      "both a collection name and a variable name may contain '/', so the label cannot be split apart.\n" +
      "Re-run the inventory steps of ds-snapshot-figma to produce a 2.0.0 snapshot, then build the layer against that."
  );
}

// A text style's id differs by which file reports it: the owning file gives "S:<key>,"
// and a using file gives "S:<key>,<localNodeId>". Only <key> is shared, so both sides of
// every comparison are cut back to "S:<key>". Done here as well as in the capture so a
// capture holding raw ids still maps — without it every lookup misses and the layer comes
// out with no typography links and no error.
const styleKey = (id) => String(id).split(",")[0];

// Figma style key -> typography path.
const typographyByStyleId = new Map();
for (const [path, ext] of walk(typography)) {
  const id = nsPayload(ext).figmaStyleId;
  if (id) typographyByStyleId.set(styleKey(id), path);
}

// Full Figma component name -> inventory id.
const componentByFigmaName = new Map();
for (const c of inventory.components ?? []) {
  componentByFigmaName.set([...(c.path ?? []), c.name].join("/"), c.id);
}

// ------------------------------------------------------------ read the captures

// The bridge's envelope shape is its own and has changed before, so look for the
// payload rather than assuming a path to it.
function unwrap(doc, depth = 0) {
  if (Array.isArray(doc)) return doc;
  if (doc === null || typeof doc !== "object" || depth > 6) return null;
  if ("components" in doc && Array.isArray(doc.components)) return doc;
  if ("aliases" in doc && Array.isArray(doc.aliases)) return doc;
  for (const key of ["result", "data", "payload", "value", "output"]) {
    if (key in doc) {
      const hit = unwrap(doc[key], depth + 1);
      if (hit) return hit;
    }
  }
  for (const v of Object.values(doc)) {
    const hit = unwrap(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

const walked = [];          // { fileName, components: [...] }
const capturedAliases = []; // { from, to, mode }
const styleNames = new Map(); // style key -> Figma style name

for (const file of captureFiles) {
  if (!existsSync(file)) fail(`capture file not found: ${file}`);
  const payload = unwrap(JSON.parse(readFileSync(file, "utf8")));
  if (!payload) fail(`could not find a capture payload in ${file}`);

  if (Array.isArray(payload)) {
    // Step 4: resolved text style ids.
    if (payload.every((s) => s && typeof s.id === "string" && typeof s.name === "string")) {
      for (const s of payload) styleNames.set(styleKey(s.id), s.name);
      continue;
    }
    // A bare step 2 array, without its wrapper.
    if (payload.every((c) => c && Array.isArray(c.bindings))) {
      walked.push({ fileName: "(unnamed file)", components: payload });
      continue;
    }
    fail(`${file} holds an array this script does not recognise as a capture step`);
  }
  if (Array.isArray(payload.aliases)) {
    capturedAliases.push(...payload.aliases);
    continue;
  }
  if (Array.isArray(payload.components)) {
    walked.push({ fileName: payload.fileName ?? "(unnamed file)", components: payload.components });
    continue;
  }
  fail(`${file} does not look like the result of any dependency capture step`);
}

if (!walked.length) fail("no component walk in the files given; capture step 2 produces it");

// ----------------------------------------------------------------- map and build

const notes = [];
const out = new Map(); // component id -> entry
const byLower = (pick) => (a, b) => {
  const x = String(pick(a)).toLowerCase();
  const y = String(pick(b)).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
let skippedNoLinks = 0;
for (const source of walked) {
  for (const c of source.components) {
    const id = componentByFigmaName.get(c.figmaName);
    if (!id) {
      notes.push({ kind: "component", name: c.figmaName, reason: "walked for dependencies but absent from components.json" });
      continue;
    }

    const bindings = new Map();          // token path -> Set of properties
    const unresolvedBindings = new Map(); // figma name -> Set of properties
    for (const [rawLabel, props] of c.bindings ?? []) {
      const path = tokenByLabel.get(rawLabel);
      const target = path ? bindings : unresolvedBindings;
      const key = path ?? rawLabel;
      if (!target.has(key)) target.set(key, new Set());
      for (const p of props) target.get(key).add(p);
    }

    const typographyPaths = new Set();
    for (const rawStyleId of c.textStyles ?? []) {
      const styleId = styleKey(rawStyleId);
      const path = typographyByStyleId.get(styleId);
      if (path) typographyPaths.add(path);
      else {
        notes.push({
          kind: "textStyle",
          name: styleNames.get(styleId) ?? styleId,
          reason: "used by a component but absent from typography.json",
        });
      }
    }

    const nests = [];
    const nestsUncaptured = [];
    for (const [childName, count] of Object.entries(c.instances ?? {})) {
      const childId = componentByFigmaName.get(childName);
      if (childId && childId !== id) nests.push({ id: childId, count });
      else if (!childId) nestsUncaptured.push({ name: childName, count });
    }

    const entry = {
      id,
      bindings: [...bindings]
        .map(([token, props]) => ({ token, properties: [...props].sort() }))
        .sort(byLower((b) => b.token)),
      typography: [...typographyPaths].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)),
      nests: nests.sort(byLower((n) => n.id)),
      nestsUncaptured: nestsUncaptured.sort(byLower((n) => n.name)),
      unresolvedBindings: [...unresolvedBindings]
        .map(([figmaName, props]) => ({ figmaName, properties: [...props].sort() }))
        .sort(byLower((u) => u.figmaName)),
    };

    const linkCount =
      entry.bindings.length + entry.typography.length + entry.nests.length +
      entry.nestsUncaptured.length + entry.unresolvedBindings.length;
    // A component with no dependencies at all is left out; components.json already lists it.
    if (linkCount === 0) {
      skippedNoLinks++;
      continue;
    }
    if (out.has(id)) fail(`${c.figmaName} maps to component id ${id}, which another walked component already claimed`);
    out.set(id, entry);
  }
}

const aliases = [];
const seenAliases = new Set();
for (const a of capturedAliases) {
  const from = tokenByLabel.get(a.from);
  const to = tokenByLabel.get(a.to);
  if (!from || !to) {
    notes.push({
      kind: "variable",
      name: `${a.from} -> ${a.to}`,
      reason: "alias whose ends are not both in tokens.json",
    });
    continue;
  }
  // Since 2.0.0 a path carries its collection, so two ends can only be equal when a
  // variable really does point at itself. Before that they collapsed here silently,
  // which is how a cross-collection alias went missing without leaving a trace.
  if (from === to) {
    notes.push({ kind: "alias", name: `${from} -> ${to}`, reason: "circular alias chain" });
    continue;
  }
  const key = `${from} ${a.mode}`;
  if (seenAliases.has(key)) continue;
  seenAliases.add(key);
  aliases.push({ from, to, mode: a.mode });
}
aliases.sort(byLower((a) => `${a.from} ${a.mode}`));

const dependencies = {
  schemaVersion: manifest?.schemaVersion ?? "2.0.0",
  aliases,
  components: [...out.values()].sort(byLower((c) => c.id)),
};
writeSnapshot("dependencies.json", dependencies);

// ------------------------------------------------------- manifest dependency block

const counts = {
  bindings: dependencies.components.reduce((n, c) => n + c.bindings.length, 0),
  aliases: aliases.length,
  nests: dependencies.components.reduce((n, c) => n + c.nests.length, 0),
  nestsUncaptured: dependencies.components.reduce((n, c) => n + c.nestsUncaptured.length, 0),
  typographyLinks: dependencies.components.reduce((n, c) => n + c.typography.length, 0),
  unresolvedBindings: dependencies.components.reduce((n, c) => n + c.unresolvedBindings.length, 0),
};
const sources = walked
  .map((s) => ({ figmaFileName: s.fileName, figmaFileKey: "", componentsWalked: s.components.length }))
  .sort(byLower((s) => s.figmaFileName));

if (manifest) {
  manifest.dependencies = { captured: true, sources, counts };
  if (!manifest.files.some((f) => f.kind === "dependencies")) {
    manifest.files.push({ path: "dependencies.json", kind: "dependencies" });
    manifest.files.sort(byLower((f) => f.path));
  }
  writeSnapshot("manifest.json", manifest);
  console.log("updated manifest.json dependency block");
} else {
  console.log("\nno manifest.json yet — put this in it when you write it:");
  console.log(JSON.stringify({ dependencies: { captured: true, sources, counts } }, null, 2));
}

function writeSnapshot(rel, value) {
  writeFileSync(join(snapshotDir, rel), JSON.stringify(value, null, 2) + "\n");
}

// ----------------------------------------------------------------------- report

console.log(`\nwrote dependencies.json: ${dependencies.components.length} components with links`);
console.log(
  `  ${counts.bindings} bindings, ${counts.aliases} aliases, ${counts.nests} nested, ` +
    `${counts.typographyLinks} typography`
);
if (skippedNoLinks) console.log(`  ${skippedNoLinks} walked components had no links and were left out`);
if (counts.unresolvedBindings) console.log(`  ${counts.unresolvedBindings} bindings to variables this snapshot does not hold`);
if (counts.nestsUncaptured) console.log(`  ${counts.nestsUncaptured} nested components were never walked`);

if (notes.length) {
  // Deduplicate: one systemic cause should not produce hundreds of identical notes.
  const unique = [...new Map(notes.map((n) => [`${n.kind} ${n.name} ${n.reason}`, n])).values()];
  console.log(`\n${unique.length} item(s) for manifest.notes.unmapped — add them, they are the gaps worth seeing:`);
  console.log(JSON.stringify(unique, null, 2));
}
console.log(`\nNow validate: node validate-snapshot.mjs ${snapshotDir}`);
