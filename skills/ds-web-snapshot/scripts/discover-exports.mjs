#!/usr/bin/env node
/**
 * discover-exports.mjs — the code's own list of components, modules and icons
 * for ds-web-snapshot, replacing a caller-supplied list as the thing Steps 1-4
 * are run against.
 *
 * A component/module/icon "exists" here if it is reachable through the real
 * export chain a consumer would actually import from — starting at the tree's
 * top barrel and following `export { X } from "./y"` and `export * from "./y"`
 * until every name resolves to a concrete declaration. That is the same
 * question CodeGraph answers for usage, just asked one step earlier: not
 * "who calls this name" but "does this name exist at all".
 *
 * Also extracts a Storybook-argTypes equivalent for CMS modules from the
 * generated Sanity schema types, since modules have no *.stories.tsx to read
 * one from (see "Module metadata" below and in SKILL.md).
 *
 * Usage:
 *   node discover-exports.mjs --repo <path-to-code-repo> [--out <dir>]
 *
 * With --out, writes discovered-exports.json into that directory (for
 * inspection / diffing) as well as printing it to stdout.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const repo = arg("repo", process.cwd());
const outDir = arg("out", null);

const COMPONENTS_BARREL = "ui/src/components"; // walked dir-by-dir, no single top barrel
const MODULES_BARREL = "core/cms/src/modules/index.ts";
const ICONS_BARREL = "ui/src/icons/index.ts";
const SANITY_TYPES = "core/cms/src/types/sanity.types.ts";

const abs = (relPath) => join(repo, relPath);
const readIfExists = (relPath) => (existsSync(abs(relPath)) ? readFileSync(abs(relPath), "utf8") : null);

/* --------------------------------------------------------- export walking --*/

// Resolves a relative import specifier ("./foo") to the file it actually
// names, trying the same extensions/index fallbacks Node/TS resolution does.
function resolveImport(fromFile, specifier) {
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const base = join(dir, specifier).replace(/\\/g, "/").replace(/^\.\//, "");
  const candidates = [
    `${base}.ts`, `${base}.tsx`,
    `${base}/index.ts`, `${base}/index.tsx`,
  ];
  for (const c of candidates) if (existsSync(abs(c))) return c;
  return null;
}

// Strips comments and normalises whitespace enough for the export regexes
// below to work reliably across single- and multi-line statements.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const EXPORT_NAMED = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// A bare re-export list — `import { X } from "./y"; export { X };` — names
// already imported into scope, no `from` clause on the export itself.
const EXPORT_NAMED_LOCAL = /export\s*\{([^}]*)\}(?!\s*from\b)/g;
const EXPORT_STAR = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const EXPORT_LOCAL = /export\s+(?:const|function|class|async function)\s+([A-Za-z_$][\w$]*)/g;

/**
 * Returns { names: Set<string>, barrelsWalked: number } for everything
 * reachable from entryFile's export surface.
 */
function collectExports(entryFile, visited = new Set(), depth = 0) {
  const names = new Set();
  let barrelsWalked = 0;
  if (depth > 6 || visited.has(entryFile)) return { names, barrelsWalked };
  visited.add(entryFile);

  const src = readIfExists(entryFile);
  if (src == null) return { names, barrelsWalked };
  barrelsWalked += 1;
  const clean = stripComments(src);

  let sawReExport = false;

  // The named form already gives us the public name, so unlike `export *`
  // below there is no need to open the file it's re-exported from.
  for (const m of clean.matchAll(EXPORT_NAMED)) {
    sawReExport = true;
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue; // type-only export, not a runtime symbol
      const asMatch = part.match(/^(.+?)\s+as\s+(.+)$/);
      const publicName = (asMatch ? asMatch[2] : part).trim();
      if (/^[A-Z][\w$]*$/.test(publicName)) names.add(publicName);
    }
  }

  for (const m of clean.matchAll(EXPORT_NAMED_LOCAL)) {
    sawReExport = true;
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      const asMatch = part.match(/^(.+?)\s+as\s+(.+)$/);
      const publicName = (asMatch ? asMatch[2] : part).trim();
      if (/^[A-Z][\w$]*$/.test(publicName)) names.add(publicName);
    }
  }

  for (const m of clean.matchAll(EXPORT_STAR)) {
    sawReExport = true;
    const target = resolveImport(entryFile, m[1]);
    if (!target) continue;
    const nested = collectExports(target, visited, depth + 1);
    for (const n of nested.names) names.add(n);
    barrelsWalked += nested.barrelsWalked;
  }

  // A leaf file (e.g. a single icon component) declares directly rather than
  // re-exporting — only look for this when nothing above matched, so a barrel
  // that also happens to define a local const isn't double-counted.
  if (!sawReExport) {
    for (const m of clean.matchAll(EXPORT_LOCAL)) names.add(m[1]);
  }

  return { names, barrelsWalked };
}

