#!/usr/bin/env node
/**
 * scan-tokens.mjs — code-side design token usage for ds-web-snapshot.
 *
 * CodeGraph indexes symbols, and a design token is not a symbol: it is a CSS
 * custom property that Tailwind turns into utility class names. So token usage
 * cannot come from CodeGraph and is measured here by a text scan instead. Every
 * entry this writes carries `"method": "text-scan"` so the two can never be
 * confused in the snapshot.
 *
 * Usage:
 *   node scan-tokens.mjs --repo <path-to-code-repo> [--themes ui/themes] [--out <dir>]
 *                        [--requested "--color-brand,--spacing-200"]
 *
 * With no --requested list it scans every declared token. With one, it still
 * scans everything (the whole-library picture is the point of a snapshot) but
 * records which names were asked for and which of them do not exist in code.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, basename } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const repo = arg("repo", process.cwd());
const themesDir = join(repo, arg("themes", "ui/themes"));
const outDir = arg("out", null);
const requested = (arg("requested", "") || "")
  .split(/[,\n]/)
  .map((n) => n.trim())
  .filter(Boolean)
  .map((n) => (n.startsWith("--") ? n : `--${n}`));

/* ---------------------------------------------------------------- tokens --*/

// Tailwind v4 namespaces: a custom property in one of these becomes a family of
// utility classes. Anything outside them (e.g. --dimension-*) is only reachable
// by writing var(--name) by hand.
const PREFIXES = {
  color: [
    "bg", "text", "border", "border-x", "border-y", "border-t", "border-r",
    "border-b", "border-l", "border-s", "border-e", "outline", "ring",
    "ring-offset", "inset-ring", "divide", "fill", "stroke", "shadow",
    "inset-shadow", "drop-shadow", "accent", "caret", "decoration",
    "placeholder", "from", "via", "to",
  ],
  spacing: [
    "p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe",
    "m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me",
    "gap", "gap-x", "gap-y", "space-x", "space-y",
    "w", "h", "size", "min-w", "min-h", "max-w", "max-h",
    "inset", "inset-x", "inset-y", "top", "right", "bottom", "left",
    "start", "end", "translate", "translate-x", "translate-y",
    "scroll-m", "scroll-mx", "scroll-my", "scroll-mt", "scroll-mr",
    "scroll-mb", "scroll-ml", "scroll-p", "scroll-px", "scroll-py",
    "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl",
    "basis", "indent", "leading",
  ],
  container: ["max-w", "min-w", "w"],
  shadow: ["shadow"],
  font: ["font"],
  text: ["text"],
  radius: ["rounded", "rounded-t", "rounded-r", "rounded-b", "rounded-l",
           "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl",
           "rounded-s", "rounded-e"],
  leading: ["leading"],
  tracking: ["tracking"],
  breakpoint: [], // used as a variant, handled separately
  dimension: [],  // not a Tailwind namespace — var() only
};

if (!existsSync(themesDir)) {
  console.error(`No theme folder at ${themesDir} — pass --themes <dir>.`);
  process.exit(1);
}

const themeFiles = readdirSync(themesDir).filter((f) => f.endsWith(".css"));
const declFiles = new Set(themeFiles.map((f) => relative(repo, join(themesDir, f))));

/** name -> { name, family, suffix, values: {theme: value} } */
const tokens = new Map();

for (const file of themeFiles) {
  const theme = basename(file).replace(/\.theme\.css$|\.css$/, "");
  const src = readFileSync(join(themesDir, file), "utf8");
  const re = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, rawValue] = m;
    if (name.endsWith("-*")) continue; // --color-*: initial (namespace reset)
    const value = rawValue.trim().replace(/\s+/g, " ");
    const family = name.slice(2).split("-")[0];
    const suffix = name.slice(3 + family.length);
    if (!suffix) continue;
    if (!tokens.has(name)) tokens.set(name, { name, family, suffix, values: {} });
    tokens.get(name).values[theme] = value;
  }
}

/* ------------------------------------------------- utility class name map --*/

/** utility string -> Set of token names it could mean */
const utilityMap = new Map();
const addUtility = (str, tokenName) => {
  if (!utilityMap.has(str)) utilityMap.set(str, new Set());
  utilityMap.get(str).add(tokenName);
};

for (const t of tokens.values()) {
  for (const prefix of PREFIXES[t.family] ?? []) {
    addUtility(`${prefix}-${t.suffix}`, t.name);
  }
}

// Breakpoints appear as responsive variants: `md:` and `max-md:`.
const variantMap = new Map();
for (const t of tokens.values()) {
  if (t.family !== "breakpoint") continue;
  variantMap.set(`${t.suffix}:`, t.name);
  variantMap.set(`max-${t.suffix}:`, t.name);
}

/* ------------------------------------------------------------------ scan --*/

