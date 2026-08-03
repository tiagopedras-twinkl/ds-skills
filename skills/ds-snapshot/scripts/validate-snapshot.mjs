#!/usr/bin/env node
// Validates one design snapshot folder against contract v1.0.0.
// Usage: node validate-snapshot.mjs ds-snapshots/2026-08-03
// Exits 0 when the snapshot is valid, 1 when it is not. Warnings never fail the run.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const CONTRACT_VERSION = "1.0.0";
const DTCG_SCHEMA = "https://www.designtokens.org/schemas/2025.10/format.json";
const SPEC_TYPES = new Set([
  "color", "dimension", "fontFamily", "fontWeight", "duration", "cubicBezier",
  "number", "strokeStyle", "border", "transition", "shadow", "gradient", "typography",
]);
const EXTRA_TYPES = new Set(["string", "boolean"]);
const FONT_WEIGHT_WORDS = new Set([
  "thin", "hairline", "extra-light", "ultra-light", "light", "normal", "regular",
  "book", "medium", "semi-bold", "demi-bold", "bold", "extra-bold", "ultra-bold",
  "black", "heavy", "extra-black", "ultra-black",
]);

const errors = [];
const warnings = [];
const extensionNamespaces = new Set();
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const root = process.argv[2];
if (!root) {
  console.error("usage: node validate-snapshot.mjs <snapshot-folder>");
  process.exit(1);
}
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`not a directory: ${root}`);
  process.exit(1);
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isAlias = (v) => typeof v === "string" && /^\{[^{}]+\}$/.test(v);
const sorted = (arr) =>
  arr.every((v, i) => i === 0 || arr[i - 1].toLowerCase() <= v.toLowerCase());
const SEMVER = /^\d+\.\d+\.\d+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readJson(relPath) {
  const abs = join(root, relPath);
  if (!existsSync(abs)) {
    err(relPath, "missing, the contract requires this file");
    return null;
  }
  const raw = readFileSync(abs, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    err(relPath, `invalid JSON: ${e.message}`);
    return null;
  }
  if (JSON.stringify(parsed, null, 2) + "\n" !== raw) {
    err(relPath, "formatting is off contract: needs 2-space indent, LF endings, one trailing newline");
  }
  return parsed;
}

// ---------------------------------------------------------------- shared walks

function checkNumberPrecision(where, node, path = []) {
  if (typeof node === "number") {
    if (Number.isFinite(node) && Math.abs(node * 1e4 - Math.round(node * 1e4)) > 1e-9) {
      err(where, `${path.join(".") || "value"} has more than 4 decimal places (${node})`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkNumberPrecision(where, v, [...path, i]));
    return;
  }
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) checkNumberPrecision(where, v, [...path, k]);
  }
}

function checkKeyOrder(where, node, path = []) {
  if (!isPlainObject(node)) return;
  const plain = Object.keys(node).filter((k) => !k.startsWith("$"));
  if (!sorted(plain)) {
    err(where, `keys under ${path.join(".") || "root"} are not sorted case-insensitively`);
  }
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith("$")) checkKeyOrder(where, v, [...path, k]);
  }
}

// Collect tokens from a DTCG document. A token is any object with $value.
function collectTokens(where, node, path, inheritedType, out) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    if (!isPlainObject(value)) {
      err(where, `${[...path, key].join(".")} is neither a token nor a group`);
      continue;
    }
    for (const bad of [".", "{", "}"]) {
      if (key.includes(bad)) {
        err(where, `name "${key}" contains "${bad}", which DTCG forbids in token and group names`);
      }
    }
    const type = value.$type ?? inheritedType;
    if ("$value" in value) {
      const tokenPath = [...path, key].join(".");
      if (!type) {
        err(where, `${tokenPath} has no $type and inherits none, so it is invalid DTCG`);
      }
      out.set(tokenPath, { type, value: value.$value, node: value });
      if (isPlainObject(value.$extensions)) {
        for (const ns of Object.keys(value.$extensions)) extensionNamespaces.add(ns);
      }
    } else {
      collectTokens(where, value, [...path, key], type, out);
    }
  }
}

