#!/usr/bin/env node
// Unpacks a bundle written by to-bundle.mjs back into a snapshot folder, so the
// validator and every other consumer can treat a shared single file exactly like
// a snapshot that came straight out of Figma.
//
// Usage: node from-bundle.mjs <bundle.json> <out-dir>
//
// The round trip is byte-exact: to-bundle.mjs refuses to pack a folder whose
// formatting is off contract, so re-serialising here reproduces the originals.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) {
  console.error("usage: node from-bundle.mjs <bundle.json> <out-dir>");
  process.exit(1);
}
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!existsSync(src)) fail(`no such file: ${src}`);
let bundle;
try {
  bundle = JSON.parse(readFileSync(src, "utf8"));
} catch (e) {
  fail(`${src} is not valid JSON: ${e.message}`);
}

if (!bundle || typeof bundle !== "object" || !bundle.files) {
  fail(`${src} has no files object, so it is not a ds-snapshot bundle.`);
}
const major = Number((bundle.bundleVersion ?? "").split(".")[0]);
if (major !== 1) {
  fail(
    `${src} declares bundleVersion ${bundle.bundleVersion ?? "(none)"}; this script reads version 1 bundles.`
  );
}
if (!bundle.files["manifest.json"]) {
  fail(`${src} contains no manifest.json, so it is not a whole snapshot.`);
}

// A bundle is a file people email, upload and download. Never let a path in one
// write outside the folder the user named.
for (const rel of Object.keys(bundle.files)) {
  if (rel.startsWith("/") || rel.includes("..") || rel.includes("\\") || /^[a-zA-Z]:/.test(rel)) {
    fail(`${src} contains an unsafe file path: ${rel}`);
  }
  if (!rel.endsWith(".json")) fail(`${src} contains a non-JSON file path: ${rel}`);
}

if (existsSync(outDir)) {
  if (!statSync(outDir).isDirectory()) fail(`${outDir} exists and is not a directory`);
  if (readdirSync(outDir).length) {
    fail(`${outDir} already exists and is not empty. Remove it or name an empty folder.`);
  }
}

for (const [rel, content] of Object.entries(bundle.files)) {
  const abs = join(resolve(outDir), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(content, null, 2) + "\n");
}

console.log(`unpacked ${Object.keys(bundle.files).length} files into ${outDir}`);
const s = bundle.snapshot ?? {};
if (s.folder) console.log(`snapshot ${s.folder}, contract ${s.schemaVersion || "unknown"}`);
console.log(`\nCheck it is whole:\n  node validate-snapshot.mjs ${outDir}`);
