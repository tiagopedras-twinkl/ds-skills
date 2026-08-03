#!/usr/bin/env node
// Converts a validated snapshot into the graph.json the ds-graph viewer and its
// impact queries read. Needs the dependency layer; without it there are no links
// to draw.
//
// Usage: node to-ds-graph.mjs <snapshot-dir> [out.json]
//        default out: <snapshot-dir>/graph.json is NOT used — the contract has no
//        such file, so the default writes to ./graph.json instead.
//
// Validate the snapshot first. This script trusts it and does no checking of its
// own beyond what it needs to fail clearly.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error("usage: node to-ds-graph.mjs <snapshot-dir> [out.json]");
  process.exit(1);
}
const out = outArg ?? "graph.json";

const read = (rel) => {
  const abs = join(src, rel);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, "utf8"));
};

const manifest = read("manifest.json");
if (!manifest) {
  console.error(`no manifest.json in ${src}; is that a snapshot folder?`);
  process.exit(1);
}
const deps = read("dependencies.json");
if (!deps) {
  console.error(
    `${src} has no dependency layer, so there are no links to draw.\n` +
      `Re-run ds-snapshot and answer yes when it asks whether you want dependencies.`
  );
  process.exit(1);
}

const tokens = read("tokens.json") ?? {};
const typography = read("typography.json") ?? {};
const inventory = read("components.json")?.components ?? [];

// Walk a DTCG document into path -> { type, value }. A token is any object with $value.
function collect(node, path = [], inherited, out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$") || typeof value !== "object" || value === null) continue;
    const type = value.$type ?? inherited;
    if ("$value" in value) out.set([...path, key].join("."), { type, value: value.$value, node: value });
    else collect(value, [...path, key], type, out);
  }
  return out;
}
const tokenDocs = collect(tokens);
const typographyDocs = collect(typography);

const nodes = new Map();
const edges = [];
const addNode = (id, data) => {
  if (!nodes.has(id)) nodes.set(id, { id, ...data });
};

// The snapshot has no Primitives/token split of its own — a token that aliases
// nothing and is aliased by something is the raw-value layer. Deriving it this way
// keeps the viewer's two colours meaningful without inventing a naming convention.
const aliasSources = new Set(deps.aliases.map((a) => a.from));
const aliasTargets = new Set(deps.aliases.map((a) => a.to));

for (const [path, t] of tokenDocs) {
  const isPrimitive = aliasTargets.has(path) && !aliasSources.has(path);
  addNode(path, {
    kind: isPrimitive ? "primitive" : "token",
    name: path.split(".").pop(),
    collection: path.split(".")[0],
    valueType: t.type ?? "",
    value: t.value,
  });
}
for (const [path, t] of typographyDocs) {
  addNode(`TextStyle/${path}`, {
    kind: "textStyle",
    name: path,
    fontSize: t.value?.fontSize?.value,
    family: t.value?.fontFamily,
    fontWeight: t.value?.fontWeight,
    lineHeight: t.value?.lineHeight,
  });
}

const figmaUrl = (c) => {
  const key = manifest.source?.figmaFileKey;
  if (!key || !c.figma?.nodeId) return undefined;
  const slug = encodeURIComponent(manifest.source.figmaFileName ?? "");
  // Figma's own links use - in place of : in the node-id query param.
  return `https://www.figma.com/design/${key}/${slug}?node-id=${c.figma.nodeId.replace(":", "-")}`;
};

for (const c of inventory) {
  addNode(`Component/${c.id}`, {
    kind: "component",
    name: c.name,
    page: c.source ?? "",
    figmaType: c.kind === "componentSet" ? "COMPONENT_SET" : "COMPONENT",
    figmaUrl: figmaUrl(c),
    variants: c.variants,
    variantCount: c.variantCombinations,
    deprecated: c.deprecated,
  });
}

for (const a of deps.aliases) edges.push({ from: a.from, to: a.to, type: "ALIASES", mode: a.mode });

for (const c of deps.components) {
  const from = `Component/${c.id}`;
  for (const b of c.bindings) edges.push({ from, to: b.token, type: "BINDS", props: b.properties });
  for (const t of c.typography) edges.push({ from, to: `TextStyle/${t}`, type: "USES_TEXT_STYLE" });
  for (const n of c.nests) edges.push({ from, to: `Component/${n.id}`, type: "NESTS", count: n.count });
  // A component that was never walked still gets a node, marked external, so the
  // viewer can dim it and the dependency stays visible.
  for (const n of c.nestsUncaptured) {
    const id = `Component/${n.name}`;
    addNode(id, { kind: "component", name: n.name, external: true });
    edges.push({ from, to: id, type: "NESTS", count: n.count });
  }
  for (const u of c.unresolvedBindings) {
    addNode(u.figmaName, { kind: "token", name: u.figmaName, unresolved: true });
    edges.push({ from, to: u.figmaName, type: "BINDS", props: u.properties });
  }
}

const missing = edges.filter((e) => !nodes.has(e.from) || !nodes.has(e.to));
if (missing.length) {
  console.error(
    `${missing.length} links point at something the snapshot does not name, e.g. ${missing[0].from} -> ${missing[0].to}.\n` +
      `Run validate-snapshot.mjs on ${src} — it reports exactly which.`
  );
  process.exit(1);
}

const graph = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: `Figma — ${manifest.source?.figmaFileName ?? "snapshot"}`,
    snapshot: manifest.exportedAt,
    componentCount: inventory.length,
    variableCount: tokenDocs.size,
    textStyleCount: typographyDocs.size,
  },
  nodes: [...nodes.values()],
  edges,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(graph, null, 1) + "\n");

const byKind = {};
for (const n of graph.nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
const byType = {};
for (const e of graph.edges) byType[e.type] = (byType[e.type] ?? 0) + 1;
console.log("nodes:", byKind);
console.log("edges:", byType);
console.log(`written: ${out}`);
console.log(`\nCopy it into the ds-graph repo to view it:\n  cp ${out} path/to/ds-graph/viewer/src/graph.json`);