function checkSubValue(where, tokenPath, field, type, v) {
  if (isAlias(v)) return; // resolved separately
  const at = `${tokenPath}${field ? "." + field : ""}`;
  switch (type) {
    case "color":
      if (!isPlainObject(v)) return err(where, `${at} colour value must be an object in 2025.10, not ${typeof v}`);
      if (typeof v.colorSpace !== "string") err(where, `${at} is missing colorSpace`);
      if (!Array.isArray(v.components) || v.components.length !== 3) {
        err(where, `${at} needs a components array of 3 numbers`);
      } else if (v.components.some((c) => !isAlias(c) && !isPlainObject(c) && (typeof c !== "number" || c < 0 || c > 1))) {
        err(where, `${at} components must be numbers from 0 to 1, Figma floats not 0-255`);
      }
      if ("alpha" in v && typeof v.alpha !== "number") err(where, `${at} alpha must be a number`);
      if ("hex" in v && !/^#[0-9a-f]{6}$/.test(v.hex)) err(where, `${at} hex must be lowercase 6-digit, got ${v.hex}`);
      break;
    case "dimension":
      if (!isPlainObject(v)) return err(where, `${at} dimension must be an object with value and unit`);
      if (typeof v.value !== "number") err(where, `${at} dimension value must be a number`);
      if (!["px", "rem"].includes(v.unit)) err(where, `${at} dimension unit must be px or rem, got ${v.unit}`);
      break;
    case "number":
      if (typeof v !== "number") err(where, `${at} must be a plain number`);
      break;
    case "fontWeight":
      if (typeof v === "number") {
        if (v < 1 || v > 1000) err(where, `${at} fontWeight must be between 1 and 1000`);
      } else if (typeof v === "string") {
        if (!FONT_WEIGHT_WORDS.has(v)) err(where, `${at} "${v}" is not a DTCG fontWeight keyword`);
      } else {
        err(where, `${at} fontWeight must be a number or keyword`);
      }
      break;
    case "fontFamily":
      if (typeof v !== "string" && !(Array.isArray(v) && v.every((f) => typeof f === "string"))) {
        err(where, `${at} fontFamily must be a string or array of strings`);
      }
      break;
    case "string":
      if (typeof v !== "string") err(where, `${at} must be a string`);
      break;
    case "boolean":
      if (typeof v !== "boolean") err(where, `${at} must be a boolean`);
      break;
    case "typography": {
      if (!isPlainObject(v)) return err(where, `${at} typography value must be an object`);
      for (const req of ["fontFamily", "fontSize", "fontWeight"]) {
        if (!(req in v)) err(where, `${at} is missing ${req}, which the contract always requires`);
      }
      const subTypes = {
        fontFamily: "fontFamily", fontSize: "dimension", fontWeight: "fontWeight",
        letterSpacing: "dimension", lineHeight: "number",
      };
      for (const [k, sub] of Object.entries(v)) {
        if (!(k in subTypes)) err(where, `${at} has unknown typography sub-value "${k}"`);
        else checkSubValue(where, tokenPath, k, sub, v[k]);
      }
      break;
    }
    default:
      break; // types the contract does not produce are left alone
  }
}

function validateTokenDoc(relPath, doc, { requireTypography = false, strictAliases = true } = {}) {
  if (!doc) return new Map();
  if (doc.$schema !== DTCG_SCHEMA) {
    err(relPath, `$schema must be "${DTCG_SCHEMA}"`);
  }
  checkKeyOrder(relPath, doc);
  checkNumberPrecision(relPath, doc);

  const tokens = new Map();
  collectTokens(relPath, doc, [], undefined, tokens);
  if (tokens.size === 0) err(relPath, "contains no tokens");

  const usedTypes = new Set();
  for (const [path, t] of tokens) {
    if (t.type) usedTypes.add(t.type);
    if (t.type && !SPEC_TYPES.has(t.type) && !EXTRA_TYPES.has(t.type)) {
      err(relPath, `${path} uses unknown $type "${t.type}"`);
    }
    if (requireTypography && t.type !== "typography") {
      err(relPath, `${path} must be $type typography, got "${t.type}"`);
    }
    checkSubValue(relPath, path, "", t.type, t.value);
    if (!isAlias(t.value) && typeof t.value === "string" && /[{}]/.test(t.value)) {
      err(relPath, `${path} looks like a malformed alias: ${t.value}`);
    }
  }

  // aliases resolve, and no cycles
  for (const [path, t] of tokens) {
    if (!isAlias(t.value)) continue;
    const seen = [path];
    let cursor = t.value;
    while (isAlias(cursor)) {
      const target = cursor.slice(1, -1);
      if (seen.includes(target)) {
        err(relPath, `circular alias chain: ${[...seen, target].join(" -> ")}`);
        break;
      }
      if (!tokens.has(target)) {
        const msg = `${path} references {${target}}, which does not exist in this file`;
        if (strictAliases) err(relPath, msg);
        else warn(relPath, `${msg} (expected for cross-collection aliases in per-mode files)`);
        break;
      }
      seen.push(target);
      cursor = tokens.get(target).value;
    }
  }

  return { tokens, usedTypes };
}

// ------------------------------------------------------------------- manifest

const manifest = readJson("manifest.json");
if (manifest) {
  const M = "manifest.json";
  if (manifest.schemaVersion !== CONTRACT_VERSION) {
    warn(M, `schemaVersion is ${manifest.schemaVersion}, this validator implements ${CONTRACT_VERSION}`);
  }
  if (!SEMVER.test(manifest.schemaVersion ?? "")) err(M, "schemaVersion must be semver");
  if (manifest.generator?.skill !== "ds-snapshot") err(M, 'generator.skill must be "ds-snapshot"');
  if (!SEMVER.test(manifest.generator?.skillVersion ?? "")) err(M, "generator.skillVersion must be semver");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.exportedAt ?? "")) {
    err(M, "exportedAt must be a UTC ISO 8601 timestamp ending in Z");
  }
  if (manifest.spec?.designTokens !== "2025.10") err(M, 'spec.designTokens must be "2025.10"');

  for (const k of ["figmaFileName", "figmaFileKey", "figmaLastModified", "transport"]) {
    if (typeof manifest.source?.[k] !== "string") err(M, `source.${k} must be present as a string, "" when unknown`);
  }
  if (!manifest.source?.figmaFileName) err(M, "source.figmaFileName must not be empty");
  if (!["desktop-bridge", "rest"].includes(manifest.source?.transport)) {
    err(M, "source.transport must be desktop-bridge or rest");
  }
  if (manifest.source?.transport === "rest") {
    warn(M, "exported over REST; variable reads are unreliable on non-Enterprise plans, prefer the desktop bridge");
  }

  if (!Array.isArray(manifest.collections) || manifest.collections.length === 0) {
    err(M, "collections must be a non-empty array");
  } else {
    for (const c of manifest.collections) {
      const at = `collections.${c?.name ?? "?"}`;
      if (!SLUG.test(c?.id ?? "")) err(M, `${at}.id must be a slug`);
      if (!c?.name) err(M, `${at}.name is required`);
      if (!Array.isArray(c?.modes) || c.modes.length === 0) err(M, `${at}.modes must be non-empty`);
      else {
        if (!c.modes.includes(c.defaultMode)) err(M, `${at}.defaultMode "${c.defaultMode}" is not in modes`);
        if (!sorted(c.modes)) err(M, `${at}.modes must be sorted case-insensitively`);
      }
      if (!Number.isInteger(c?.variableCount) || c.variableCount < 0) err(M, `${at}.variableCount must be an integer`);
    }
    const ids = manifest.collections.map((c) => c?.id ?? "");
    if (new Set(ids).size !== ids.length) err(M, "collection ids must be unique");
    if (!sorted(ids)) err(M, "collections must be sorted by id");
  }

  for (const k of ["variables", "typographyStyles", "components", "componentSets"]) {
    if (!Number.isInteger(manifest.counts?.[k])) err(M, `counts.${k} must be an integer`);
  }
  if (!Array.isArray(manifest.notes?.nonStandardTypes)) err(M, "notes.nonStandardTypes must be an array");
  if (!Array.isArray(manifest.notes?.unmapped)) err(M, "notes.unmapped must be an array");
  else {
    for (const u of manifest.notes.unmapped) {
      if (!u?.kind || !u?.name || !u?.reason) err(M, "each notes.unmapped entry needs kind, name and reason");
    }
  }
}

