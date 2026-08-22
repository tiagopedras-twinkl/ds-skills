#!/usr/bin/env node
/**
 * scan-tokens.mjs — code-side design token usage for ds-app-snapshot (mobile).
 *
 * A design token isn't a code symbol here either, same reasoning as
 * ds-web-snapshot's scan-tokens.mjs: CodeGraph indexes function/component
 * definitions, and a token is a CSS custom property (NativeWind side) or a
 * plain object literal key (JS side). Neither shows up as something
 * `codegraph query` can find, so usage is measured by a text scan instead.
 * Every entry carries `"method": "text-scan"`.
 *
 * Unlike web, this app doesn't declare its own token source — it consumes
 * @twinkltech/mobile-design-system, a published package. This script reads
 * the token key lists straight out of that package's installed
 * nativewind-preset.js (the same file NativeWind itself loads to generate
 * utility classes), so it always matches whatever version is actually
 * installed rather than a hand-copied snapshot of the keys.
 *
 * Two independent consumption styles both count, per the app's own styling
 * convention (.github/agents/ui-styling.md): spacing/gap/radius/font-weight
 * mostly go through NativeWind className utilities; colours and some
 * dimensions go through the JS token objects (edsLight/edsDark/ldsLight,
 * cornerRadius, fontSize, spacing, gap, primitives) via style props. A token
 * used through either path counts.
 *
 * Usage:
 *   node scan-tokens.mjs --repo <path-to-app-repo>
 *                        [--package @twinkltech/mobile-design-system]
 *                        [--out <dir>] [--requested "background-brand,spacing-200"]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const repo = resolve(arg("repo", process.cwd()));
const pkgName = arg("package", "@twinkltech/mobile-design-system");
const outDir = arg("out", null);
const requested = (arg("requested", "") || "")
  .split(/[,\n]/)
  .map((n) => n.trim())
  .filter(Boolean);

const require = createRequire(join(repo, "package.json"));

let preset;
try {
  preset = require(`${pkgName}/nativewind-preset`);
} catch (e) {
  console.error(`Couldn't load ${pkgName}/nativewind-preset from ${repo} — is the package installed? (${e.message})`);
  process.exit(1);
}

let pkgVersion = null;
try {
  pkgVersion = JSON.parse(readFileSync(require.resolve(`${pkgName}/package.json`), "utf8")).version;
} catch {
  // Some export maps don't expose package.json; version is a nice-to-have, not required.
  try {
    const dsPkgPath = require.resolve(`${pkgName}/nativewind-preset`).replace(/nativewind-preset\.js$/, "package.json");
    pkgVersion = JSON.parse(readFileSync(dsPkgPath, "utf8")).version;
  } catch {}
}

/* -------------------------------------------------------- token identity --*/

// One entry per CSS custom property this preset wires up. `suffix` is what a
// NativeWind utility class ends in; `family` groups the counting rules below.
// name = "<family>-<suffix>" for spacing/gap/radius/fontSize/fontWeight, or
// the colour key itself (already "<category>-<key>", e.g. "background-brand")
// for colours, since that's how edsLight/edsDark/ldsLight nest.
const tokens = new Map();
const addToken = (name, family, suffix) => {
  if (!tokens.has(name)) tokens.set(name, { name, family, suffix });
};

const ext = preset.theme.extend;
for (const colorKey of Object.keys(ext.colors ?? {})) addToken(colorKey, "color", colorKey);
for (const key of Object.keys(ext.spacing ?? {})) addToken(`spacing-${key}`, "spacing", key);
for (const key of Object.keys(ext.gap ?? {})) addToken(`gap-${key}`, "gap", key);
for (const key of Object.keys(ext.borderRadius ?? {})) addToken(`radius-${key}`, "radius", key);
for (const key of Object.keys(ext.fontSize ?? {})) addToken(`fontSize-${key}`, "fontSize", key);
for (const key of Object.keys(ext.fontWeight ?? {})) addToken(`fontWeight-${key}`, "fontWeight", key);

/* ------------------------------------------------- utility class name map --*/