// Components have no single top-level barrel (checked: none exists), so every
// component's own directory is its barrel — walk each ui/src/components/*/
// and any *nested* index.ts under it (e.g. header/account-menu/index.ts),
// since sub-components live one level deeper with their own barrel.
function findIndexFiles(dirRel) {
  const found = [];
  const walk = (rel) => {
    const fullDir = abs(rel);
    let entries;
    try {
      entries = readdirSync(fullDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(childRel);
      else if (e.isFile() && e.name === "index.ts") found.push(childRel);
    }
  };
  walk(dirRel);
  return found;
}

function discoverComponents() {
  if (!existsSync(abs(COMPONENTS_BARREL))) return { names: [], barrelsWalked: 0 };
  const indexFiles = findIndexFiles(COMPONENTS_BARREL);
  const names = new Set();
  let barrelsWalked = 0;
  const visited = new Set();
  for (const file of indexFiles) {
    const r = collectExports(file, visited);
    for (const n of r.names) names.add(n);
    barrelsWalked += r.barrelsWalked;
  }
  return { names: [...names].sort(), barrelsWalked };
}

function discoverFromTopBarrel(barrelRel) {
  if (!existsSync(abs(barrelRel))) return { names: [], barrelsWalked: 0 };
  const r = collectExports(barrelRel);
  return { names: [...r.names].sort(), barrelsWalked: r.barrelsWalked };
}

/* ------------------------------------------------------- module argTypes --*/

// CMS modules have no Storybook stories, so there is no *.stories.tsx meta to
// read argTypes from the way Step 3 does for components. What they do have is
// a generated Sanity schema type — the editorial fields a content editor can
// actually set, which is the closer analogue to a component's argTypes than
// the module's own React props (those carry plumbing like `documentId` /
// `draftMode`, not design-relevant options). This section mines that file.
//
// What it resolves: a field typed as an inline string-literal union
// (`"a" | "b"`), or as a bare alias whose own `export type Alias = "a" | "b"`
// sits elsewhere in the same file (one hop only). Object-shaped or opaque
// field types (`ImageWithMetadataField`, `CustomActionField`, `string`) are
// recorded with their type name and no options — real, just not a closed set.
function extractModuleArgTypes() {
  const src = readIfExists(SANITY_TYPES);
  if (src == null) return {};
  const clean = stripComments(src);

  // export type Name = { ...balanced-braces... };   OR   export type Name = "a" | "b" | ...;
  const TYPE_START = /export\s+type\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  const blocks = new Map(); // name -> raw type body (object literal or union)

  let m;
  while ((m = TYPE_START.exec(clean))) {
    const name = m[1];
    const start = TYPE_START.lastIndex;
    if (clean[start] === "{") {
      let depth = 0, i = start;
      for (; i < clean.length; i++) {
        if (clean[i] === "{") depth++;
        else if (clean[i] === "}") {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
      blocks.set(name, { kind: "object", body: clean.slice(start, i) });
      TYPE_START.lastIndex = i;
    } else {
      const end = clean.indexOf(";", start);
      if (end === -1) continue;
      blocks.set(name, { kind: "union", body: clean.slice(start, end) });
      TYPE_START.lastIndex = end;
    }
  }

  const literalUnion = (body) => {
    const options = [...body.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    return options.length ? options : null;
  };

  // Alias map: only string-literal unions resolve; object aliases stay opaque.
  const aliasOptions = new Map();
  for (const [name, block] of blocks) {
    if (block.kind === "union") {
      const opts = literalUnion(block.body);
      if (opts) aliasOptions.set(name, opts);
    }
  }

  const argTypesByType = {};
  for (const [name, block] of blocks) {
    if (block.kind !== "object") continue;
    const fields = {};
    // Depth-1 fields only: `name?: <type up to matching ;>`, tracking brace
    // depth across the multi-line type expression a field can carry.
    const body = block.body;
    let i = 0;
    const fieldMatch = /([A-Za-z_$][\w$]*)\??:\s*/y;
    while (i < body.length) {
      // Skip whitespace before attempting a field match.
      while (i < body.length && /\s/.test(body[i])) i++;
      fieldMatch.lastIndex = i;
      const fm = fieldMatch.exec(body);
      if (!fm || fm.index !== i) {
        // Not at a field start (could be inside a nested block skipped below,
        // or the loop's cursor landed mid-token) — advance one char.
        i++;
        continue;
      }
      const fieldName = fm[1];
      let j = fieldMatch.lastIndex;
      let depth = 0;
      const typeStart = j;
      while (j < body.length) {
        const ch = body[j];
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
        else if (ch === ";" && depth === 0) break;
        j++;
      }
      const typeExpr = body.slice(typeStart, j).trim();
      if (fieldName !== "_type") {
        const opts = literalUnion(typeExpr);
        if (opts) {
          fields[fieldName] = { options: opts, control: { type: "select" } };
        } else if (aliasOptions.has(typeExpr.replace(/\s*\|\s*null$/, ""))) {
          fields[fieldName] = {
            options: aliasOptions.get(typeExpr.replace(/\s*\|\s*null$/, "")),
            control: { type: "select" },
          };
        } else {
          fields[fieldName] = { type: typeExpr.replace(/\s*\|\s*null$/, "") };
        }
      }
      i = j + 1;
    }
    argTypesByType[name] = fields;
  }

  return argTypesByType;
}

/* ------------------------------------------------------------------ main --*/

const components = discoverComponents();
const modules = discoverFromTopBarrel(MODULES_BARREL);
const icons = discoverFromTopBarrel(ICONS_BARREL);
const moduleArgTypes = extractModuleArgTypes();

let repoSlug = null;
try {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repoSlug = m[1];
} catch {}

const payload = {
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  repo: repoSlug,
  method: "export-walk",
  methodNote:
    "Names are every symbol reachable from the tree's top export barrel by following `export { X } from` and `export * from` to a concrete declaration — not a text search, so a name defined but never exported (dead code) correctly does not appear.",
  components: { count: components.names.length, barrelsWalked: components.barrelsWalked, names: components.names },
  modules: { count: modules.names.length, barrelsWalked: modules.barrelsWalked, names: modules.names },
  icons: { count: icons.names.length, barrelsWalked: icons.barrelsWalked, names: icons.names },
  moduleArgTypes,
};

const json = JSON.stringify(payload, null, 2);
if (outDir) {
  writeFileSync(join(outDir, "discovered-exports.json"), json + "\n");
  console.error(`Wrote ${join(outDir, "discovered-exports.json")}`);
} else {
  process.stdout.write(json);
}

console.error(
  `\ncomponents: ${components.names.length} names across ${components.barrelsWalked} barrels`,
);
console.error(`modules:    ${modules.names.length} names across ${modules.barrelsWalked} barrels`);
console.error(`icons:      ${icons.names.length} names across ${icons.barrelsWalked} barrels`);
console.error(`moduleArgTypes resolved for ${Object.keys(moduleArgTypes).length} Sanity schema types`);