// ------------------------------------------------- files on disk vs manifest

const onDisk = [];
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name === "tokens") {
    for (const f of readdirSync(join(root, "tokens"))) onDisk.push(posix.join("tokens", f));
  } else if (entry.isFile()) {
    onDisk.push(entry.name);
  } else if (entry.isDirectory()) {
    err(entry.name, "unexpected directory in the snapshot; the contract allows only tokens/");
  }
}

const declared = Array.isArray(manifest?.files) ? manifest.files : [];
const declaredPaths = declared.map((f) => f?.path);
for (const p of onDisk) {
  if (p === "manifest.json") continue; // the manifest does not list itself
  if (!declaredPaths.includes(p)) err("manifest.json", `${p} exists on disk but is not listed in files`);
}
if (declaredPaths.includes("manifest.json")) {
  err("manifest.json", "files must not list manifest.json itself");
}
for (const p of declaredPaths) {
  if (!onDisk.includes(p)) err("manifest.json", `files lists ${p}, which is not on disk`);
}
for (const kind of ["tokens-default", "typography", "components"]) {
  if (declared.filter((f) => f?.kind === kind).length !== 1) {
    err("manifest.json", `files must contain exactly one ${kind} entry`);
  }
}
for (const c of manifest?.collections ?? []) {
  for (const mode of c?.modes ?? []) {
    const hit = declared.find((f) => f?.kind === "tokens-mode" && f.collection === c.name && f.mode === mode);
    if (!hit) err("manifest.json", `no tokens-mode file declared for ${c.name} / ${mode}`);
  }
}

