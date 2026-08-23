#!/usr/bin/env node
/**
 * scan-icons.mjs — code-side icon usage for ds-snapshot-app.
 *
 * Mobile icons are SVG assets re-exported through a barrel file
 * (src/components/icons/index.ts). CodeGraph indexes function/class/component
 * definitions; an `export { default as X } from "*.svg"` line isn't one, so
 * `codegraph query`/`callers` only ever finds the import site, never a real
 * definition, and `callers` comes back empty even for icons used dozens of
 * times. So icon usage is measured here by a text scan instead, the same way
 * ds-snapshot-web's scan-tokens.mjs measures CSS custom properties that
 * CodeGraph can't see either. Every entry carries `"method": "text-scan"`.
 *
 * Usage:
 *   node scan-icons.mjs --repo <path-to-app-repo> [--barrel src/components/icons/index.ts]
 *                        [--out <dir>] [--requested "ActivitiesIcon,VideosIcon"]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const repo = arg("repo", process.cwd());
const barrelRel = arg("barrel", "src/components/icons/index.ts");
const barrelPath = join(repo, barrelRel);
const outDir = arg("out", null);
const requested = (arg("requested", "") || "")
  .split(/[,\n]/)
  .map((n) => n.trim())
  .filter(Boolean);

if (!existsSync(barrelPath)) {
  console.error(`No icon barrel at ${barrelPath} — pass --barrel <path>.`);
  process.exit(1);
}

/* ------------------------------------------------------------- barrel --*/

/** name -> { name, assetPath, line } */
const icons = new Map();
{
  const src = readFileSync(barrelPath, "utf8");
  const lines = src.split("\n");
  const re = /^export\s*\{\s*default as (\w+)\s*\}\s*from\s*["'](.+?)["'];?\s*$/;
  lines.forEach((line, i) => {
    const m = line.match(re);
    if (!m) return;
    const [, name, assetPath] = m;
    icons.set(name, { name, assetPath, line: i + 1 });
  });
}

if (icons.size === 0) {
  console.error(`No "export { default as X } from '*.svg'" lines found in ${barrelRel}.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ scan --*/

const files = execFileSync(
  "rg",
  ["--files", "-g", "*.{ts,tsx,js,jsx}", "."],
  { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
)
  .split("\n")
  .map((f) => f.replace(/^\.\//, ""))
  .filter(Boolean)
  .filter((f) => f !== barrelRel);

// One name -> icon map lookup on a single alternation regex, built once, so
// every file is scanned in one pass rather than once per icon (47 icons over
// ~900 files is fine either way, but this scales the same as the token scan).
const names = [...icons.keys()];
const NAME_RE = new RegExp(`\\b(${names.join("|")})\\b`, "g");

// Drop the barrel's own import line before counting — every importing file
// has exactly one specifier occurrence there, which is an import, not a use.
// Multi-line imports (a wrapped specifier list) are rare here (46 single-line
// exports import cleanly); this strips the common single-line case.
const IMPORT_LINE_RE = /^.*\bfrom\s*["'][^"']*components\/icons["'];?\s*$/gm;

const fileKind = (file) =>
  /\.(test|spec)\.[a-z]+$|__tests__\//.test(file) ? "test"
  : /\.stories\.[a-z]+$/.test(file) ? "story"
  : "source";

const stats = new Map(); // name -> { count, files: Set }
const statFor = (name) => {
  if (!stats.has(name)) stats.set(name, { count: 0, files: new Set(), kinds: { source: 0, story: 0, test: 0 } });
  return stats.get(name);
};

let scanned = 0;
for (const file of files) {
  let src;
  try {
    src = readFileSync(join(repo, file), "utf8");
  } catch {
    continue;
  }
  scanned += 1;
  const stripped = src.replace(IMPORT_LINE_RE, "");
  for (const m of stripped.matchAll(NAME_RE)) {
    const s = statFor(m[1]);
    s.count += 1;
    s.files.add(file);
    s.kinds[fileKind(file)] += 1;
  }
}

/* ----------------------------------------------------------------- output --*/

let repoSlug = null;
try {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repoSlug = m[1];
} catch {}

const items = [...icons.values()]
  .map((icon) => {
    const s = stats.get(icon.name);
    return {
      name: icon.name,
      assetPath: icon.assetPath,
      barrelLine: icon.line,
      method: "text-scan",
      usage: {
        count: s ? s.count : 0,
        fileCount: s ? s.files.size : 0,
        inSource: s ? s.kinds.source : 0,
        inStories: s ? s.kinds.story : 0,
        inTests: s ? s.kinds.test : 0,
        files: s ? [...s.files].slice(0, 10) : [],
        sampled: s ? s.files.size > 10 : false,
      },
    };
  })
  .sort((a, b) => b.usage.count - a.usage.count || a.name.localeCompare(b.name));

const payload = {
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  repo: repoSlug,
  method: "text-scan",
  methodNote:
    "Icons are SVG assets re-exported through a barrel file, not function/component definitions, so CodeGraph's query/callers commands can't see where they're used — callers comes back empty even for icons used dozens of times. Counts here come from a text scan: every whole-word reference to the icon's exported name outside the barrel's own import line, across .ts/.tsx/.js/.jsx files.",
  source: {
    barrel: barrelRel,
    filesScanned: scanned,
  },
  requested,
  notFound: requested.filter((n) => !icons.has(n)),
  totals: {
    icons: items.length,
    used: items.filter((i) => i.usage.count > 0).length,
    unused: items.filter((i) => i.usage.count === 0).length,
  },
  items,
};

const json = JSON.stringify(payload, null, 2);
if (outDir) {
  writeFileSync(join(outDir, "icons.json"), json + "\n");
  console.error(`Wrote ${join(outDir, "icons.json")}`);
} else {
  process.stdout.write(json);
}

if (payload.notFound.length) {
  console.error(`\nRequested but not in the barrel: ${payload.notFound.join(", ")}`);
}
console.error(`\nScanned ${scanned} files, ${items.length} icons in the barrel.`);
console.error(`${payload.totals.used} used, ${payload.totals.unused} never referenced outside the barrel.`);