const files = execFileSync(
  "rg",
  ["--files", "-g", "*.{ts,tsx,js,jsx,mjs,cjs,css,scss,mdx,html,vue,svelte}", "."],
  { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
)
  .split("\n")
  .map((f) => f.replace(/^\.\//, ""))
  .filter(Boolean)
  .filter((f) => !declFiles.has(f));

// Where a token is used matters as much as how often. A token used only inside
// ui/ is used by the design system itself; a token used in apps/, domains/ or
// core/ has actually been adopted by product code. Tests and stories are
// counted apart from both, so they never inflate an adoption number.
const fileKind = (file) =>
  /\.(test|spec)\.[a-z]+$|__tests__\//.test(file) ? "test"
  : /\.stories\.[a-z]+$|\.mdx$/.test(file) ? "story"
  : "source";
const fileSide = (file) => (file.startsWith("ui/") ? "designSystem" : "product");

const stats = new Map(); // token name -> tallies
const statFor = (name) => {
  if (!stats.has(name)) {
    stats.set(name, {
      utility: 0, variable: 0, files: new Set(), areas: new Map(), forms: new Map(),
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
  const area = file.split("/").slice(0, 2).join("/");
  s.areas.set(area, (s.areas.get(area) ?? 0) + 1);
  s.forms.set(form, (s.forms.get(form) ?? 0) + 1);
  s.kinds[fileKind(file)] += 1;
  if (fileKind(file) === "source") s.sides[fileSide(file)] += 1;
};

// A utility class: optional leading `-` (negative values), lowercase word with
// at least one hyphen, not glued to another identifier character. The trailing
// lookahead is what stops `bg-brand` from matching inside `bg-brand-subtle`.
const CANDIDATE = /(?<![A-Za-z0-9_-])-?[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![A-Za-z0-9_-])/g;
// A variant prefix: `md:`, `max-md:`, including after another variant.
const VARIANT = /(?<![A-Za-z0-9_-])(max-)?[a-z0-9]+:/g;
// A direct reference: var(--x), bg-(--x), [--x]
const VARREF = /--[a-z0-9-]+/g;

const collisions = new Map();
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
    if (owners.size > 1) collisions.set(raw, [...owners]);
    for (const name of owners) bump(name, "utility", raw, file);
  }

  for (const m of src.matchAll(VARIANT)) {
    const name = variantMap.get(m[0]);
    if (name) bump(name, "utility", m[0], file);
  }

  for (const m of src.matchAll(VARREF)) {
    if (tokens.has(m[0])) bump(m[0], "variable", `var(${m[0]})`, file);
  }
}

/* ----------------------------------------------------------------- output --*/

const topForms = (map, n = 6) =>
  Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));

const items = [...tokens.values()]
  .map((t) => {
    const s = stats.get(t.name);
    const count = s ? s.utility + s.variable : 0;
    return {
      name: t.name,
      family: t.family,
      method: "text-scan",
      values: t.values,
      usage: {
        count,
        utilityCount: s ? s.utility : 0,
        variableCount: s ? s.variable : 0,
        fileCount: s ? s.files.size : 0,
        inSource: s ? s.kinds.source : 0,
        inStories: s ? s.kinds.story : 0,
        inTests: s ? s.kinds.test : 0,
        inDesignSystem: s ? s.sides.designSystem : 0,
        inProduct: s ? s.sides.product : 0,
        forms: s ? topForms(s.forms) : {},
        areas: s ? topForms(s.areas, 8) : {},
        files: s ? [...s.files].slice(0, 10) : [],
        sampled: s ? s.files.size > 10 : false,
      },
    };
  })
  .sort((a, b) => b.usage.count - a.usage.count || a.name.localeCompare(b.name));

let repoSlug = null;
let branch = "main";
try {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repoSlug = m[1];
} catch {}

const payload = {
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  repo: repoSlug,
  branch,
  method: "text-scan",
  methodNote:
    "Design tokens are CSS custom properties, not code symbols, so CodeGraph cannot see them. Counts here come from a text scan of source files: Tailwind utility classes generated from each token, plus direct var(--token) references. Class names assembled at runtime are invisible to this method.",
  source: {
    themeFiles: [...declFiles].sort(),
    filesScanned: scanned,
  },
  requested,
  notFound: requested.filter((n) => !tokens.has(n)),
  totals: {
    tokens: items.length,
    used: items.filter((i) => i.usage.count > 0).length,
    unused: items.filter((i) => i.usage.count === 0).length,
    usedInProductCode: items.filter((i) => i.usage.inProduct > 0).length,
    designSystemOnly: items.filter(
      (i) => i.usage.inDesignSystem > 0 && i.usage.inProduct === 0,
    ).length,
    testOrStoryOnly: items.filter(
      (i) => i.usage.count > 0 && i.usage.inSource === 0,
    ).length,
  },
  collisions: Object.fromEntries(collisions),
  items,
};

const json = JSON.stringify(payload, null, 2);
if (outDir) {
  writeFileSync(join(outDir, "tokens.json"), json + "\n");
  console.error(`Wrote ${join(outDir, "tokens.json")}`);
} else {
  process.stdout.write(json);
}

// Summary to stderr so --out and piping both stay clean.
const byFamily = new Map();
for (const i of items) {
  if (!byFamily.has(i.family)) byFamily.set(i.family, { total: 0, used: 0 });
  const f = byFamily.get(i.family);
  f.total += 1;
  if (i.usage.count > 0) f.used += 1;
}
if (payload.notFound.length) {
  console.error(`\nRequested but not declared in code: ${payload.notFound.join(", ")}`);
}
console.error(`\nScanned ${scanned} files, ${items.length} tokens declared.`);
for (const [family, f] of [...byFamily.entries()].sort()) {
  console.error(`  ${family.padEnd(12)} ${String(f.used).padStart(3)}/${String(f.total).padEnd(3)} used`);
}
console.error(
  `\n${payload.totals.usedInProductCode} reach product code, ` +
    `${payload.totals.designSystemOnly} stay inside ui/, ` +
    `${payload.totals.testOrStoryOnly} appear only in tests or stories, ` +
    `${payload.totals.unused} are never referenced.`,
);
if (collisions.size) {
  console.error(`\nAmbiguous utilities (one class name, more than one token):`);
  for (const [str, owners] of collisions) console.error(`  ${str} -> ${owners.join(", ")}`);
}
