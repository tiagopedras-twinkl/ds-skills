#!/usr/bin/env node
// Test helper: apply one change to one JSON file in a fixture.
// Usage: node mutate.mjs <json-file> <js body operating on `d`>
//
// Exists so the test runner can express a mutation as readable JavaScript instead
// of a shell string nested three quote levels deep.

import { readFileSync, writeFileSync } from "node:fs";

const [file, body] = process.argv.slice(2);
if (!file || !body) {
  console.error("usage: node mutate.mjs <json-file> <js body operating on `d`>");
  process.exit(1);
}
const d = JSON.parse(readFileSync(file, "utf8"));
new Function("d", body)(d);
writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