// Prefixes NativeWind actually resolves for each family in a React Native
// tree. Narrower than Tailwind's full web prefix set (no ring/outline/divide/
// accent/caret/decoration/placeholder — those are DOM-only) since a false
// positive here would misreport a token as used from a class name that
// couldn't exist in this app.
const PREFIXES = {
  color: ["bg", "text", "border", "border-t", "border-r", "border-b", "border-l", "fill", "stroke"],
  spacing: [
    "p", "px", "py", "pt", "pr", "pb", "pl",
    "m", "mx", "my", "mt", "mr", "mb", "ml",
    "w", "h", "min-w", "min-h", "max-w", "max-h",
    "top", "right", "bottom", "left", "inset", "inset-x", "inset-y",
  ],
  gap: ["gap", "gap-x", "gap-y"],
  radius: ["rounded", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
  fontSize: ["text"],
  fontWeight: ["font"],
};

const utilityMap = new Map(); // utility string -> Set of token names
const addUtility = (str, tokenName) => {
  if (!utilityMap.has(str)) utilityMap.set(str, new Set());
  utilityMap.get(str).add(tokenName);
};
for (const t of tokens.values()) {
  for (const prefix of PREFIXES[t.family] ?? []) addUtility(`${prefix}-${t.suffix}`, t.name);
}

/* ------------------------------------------------------------------ scan --*/

const files = execFileSync(
  "rg",
  ["--files", "-g", "*.{ts,tsx,js,jsx}", "."],
  { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
)
  .split("\n")
  .map((f) => f.replace(/^\.\//, ""))
  .filter(Boolean);

const fileKind = (file) =>
  /\.(test|spec)\.[a-z]+$|__tests__\//.test(file) ? "test"
  : /\.stories\.[a-z]+$/.test(file) ? "story"
  : "source";
// This app's own reusable DS-bound wrapper layer is src/components/designSystem/
// — the closest equivalent to web's ui/ (design system itself, vs. product code
// that adopts it).
const fileSide = (file) => (file.startsWith("src/components/designSystem/") ? "designSystem" : "product");

const stats = new Map();
const statFor = (name) => {
  if (!stats.has(name)) {
    stats.set(name, {
      className: 0, jsAccess: 0, files: new Set(), forms: new Map(),
      kinds: { source: 0, story: 0, test: 0 },
      sides: { designSystem: 0, product: 0 },
    });
  }
  return stats.get(name);
};
const bump = (name, kind, form, file) => {
  const s = statFor(name);
  s[kind] += 1;
  s.files.add(file);
  s.forms.set(form, (s.forms.get(form) ?? 0) + 1);
  s.kinds[fileKind(file)] += 1;
  if (fileKind(file) === "source") s.sides[fileSide(file)] += 1;
};

// A className candidate: optional leading `-` (negative spacing), lowercase
// word with at least one hyphen. Bounded on both ends so `bg-brand` never
// matches inside `bg-brand-subtle`.
const CANDIDATE = /(?<![A-Za-z0-9_-])-?[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![A-Za-z0-9_-])/g;

// JS access, three shapes:
//  1. Theme colour objects, nested two levels: edsLight.background.default,
//     ldsLight.button["primary-background"].
const THEME_RE = /\b(edsLight|edsDark|ldsLight)\s*\.\s*([a-zA-Z][\w]*)\s*(?:\.\s*([a-zA-Z][\w]*)|\[\s*["']([\w-]+)["']\s*\])/g;
//  2. Numeric-keyed namespaces, bracket-only since the keys start with a
//     digit: spacing["200"], gap["150"].
const NUMERIC_RE = /\b(spacing|gap)\s*\[\s*["']?(\d+)["']?\s*\]/g;
//  3. Word-keyed namespaces, dot notation: cornerRadius.xl, fontSize.lg,
//     fontWeight.medium.
const WORD_RE = /\b(cornerRadius|fontSize|fontWeight)\s*\.\s*([a-zA-Z][\w]*)/g;
// Raw palette shades, tracked separately — these aren't semantic tokens (see
// "Reading the result" in the SKILL doc), just observed for completeness.
const PRIMITIVE_RE = /\bprimitives\s*\.\s*([a-zA-Z]+)\s*\[\s*["']?(\d+)["']?\s*\]/g;

const primitiveStats = new Map(); // "family-shade" -> {count, files: Set}

let scanned = 0;
for (const file of files) {
  let src;
  try {
    src = readFileSync(join(repo, file), "utf8");
  } catch {
    continue;
  }
  scanned += 1;

  for (const m of src.matchAll(CANDIDATE)) {
    const raw = m[0].startsWith("-") ? m[0].slice(1) : m[0];
    const owners = utilityMap.get(raw);
    if (!owners) continue;
    for (const name of owners) bump(name, "className", raw, file);
  }

  for (const m of src.matchAll(THEME_RE)) {
    const [, , category, dotKey, bracketKey] = m;
    const key = dotKey ?? bracketKey;
    const name = `${category}-${key}`;
    if (tokens.has(name)) bump(name, "jsAccess", m[0], file);
  }

  for (const m of src.matchAll(NUMERIC_RE)) {
    const [, family, key] = m;
    const name = `${family}-${key}`;
    if (tokens.has(name)) bump(name, "jsAccess", m[0], file);
  }

  for (const m of src.matchAll(WORD_RE)) {
    const [, namespace, key] = m;
    const family = namespace === "cornerRadius" ? "radius" : namespace;
    const name = `${family}-${key}`;
    if (tokens.has(name)) bump(name, "jsAccess", m[0], file);
  }

  for (const m of src.matchAll(PRIMITIVE_RE)) {
    const [, family, shade] = m;
    const name = `${family}-${shade}`;
    if (!primitiveStats.has(name)) primitiveStats.set(name, { count: 0, files: new Set() });
    const p = primitiveStats.get(name);
    p.count += 1;
    p.files.add(file);
  }
}

/* ----------------------------------------------------------------- output --*/

const topForms = (map, n = 6) =>
  Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));

const items = [...tokens.values()]
  .map((t) => {
    const s = stats.get(t.name);
    const count = s ? s.className + s.jsAccess : 0;
    return {
      name: t.name,
      family: t.family,
      method: "text-scan",
      usage: {
        count,
        classNameCount: s ? s.className : 0,
        jsAccessCount: s ? s.jsAccess : 0,
        fileCount: s ? s.files.size : 0,
        inSource: s ? s.kinds.source : 0,
        inStories: s ? s.kinds.story : 0,
        inTests: s ? s.kinds.test : 0,
        inDesignSystem: s ? s.sides.designSystem : 0,
        inProduct: s ? s.sides.product : 0,
        forms: s ? topForms(s.forms) : {},
        files: s ? [...s.files].slice(0, 10) : [],
        sampled: s ? s.files.size > 10 : false,
      },
    };
  })
  .sort((a, b) => b.usage.count - a.usage.count || a.name.localeCompare(b.name));

const primitives = [...primitiveStats.entries()]
  .map(([name, p]) => ({ name, count: p.count, fileCount: p.files.size, files: [...p.files].slice(0, 5) }))
  .sort((a, b) => b.count - a.count);

let repoSlug = null;
try {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repoSlug = m[1];
} catch {}

const payload = {
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  repo: repoSlug,
  method: "text-scan",
  methodNote:
    "Design tokens are CSS custom properties (NativeWind side) and plain object keys (JS side), not code symbols, so CodeGraph cannot see them. Counts here come from a text scan of source files: NativeWind utility classes generated from each token per @twinkltech/mobile-design-system's own nativewind-preset.js, plus direct property access on edsLight/edsDark/ldsLight/spacing/gap/cornerRadius/fontSize/fontWeight. A class name assembled at runtime (e.g. `bg-${colour}`) is invisible to this method, same limitation as the web scan.",
  source: {
    package: pkgName,
    packageVersion: pkgVersion,
    filesScanned: scanned,
  },
  requested,
  notFound: requested.filter((n) => !tokens.has(n)),
  totals: {
    tokens: items.length,
    used: items.filter((i) => i.usage.count > 0).length,
    unused: items.filter((i) => i.usage.count === 0).length,
    usedInProductCode: items.filter((i) => i.usage.inProduct > 0).length,
    designSystemOnly: items.filter((i) => i.usage.inDesignSystem > 0 && i.usage.inProduct === 0).length,
    testOrStoryOnly: items.filter((i) => i.usage.count > 0 && i.usage.inSource === 0).length,
  },
  primitives,
  items,
};

const json = JSON.stringify(payload, null, 2);
if (outDir) {
  writeFileSync(join(outDir, "tokens.json"), json + "\n");
  console.error(`Wrote ${join(outDir, "tokens.json")}`);
} else {
  process.stdout.write(json);
}

const byFamily = new Map();
for (const i of items) {
  if (!byFamily.has(i.family)) byFamily.set(i.family, { total: 0, used: 0 });
  const f = byFamily.get(i.family);
  f.total += 1;
  if (i.usage.count > 0) f.used += 1;
}
if (payload.notFound.length) console.error(`\nRequested but not declared in the package: ${payload.notFound.join(", ")}`);
console.error(`\nScanned ${scanned} files, ${items.length} tokens declared in ${pkgName}${pkgVersion ? `@${pkgVersion}` : ""}.`);
for (const [family, f] of [...byFamily.entries()].sort()) {
  console.error(`  ${family.padEnd(12)} ${String(f.used).padStart(3)}/${String(f.total).padEnd(3)} used`);
}
console.error(
  `\n${payload.totals.usedInProductCode} reach product code, ` +
    `${payload.totals.designSystemOnly} stay inside src/components/designSystem/, ` +
    `${payload.totals.testOrStoryOnly} appear only in tests or stories, ` +
    `${payload.totals.unused} are never referenced.`,
);
if (primitives.length) console.error(`\n${primitives.length} raw palette shades referenced directly (bypassing semantic tokens) — see "primitives" in the JSON.`);
