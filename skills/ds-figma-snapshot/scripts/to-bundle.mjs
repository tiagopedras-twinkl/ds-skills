#!/usr/bin/env node
// Packs a validated snapshot folder into one JSON file that is easy to upload,
// attach, or hand to another tool.
//
// Usage: node to-bundle.mjs <snapshot-dir> [out.json]
//        default out: ./ds-snapshot-<folder-name>.bundle.json
//
// The bundle is a container, not a new format: each snapshot file's content is
// nested verbatim under its contract path, so bundle.files["tokens.json"] is
// still a standalone valid DTCG document and components.json is still exactly
// components.json. Nothing is merged, renamed, or flattened — that is what keeps
// one upload interchangeable with the folder.
//
// It is deliberately NOT written inside the snapshot folder: the contract lists
// every file a snapshot may contain, and a bundle is not one of them.
//
// Validate the snapshot first. This script checks only that the folder is whole
// and that packing it loses nothing; it does not re-check the contract.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename, resolve, posix } from "node:path";

const BUNDLE_VERSION = "1.0.0";

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error("usage: node to-bundle.mjs <snapshot-dir> [out.json]");
  process.exit(1);
}
if (!existsSync(src) || !statSync(src).isDirectory()) {
  console.error(`not a directory: ${src}`);
  process.exit(1);
}

const folder = basename(resolve(src));
const out = outArg ?? `ds-snapshot-${folder}.bundle.json`;
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// Every .json file actually present, as contract-relative posix paths.
function walk(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".json")) found.push(rel);
  }
  return found;
}

const manifestRaw = existsSync(join(src, "manifest.json"))
  ? readFileSync(join(src, "manifest.json"), "utf8")
  : fail(`no manifest.json in ${src}; is that a snapshot folder?`);

let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}

// manifest.files lists every file except the manifest itself. Comparing it against
// the directory in both directions is what stops a half-empty bundle looking whole.
const declared = new Set(["manifest.json", ...(manifest.files ?? []).map((f) => f.path)]);
const present = new Set(walk(src));
const missing = [...declared].filter((p) => !present.has(p));
const unlisted = [...present].filter((p) => !declared.has(p));
if (missing.length || unlisted.length) {
  const lines = [`${src} does not match its own manifest, so it cannot be bundled whole.`];
  for (const p of missing) lines.push(`  listed in manifest.files but not on disk: ${p}`);
  for (const p of unlisted) lines.push(`  on disk but not listed in manifest.files: ${p}`);
  lines.push(`Run validate-snapshot.mjs on ${src} — it reports exactly what is off.`);
  fail(lines.join("\n"));
}

const files = {};
for (const rel of [...declared].sort((a, b) =>
  a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0
)) {
  const raw = readFileSync(join(src, rel), "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`${rel} is not valid JSON: ${e.message}`);
  }
  // The contract already requires 2-space indent and one trailing newline, so this
  // holding means from-bundle.mjs restores the folder byte for byte.
  if (JSON.stringify(parsed, null, 2) + "\n" !== raw) {
    fail(
      `${rel} is not formatted to contract, so unpacking would not restore it byte for byte.\n` +
        `Run validate-snapshot.mjs on ${src} and fix the formatting first.`
    );
  }
  files[rel] = parsed;
}

const bundle = {
  bundleVersion: BUNDLE_VERSION,
  generator: { skill: "ds-snapshot", script: "to-bundle", bundleVersion: BUNDLE_VERSION },
  snapshot: {
    folder,
    schemaVersion: manifest.schemaVersion ?? "",
    exportedAt: manifest.exportedAt ?? "",
    dependenciesCaptured: manifest.dependencies?.captured ?? false,
  },
  files,
};

mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");

const bytes = statSync(out).size;
const size = bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`bundled ${Object.keys(files).length} files from ${src}`);
for (const rel of Object.keys(files)) console.log(`  ${rel}`);
console.log(`\nwritten: ${out} (${size})`);
if (!bundle.snapshot.dependenciesCaptured) {
  console.log("note: this snapshot has no dependency layer, so the bundle holds the inventory only.");
}
console.log(`\nUnpack it back to a folder any time:\n  node from-bundle.mjs ${out} <dir>`);