// ---------------------------------------------------------------- token files

const defaultTokens = validateTokenDoc("tokens.json", readJson("tokens.json"));
const typography = validateTokenDoc("typography.json", readJson("typography.json"), { requireTypography: true });

for (const f of declared.filter((f) => f?.kind === "tokens-mode")) {
  if (!onDisk.includes(f.path)) continue;
  const doc = readJson(f.path);
  const res = validateTokenDoc(f.path, doc, { strictAliases: false });
  const expected = `tokens/${slug(f.collection)}.${slug(f.mode)}.json`;
  if (f.path !== expected) err(f.path, `filename is off contract, expected ${expected}`);
  for (const t of res.usedTypes ?? []) {
    if (EXTRA_TYPES.has(t) && !(manifest?.notes?.nonStandardTypes ?? []).includes(t)) {
      err("manifest.json", `notes.nonStandardTypes must list "${t}", used in ${f.path}`);
    }
  }
}
for (const t of defaultTokens.usedTypes ?? []) {
  if (EXTRA_TYPES.has(t) && !(manifest?.notes?.nonStandardTypes ?? []).includes(t)) {
    err("manifest.json", `notes.nonStandardTypes must list "${t}", used in tokens.json`);
  }
}

function slug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ------------------------------------------------------------- components.json

const components = readJson("components.json");
if (components) {
  const C = "components.json";
  if (!SEMVER.test(components.schemaVersion ?? "")) err(C, "schemaVersion must be semver");
  if (!Array.isArray(components.components)) {
    err(C, "components must be an array");
  } else {
    const seen = new Set();
    const ids = [];
    for (const c of components.components) {
      const at = c?.id ?? c?.name ?? "?";
      for (const k of ["id", "name", "path", "kind", "variants", "variantCombinations", "description", "deprecated", "figma"]) {
        if (!(k in (c ?? {}))) err(C, `${at} is missing required field ${k}`);
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(c?.id ?? "")) {
        err(C, `${at} id must be a slug path, got "${c?.id}"`);
      }
      if (seen.has(c?.id)) err(C, `duplicate id ${c.id}`);
      seen.add(c?.id);
      ids.push(c?.id ?? "");
      if (!["component", "componentSet"].includes(c?.kind)) err(C, `${at} kind must be component or componentSet`);
      if (!Array.isArray(c?.path)) err(C, `${at} path must be an array`);
      if (typeof c?.description !== "string") err(C, `${at} description must be a string, "" when empty`);
      if (typeof c?.deprecated !== "boolean") err(C, `${at} deprecated must be a boolean`);
      if (typeof c?.figma?.nodeId !== "string" || typeof c?.figma?.key !== "string") {
        err(C, `${at} figma.nodeId and figma.key must both be strings`);
      }
      const expectDeprecated = /deprecated/i.test(`${c?.name ?? ""} ${c?.description ?? ""}`);
      if (expectDeprecated && c?.deprecated === false) {
        err(C, `${at} name or description says deprecated but the flag is false`);
      }
      if (!isPlainObject(c?.variants)) {
        err(C, `${at} variants must be an object, {} for a plain component`);
      } else {
        const axes = Object.keys(c.variants);
        if (!sorted(axes)) err(C, `${at} variant axes must be sorted case-insensitively`);
        let product = 1;
        for (const [axis, values] of Object.entries(c.variants)) {
          if (!Array.isArray(values) || values.length === 0) {
            err(C, `${at} variant axis "${axis}" must have a non-empty array of values`);
            continue;
          }
          if (!values.every((v) => typeof v === "string")) err(C, `${at} variant values must be strings`);
          if (!sorted(values.map(String))) err(C, `${at} values of "${axis}" must be sorted case-insensitively`);
          if (new Set(values).size !== values.length) err(C, `${at} axis "${axis}" has duplicate values`);
          product *= values.length;
        }
        if (c.kind === "component" && axes.length > 0) err(C, `${at} is kind component but declares variants`);
        if (c.kind === "componentSet" && axes.length === 0) err(C, `${at} is a componentSet with no variant axes`);
        if (!Number.isInteger(c?.variantCombinations) || c.variantCombinations < 1) {
          err(C, `${at} variantCombinations must be an integer of at least 1`);
        } else if (c.variantCombinations > product) {
          err(C, `${at} variantCombinations (${c.variantCombinations}) exceeds the ${product} the axes allow`);
        } else if (c.variantCombinations < product) {
          warn(C, `${at} has ${product - c.variantCombinations} missing variant combinations`);
        }
      }
    }
    if (!sorted(ids)) err(C, "components must be sorted by id");
  }
}

