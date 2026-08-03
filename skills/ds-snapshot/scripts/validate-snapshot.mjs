#!/usr/bin/env node
// Validates one design snapshot folder against contract v1.1.0.
// Usage: node validate-snapshot.mjs ds-snapshots/2026-08-03
// Exits 0 when the snapshot is valid, 1 when it is not. Warnings never fail the run.
//
// The dependency layer (dependencies.json) arrived in 1.1.0 and is optional.
// Checks that only exist in 1.1.0 are gated on the snapshot's own schemaVersion,
// so a 1.0.0 snapshot stays valid — that is what its schemaVersion is for.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const CONTRACT_VERSION = "1.1.0";
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
const label = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

// Which contract the snapshot itself claims, so 1.1.0-only checks skip an older one.
const declaredVersion = (manifest?.schemaVersion ?? "").split(".").map(Number);
const atLeast = (major, minor) =>
  declaredVersion[0] > major || (declaredVersion[0] === major && declaredVersion[1] >= minor);
const HAS_DEPENDENCY_LAYER = atLeast(1, 1);

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

  if (HAS_DEPENDENCY_LAYER) {
    const d = manifest.dependencies;
    if (!isPlainObject(d)) {
      err(M, "dependencies must be present as an object, with captured false when the layer was skipped");
    } else {
      if (typeof d.captured !== "boolean") err(M, "dependencies.captured must be a boolean");
      if (!Array.isArray(d.sources)) {
        err(M, "dependencies.sources must be an array, empty when the layer was skipped");
      } else {
        for (const s of d.sources) {
          const at = `dependencies.sources.${s?.figmaFileName ?? "?"}`;
          if (!s?.figmaFileName) err(M, `${at}.figmaFileName is required`);
          if (typeof s?.figmaFileKey !== "string") err(M, `${at}.figmaFileKey must be a string, "" when unknown`);
          if (!Number.isInteger(s?.componentsWalked) || s.componentsWalked < 0) {
            err(M, `${at}.componentsWalked must be an integer`);
          }
        }
        const names = d.sources.map((s) => s?.figmaFileName ?? "");
        if (new Set(names).size !== names.length) err(M, "dependencies.sources must not list a file twice");
        if (!sorted(names)) err(M, "dependencies.sources must be sorted by figmaFileName");
        if (d.captured === false && d.sources.length) {
          err(M, "dependencies.captured is false but sources lists files that were walked");
        }
        if (d.captured === true && d.sources.length === 0) {
          err(M, "dependencies.captured is true but no source file is listed");
        }
      }
      const countKeys = ["bindings", "aliases", "nests", "nestsUncaptured", "typographyLinks", "unresolvedBindings"];
      if (!isPlainObject(d.counts)) {
        err(M, `dependencies.counts must be an object with ${countKeys.join(", ")}`);
      } else {
        for (const k of countKeys) {
          if (!Number.isInteger(d.counts[k]) || d.counts[k] < 0) err(M, `dependencies.counts.${k} must be an integer`);
        }
        if (d.captured === false && countKeys.some((k) => d.counts[k] !== 0)) {
          err(M, "dependencies.captured is false so every dependencies.counts value must be 0");
        }
      }
    }
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

const depsCaptured = manifest?.dependencies?.captured === true;
if (HAS_DEPENDENCY_LAYER) {
  const depEntries = declared.filter((f) => f?.kind === "dependencies");
  if (depsCaptured) {
    if (depEntries.length !== 1) {
      err("manifest.json", "dependencies.captured is true so files must contain exactly one dependencies entry");
    } else if (depEntries[0].path !== "dependencies.json") {
      err("manifest.json", `the dependencies file must be dependencies.json, got ${depEntries[0].path}`);
    }
  } else if (depEntries.length) {
    err("manifest.json", "dependencies.captured is false so files must not declare a dependencies entry");
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

// (tokenPath, modeName) -> alias target, gathered from every per-mode file. This is
// what dependencies.json's aliases are checked against, in both directions.
const modeAliases = new Map();
const modeAliasKey = (path, mode) => `${path} ${mode}`;

for (const f of declared.filter((f) => f?.kind === "tokens-mode")) {
  if (!onDisk.includes(f.path)) continue;
  const doc = readJson(f.path);
  const res = validateTokenDoc(f.path, doc, { strictAliases: false });
  const expected = `tokens/${slug(f.collection)}.${slug(f.mode)}.json`;
  if (f.path !== expected) err(f.path, `filename is off contract, expected ${expected}`);
  for (const [path, t] of res.tokens ?? []) {
    if (isAlias(t.value)) modeAliases.set(modeAliasKey(path, f.mode), t.value.slice(1, -1));
  }
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
      const required = ["id", "name", "path", "kind", "variants", "variantCombinations", "description", "deprecated", "figma"];
      if (HAS_DEPENDENCY_LAYER) required.push("source");
      for (const k of required) {
        if (!(k in (c ?? {}))) err(C, `${at} is missing required field ${k}`);
      }
      if (HAS_DEPENDENCY_LAYER && "source" in (c ?? {}) && (typeof c.source !== "string" || !c.source)) {
        err(C, `${at} source must be the non-empty name of the Figma file it came from`);
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

// ----------------------------------------------------------- dependencies.json

const componentIds = new Set(
  (Array.isArray(components?.components) ? components.components : []).map((c) => c?.id).filter(Boolean)
);
const depCounts = { bindings: 0, aliases: 0, nests: 0, nestsUncaptured: 0, typographyLinks: 0, unresolvedBindings: 0 };
let dependencies = null;

if (HAS_DEPENDENCY_LAYER && depsCaptured) {
  dependencies = readJson("dependencies.json");
} else if (existsSync(join(root, "dependencies.json"))) {
  err(
    "dependencies.json",
    HAS_DEPENDENCY_LAYER
      ? "exists on disk but manifest.dependencies.captured is false"
      : `exists but the snapshot declares schemaVersion ${manifest?.schemaVersion}; the dependency layer arrived in 1.1.0`
  );
}

if (dependencies) {
  const D = "dependencies.json";
  if (!SEMVER.test(dependencies.schemaVersion ?? "")) err(D, "schemaVersion must be semver");

  // Every path must resolve in the documents this layer links together, so
  // nothing in it can dangle. That is the whole point of the file.
  const tokenPaths = defaultTokens.tokens ?? new Map();
  const typographyPaths = typography.tokens ?? new Map();

  if (!Array.isArray(dependencies.aliases)) {
    err(D, "aliases must be an array, empty when no token aliases another");
  } else {
    const seen = new Set();
    const declaredModes = new Set((manifest?.collections ?? []).flatMap((c) => c?.modes ?? []));
    for (const a of dependencies.aliases) {
      const at = `alias ${a?.from} -> ${a?.to} in "${a?.mode}"`;
      for (const k of ["from", "to", "mode"]) {
        if (typeof a?.[k] !== "string" || !a[k]) err(D, `${at} needs a non-empty ${k}`);
      }
      if (typeof a?.from !== "string" || typeof a?.to !== "string" || typeof a?.mode !== "string") continue;
      depCounts.aliases++;
      if (tokenPaths.size && !tokenPaths.has(a.from)) err(D, `${at} from does not exist in tokens.json`);
      if (tokenPaths.size && !tokenPaths.has(a.to)) err(D, `${at} to does not exist in tokens.json`);
      if (a.from === a.to) err(D, `${at} points at itself`);
      if (declaredModes.size && !declaredModes.has(a.mode)) {
        err(D, `${at} mode is not any collection's mode in the manifest`);
      }
      const key = modeAliasKey(a.from, a.mode);
      if (seen.has(key)) err(D, `${at} is listed twice; aliases hold one entry per token per mode`);
      seen.add(key);

      // Agree with the reference already written in the per-mode token file.
      if (modeAliases.has(key)) {
        if (modeAliases.get(key) !== a.to) {
          err(D, `${at} disagrees with the per-mode token file, which references {${modeAliases.get(key)}}`);
        }
      } else if (modeAliases.size) {
        err(D, `${at} has no matching alias in any tokens/<collection>.<mode>.json`);
      }
    }
    for (const [key, target] of modeAliases) {
      if (!seen.has(key)) {
        const [path, ...rest] = key.split(" ");
        err(D, `the per-mode token files alias ${path} to {${target}} in "${rest.join(" ")}", which aliases does not record`);
      }
    }
    if (!sorted(dependencies.aliases.map((a) => `${a?.from} ${a?.mode}`))) {
      err(D, "aliases must be sorted by from, then mode");
    }
  }

  if (!Array.isArray(dependencies.components)) {
    err(D, "components must be an array, empty when nothing has a dependency");
  } else {
    const ids = [];
    const seenIds = new Set();
    for (const c of dependencies.components) {
      const at = c?.id ?? "?";
      for (const k of ["id", "bindings", "typography", "nests", "nestsUncaptured", "unresolvedBindings"]) {
        if (!(k in (c ?? {}))) err(D, `${at} is missing required field ${k}; every link array is always present, empty when there is nothing`);
      }
      if (typeof c?.id !== "string" || !c.id) continue;
      ids.push(c.id);
      if (seenIds.has(c.id)) err(D, `duplicate entry for ${c.id}`);
      seenIds.add(c.id);
      if (componentIds.size && !componentIds.has(c.id)) {
        err(D, `${at} is not a component in components.json; this layer only links things the snapshot already names`);
      }

      if (Array.isArray(c.bindings)) {
        for (const b of c.bindings) {
          if (typeof b?.token !== "string" || !b.token) {
            err(D, `${at} has a binding with no token path`);
            continue;
          }
          depCounts.bindings++;
          if (tokenPaths.size && !tokenPaths.has(b.token)) {
            err(D, `${at} binds ${b.token}, which does not exist in tokens.json; an unmappable binding belongs in unresolvedBindings`);
          }
          if (!Array.isArray(b.properties) || b.properties.length === 0 || !b.properties.every((p) => typeof p === "string")) {
            err(D, `${at} binding ${b.token} needs a non-empty array of Figma property names`);
          } else if (!sorted(b.properties)) {
            err(D, `${at} binding ${b.token} properties must be sorted`);
          }
        }
        const tokens = c.bindings.map((b) => b?.token ?? "");
        if (new Set(tokens).size !== tokens.length) {
          err(D, `${at} binds the same token twice; merge the properties into one entry`);
        }
        if (!sorted(tokens)) err(D, `${at} bindings must be sorted by token`);
      } else {
        err(D, `${at} bindings must be an array`);
      }

      if (Array.isArray(c.typography)) {
        for (const t of c.typography) {
          if (typeof t !== "string" || !t) {
            err(D, `${at} has an empty typography path`);
            continue;
          }
          depCounts.typographyLinks++;
          if (typographyPaths.size && !typographyPaths.has(t)) {
            err(D, `${at} uses typography ${t}, which does not exist in typography.json`);
          }
        }
        if (new Set(c.typography).size !== c.typography.length) err(D, `${at} lists the same typography token twice`);
        if (!sorted(c.typography.map(String))) err(D, `${at} typography must be sorted`);
      } else {
        err(D, `${at} typography must be an array`);
      }

      if (Array.isArray(c.nests)) {
        for (const n of c.nests) {
          if (typeof n?.id !== "string" || !n.id) {
            err(D, `${at} has a nests entry with no id`);
            continue;
          }
          depCounts.nests++;
          if (componentIds.size && !componentIds.has(n.id)) {
            err(D, `${at} nests ${n.id}, which is not in components.json; a component that was not walked belongs in nestsUncaptured`);
          }
          if (n.id === c.id) err(D, `${at} nests itself`);
          if (!Number.isInteger(n.count) || n.count < 1) err(D, `${at} nests ${n.id} with a count of ${n.count}; must be a positive integer`);
        }
        const nested = c.nests.map((n) => n?.id ?? "");
        if (new Set(nested).size !== nested.length) err(D, `${at} lists the same nested component twice`);
        if (!sorted(nested)) err(D, `${at} nests must be sorted by id`);
      } else {
        err(D, `${at} nests must be an array`);
      }

      if (Array.isArray(c.nestsUncaptured)) {
        for (const n of c.nestsUncaptured) {
          if (typeof n?.name !== "string" || !n.name) {
            err(D, `${at} has a nestsUncaptured entry with no name`);
            continue;
          }
          depCounts.nestsUncaptured++;
          if (!Number.isInteger(n.count) || n.count < 1) {
            err(D, `${at} nestsUncaptured ${n.name} needs a count of at least 1`);
          }
        }
        if (!sorted(c.nestsUncaptured.map((n) => n?.name ?? ""))) err(D, `${at} nestsUncaptured must be sorted by name`);
      } else {
        err(D, `${at} nestsUncaptured must be an array`);
      }

      if (Array.isArray(c.unresolvedBindings)) {
        for (const u of c.unresolvedBindings) {
          if (typeof u?.figmaName !== "string" || !u.figmaName) {
            err(D, `${at} has an unresolvedBindings entry with no figmaName`);
            continue;
          }
          depCounts.unresolvedBindings++;
          if (!Array.isArray(u.properties) || u.properties.length === 0) {
            err(D, `${at} unresolved binding ${u.figmaName} needs a non-empty properties array`);
          }
        }
        if (!sorted(c.unresolvedBindings.map((u) => u?.figmaName ?? ""))) {
          err(D, `${at} unresolvedBindings must be sorted by figmaName`);
        }
      } else {
        err(D, `${at} unresolvedBindings must be an array`);
      }

      const linkCount =
        (c.bindings?.length ?? 0) + (c.typography?.length ?? 0) + (c.nests?.length ?? 0) +
        (c.nestsUncaptured?.length ?? 0) + (c.unresolvedBindings?.length ?? 0);
      if (linkCount === 0) {
        err(D, `${at} has no links at all; leave a component with no dependencies out of this file`);
      }
    }
    if (!sorted(ids)) err(D, "components must be sorted by id");
  }

  // The manifest's totals are derived, so they cannot be allowed to drift.
  const declaredCounts = manifest?.dependencies?.counts ?? {};
  for (const [k, got] of Object.entries(depCounts)) {
    if (Number.isInteger(declaredCounts[k]) && declaredCounts[k] !== got) {
      err("manifest.json", `dependencies.counts.${k} is ${declaredCounts[k]} but dependencies.json holds ${got}`);
    }
  }

  const walked = (manifest?.dependencies?.sources ?? []).reduce((n, s) => n + (s?.componentsWalked ?? 0), 0);
  if (walked && componentIds.size && walked > componentIds.size) {
    err(
      "manifest.json",
      `dependencies.sources account for ${walked} walked components but components.json holds only ${componentIds.size}`
    );
  }

  if (depCounts.unresolvedBindings > 0) {
    warn(D, `${label(depCounts.unresolvedBindings, "binding")} to a variable this snapshot does not hold`);
  }
  if (depCounts.nestsUncaptured > 0) {
    warn(
      D,
      `${label(depCounts.nestsUncaptured, "nested component")} never walked, so the dependencies of those are unknown; ` +
        `to include them, open the Desktop Bridge on the Figma file they live in and re-run`
    );
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
    `${manifest?.counts?.componentSets ?? 0} component sets.` +
    (dependencies
      ? `\nDependency layer from ${(manifest?.dependencies?.sources ?? []).length} Figma file(s): ` +
        `${depCounts.bindings} bindings, ${depCounts.aliases} aliases, ` +
        `${depCounts.nests} nested links, ${depCounts.typographyLinks} typography links.`
      : "\nNo dependency layer in this snapshot.")
);
process.exit(0);