// ------------------------------------------------------- extension namespace

if (extensionNamespaces.size === 0) {
  err("tokens", "no token carries $extensions; the contract requires figmaName and figmaType on every token");
} else {
  if (extensionNamespaces.size > 1) {
    err("tokens", `snapshot mixes ${extensionNamespaces.size} extension namespaces (${[...extensionNamespaces].join(", ")}); the contract allows exactly one`);
  }
  for (const ns of extensionNamespaces) {
    if (/OWNER|<|>|example\.com/.test(ns)) {
      err("tokens", `extension namespace "${ns}" still contains a placeholder; substitute it as described in output-contract.md`);
    }
    if (!/^[a-z0-9]+(?:\.[a-z0-9][a-z0-9-]*)+$/.test(ns)) {
      err("tokens", `extension namespace "${ns}" is not reverse domain notation, which the DTCG spec recommends to avoid clashes between tools`);
    }
  }
}

// -------------------------------------------------------------- cross-checks

if (manifest?.counts) {
  const leafCount = defaultTokens.tokens?.size ?? 0;
  if (manifest.counts.variables !== leafCount) {
    err("manifest.json", `counts.variables is ${manifest.counts.variables} but tokens.json holds ${leafCount} tokens`);
  }
  const typoCount = typography.tokens?.size ?? 0;
  if (manifest.counts.typographyStyles !== typoCount) {
    err("manifest.json", `counts.typographyStyles is ${manifest.counts.typographyStyles} but typography.json holds ${typoCount}`);
  }
  const list = Array.isArray(components?.components) ? components.components : [];
  const plain = list.filter((c) => c?.kind === "component").length;
  const sets = list.filter((c) => c?.kind === "componentSet").length;
  if (manifest.counts.components !== plain) {
    err("manifest.json", `counts.components is ${manifest.counts.components} but components.json holds ${plain}`);
  }
  if (manifest.counts.componentSets !== sets) {
    err("manifest.json", `counts.componentSets is ${manifest.counts.componentSets} but components.json holds ${sets}`);
  }
  const declaredVars = (manifest.collections ?? []).reduce((n, c) => n + (c?.variableCount ?? 0), 0);
  const unmappedVars = (manifest.notes?.unmapped ?? []).filter((u) => u?.kind === "variable").length;
  if (declaredVars !== manifest.counts.variables + unmappedVars) {
    err(
      "manifest.json",
      `collections declare ${declaredVars} variables but the snapshot accounts for ${manifest.counts.variables} exported plus ${unmappedVars} unmapped`
    );
  }
}

// -------------------------------------------------------------------- report

const label = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
if (warnings.length) {
  console.log(`\n${label(warnings.length, "warning")}:`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\n${label(errors.length, "error")}:`);
  for (const e of errors) console.log(`  x ${e}`);
  console.log(`\nSnapshot is off contract. Fix the export, do not adjust the contract to fit.`);
  process.exit(1);
}
console.log(
  `\nSnapshot valid against contract ${CONTRACT_VERSION}: ` +
    `${manifest?.counts?.variables ?? 0} variables, ` +
    `${manifest?.counts?.typographyStyles ?? 0} typography styles, ` +
    `${manifest?.counts?.components ?? 0} components, ` +
    `${manifest?.counts?.componentSets ?? 0} component sets.`
);
process.exit(0);
