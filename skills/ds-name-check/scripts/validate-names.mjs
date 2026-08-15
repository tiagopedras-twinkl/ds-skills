#!/usr/bin/env node
/**
 * validate-names.mjs — validate component names against the naming spec.
 *
 * The spec lives in reference/component-names.md. This script parses the config
 * block out of it at runtime. Never hardcode a rule here that the spec does not
 * state.
 *
 * Usage:
 *   node scripts/validate-names.mjs [input] [options]
 *
 * Input (pick one, defaults to stdin):
 *   (stdin)                    one name per line
 *   --snapshot <path>          ds-snapshot dir or components.json
 *   --json <path>              JSON array of strings, or of objects with a name field
 *   --names "A,B,C"            comma-separated names
 *
 * Options:
 *   --spec <path>              spec file (default: ../reference/component-names.md)
 *   --format table|md|json     output format (default: table)
 *   --out <path>               write to a file instead of stdout
 *   --fails-only               omit passing names from the output
 *
 * Exit codes: 0 all passed, 1 one or more failed, 2 bad usage or unreadable input.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SPEC = resolve(HERE, "..", "reference", "component-names.md");

/* ---------------------------------------------------------------- spec ---- */

function loadSpec(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read spec at ${path}`);
  }

  const block = raw.match(/```yaml\n([\s\S]*?)```/);
  if (!block) fail(`no \`\`\`yaml config block found in ${path}`);

  const cfg = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*$/);
    if (!m) continue;
    let [, key, value] = m;
    if (/^\[.*\]$/.test(value)) {
      cfg[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
      cfg[key] = /^\d+$/.test(value) ? Number(value) : value;
    }
  }

  for (const key of ["regex", "platforms", "separator", "version"]) {
    if (cfg[key] === undefined) fail(`spec is missing "${key}"`);
  }

  try {
    cfg.compiled = new RegExp(cfg.regex);
  } catch (e) {
    fail(`spec regex does not compile: ${e.message}`);
  }
  cfg.maxLength = cfg.maxLength ?? 60;
  return cfg;
}

/* ---------------------------------------------------------- diagnostics ---- */

/** Every rule the name breaks, not just the first. */
function diagnose(name, spec) {
  const codes = [];
  const push = (c) => codes.includes(c) || codes.push(c);

  if (!name || !name.trim()) return ["empty"];
  if (name !== name.trim()) push("leading-trailing-space");
  if (name.length > spec.maxLength) push("too-long");

  const trimmed = name.trim();
  const sep = spec.separator;

  if (/[^A-Za-z0-9 \-/]/.test(trimmed)) push("invalid-character");
  if (/ {2,}/.test(trimmed)) push("double-space");
  if (/ -| - |- | \/|\/ /.test(trimmed)) push("space-around-separator");
  if (/--+/.test(trimmed)) push("double-hyphen");

  const parts = trimmed.split(sep);
  if (parts.length > 2) push("multiple-slashes");
  if (parts.length === 2 && !spec.platforms.includes(parts[1].trim())) {
    push("unknown-platform");
  }

  for (const word of parts[0].split(/ +/).filter(Boolean)) {
    if (/^-|-$/.test(word)) push("hyphen-edge");
    const first = word.replace(/^-+/, "")[0];
    if (!first) continue;
    if (/[0-9]/.test(first)) push("digit-word-start");
    else if (!/[A-Z]/.test(first)) push("lowercase-word");
  }

  // Backstop: the regex is the authority. If it rejects and nothing above
  // explained why, say so rather than reporting a clean failure.
  if (codes.length === 0 && !spec.compiled.test(name)) push("unmatched");
  return codes;
}

/* ------------------------------------------------------------ suggestion --- */

/**
 * Mechanical fixes only: whitespace, casing, separators, stray hyphens.
 * Never guesses vocabulary. Returns null when the result still fails, so a
 * suggestion is always a name that passes.
 */
function suggest(name, spec) {
  if (!name || !name.trim()) return null;
  const sep = spec.separator;

  let s = name
    .replace(/[\u2010-\u2015\u2212]/g, "-") // unicode dashes to hyphen
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/_+/g, " ")
    .trim();

  s = s
    .replace(/\s*-\s*/g, "-")
    .replace(new RegExp(`\\s*\\${sep}\\s*`, "g"), sep)
    .replace(/-{2,}/g, "-")
    .replace(/ {2,}/g, " ")
    .trim();

  const parts = s.split(sep);
  if (parts.length > 2) return null; // ambiguous, not mechanical

  let base = parts[0];
  base = base
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const core = w.replace(/^-+/, "").replace(/-+$/, "");
      if (!core) return "";
      return core.charAt(0).toUpperCase() + core.slice(1);
    })
    .filter(Boolean)
    .join(" ");

  let out = base;
  if (parts.length === 2) {
    const platform = parts[1].trim().toLowerCase();
    if (!spec.platforms.includes(platform)) return null; // cannot guess
    out = `${base}${sep}${platform}`;
  }

  if (out === name) return null;
  return spec.compiled.test(out) ? out : null;
}

/* -------------------------------------------------------- batch warnings --- */

function batchWarnings(allRows, spec) {
  const sep = spec.separator;
  const warnings = [];
  const seen = new Map();
  const bases = new Map();

  // Only valid names. Pairing an invalid name against anything produces
  // nonsense, and its real problem is already reported as a failure.
  const rows = allRows.filter((r) => r.valid);

  for (const r of rows) {
    seen.set(r.name, (seen.get(r.name) || 0) + 1);
    const [base, platform] = r.name.split(sep);
    if (!bases.has(base)) bases.set(base, new Set());
    bases.get(base).add(platform ?? null);
  }

  for (const [name, count] of seen) {
    if (count > 1) {
      warnings.push({ code: "duplicate", name, detail: `appears ${count} times` });
    }
  }

  for (const [base, variants] of bases) {
    const platforms = [...variants].filter(Boolean);
    if (platforms.length && variants.has(null)) {
      warnings.push({
        code: "bare-and-platform",
        name: base,
        detail: `bare name coexists with ${platforms.join(", ")}`,
      });
    }
    if (platforms.length === 1 && spec.platforms.length > 1) {
      const missing = spec.platforms.filter((p) => p !== platforms[0]);
      warnings.push({
        code: "orphan-platform",
        name: `${base}${sep}${platforms[0]}`,
        detail: `no ${missing.map((m) => `${base}${sep}${m}`).join(" or ")}`,
      });
    }
  }

  return warnings.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- input ------- */

function readSnapshot(path) {
  let file = path;
  try {
    if (statSync(path).isDirectory()) file = join(path, "components.json");
  } catch {
    fail(`cannot read snapshot at ${path}`);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`cannot parse ${file}: ${e.message}`);
  }
  if (!Array.isArray(data.components)) {
    fail(`${file} has no components array — is it a ds-snapshot components.json?`);
  }

  // ds-snapshot splits the Figma name: path holds the leading segments, name
  // holds the last one. The spec applies to the full name, so rejoin them.
  return data.components.map((c) => ({
    name: [...(c.path || []), c.name].join("/"),
    id: c.id,
    nodeId: c.figma?.nodeId ?? "",
    source: c.source ?? "",
  }));
}

function readJsonList(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`cannot parse ${path}: ${e.message}`);
  }
  if (!Array.isArray(data)) fail(`${path} must contain a JSON array`);
  return data.map((entry) =>
    typeof entry === "string"
      ? { name: entry }
      : { name: entry.name ?? "", nodeId: entry.nodeId ?? entry.id ?? "" }
  );
}

async function readStdin() {
  if (process.stdin.isTTY) {
    fail("no input. Pipe names on stdin, or use --snapshot / --json / --names");
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.length > 0)
    .map((name) => ({ name }));
}

/* ------------------------------------------------------------- output ------ */

function renderTable(result, failsOnly) {
  const rows = failsOnly ? result.names.filter((r) => !r.valid) : result.names;
  const lines = [];

  if (rows.length) {
    const head = ["NAME", "STATUS", "FAILED RULE", "SUGGESTION"];
    const body = rows.map((r) => [
      r.name || "(empty)",
      r.valid ? "pass" : "FAIL",
      r.codes.join(", ") || "",
      r.suggestion || "",
    ]);
    const widths = head.map((h, i) =>
      Math.max(h.length, ...body.map((b) => b[i].length))
    );
    const line = (cells) =>
      cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
    lines.push(line(head));
    lines.push(widths.map((w) => "-".repeat(w)).join("  "));
    body.forEach((b) => lines.push(line(b)));
  }

  if (result.warnings.length) {
    lines.push("");
    lines.push("WARNINGS");
    for (const w of result.warnings) {
      lines.push(`  ${w.code}  ${w.name}  ${w.detail}`);
    }
  }

  const s = result.summary;
  lines.push("");
  lines.push(
    `${s.total} checked, ${s.passed} passed, ${s.failed} failed, ` +
      `${s.suggested} fixable, ${s.warnings} warnings  (spec ${s.specVersion})`
  );
  return lines.join("\n");
}

function renderMarkdown(result, failsOnly) {
  const rows = failsOnly ? result.names.filter((r) => !r.valid) : result.names;
  const lines = ["# Component name check", ""];
  const s = result.summary;
  lines.push(
    `${s.total} checked, **${s.passed} passed**, **${s.failed} failed**, ` +
      `${s.suggested} with a suggested fix, ${s.warnings} warnings. Spec ${s.specVersion}.`,
    ""
  );

  if (rows.length) {
    lines.push("| Name | Status | Failed rule | Suggestion |");
    lines.push("|---|---|---|---|");
    for (const r of rows) {
      lines.push(
        `| \`${r.name || "(empty)"}\` | ${r.valid ? "pass" : "**FAIL**"} | ` +
          `${r.codes.join(", ") || "—"} | ${r.suggestion ? `\`${r.suggestion}\`` : "—"} |`
      );
    }
    lines.push("");
  }

  if (result.warnings.length) {
    lines.push("## Warnings", "");
    lines.push("| Code | Name | Detail |");
    lines.push("|---|---|---|");
    for (const w of result.warnings) {
      lines.push(`| ${w.code} | \`${w.name}\` | ${w.detail} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* --------------------------------------------------------------- main ----- */

function fail(msg) {
  process.stderr.write(`validate-names: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { format: "table", failsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--spec") opts.spec = next();
    else if (a === "--snapshot") opts.snapshot = next();
    else if (a === "--json") opts.json = next();
    else if (a === "--names") opts.names = next();
    else if (a === "--format") opts.format = next();
    else if (a === "--out") opts.out = next();
    else if (a === "--fails-only") opts.failsOnly = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else fail(`unknown argument "${a}"`);
  }
  if (!["table", "md", "json"].includes(opts.format)) {
    fail(`--format must be table, md, or json`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, "") + "\n");
    process.exit(0);
  }

  const spec = loadSpec(opts.spec ?? DEFAULT_SPEC);

  let input;
  if (opts.snapshot) input = readSnapshot(opts.snapshot);
  else if (opts.json) input = readJsonList(opts.json);
  else if (opts.names) input = opts.names.split(",").map((n) => ({ name: n.trim() }));
  else input = await readStdin();

  if (!input.length) fail("no names to check");

  const names = input.map((entry) => {
    const codes = diagnose(entry.name, spec);
    const valid = codes.length === 0 && spec.compiled.test(entry.name);
    return {
      name: entry.name,
      valid,
      codes: valid ? [] : codes,
      suggestion: valid ? null : suggest(entry.name, spec),
      ...(entry.id ? { id: entry.id } : {}),
      ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
      ...(entry.source ? { source: entry.source } : {}),
    };
  });

  const warnings = batchWarnings(names, spec);
  const result = {
    specVersion: String(spec.version),
    summary: {
      total: names.length,
      passed: names.filter((n) => n.valid).length,
      failed: names.filter((n) => !n.valid).length,
      suggested: names.filter((n) => n.suggestion).length,
      warnings: warnings.length,
      specVersion: String(spec.version),
    },
    names,
    warnings,
  };

  const text =
    opts.format === "json"
      ? JSON.stringify(
          opts.failsOnly
            ? { ...result, names: result.names.filter((n) => !n.valid) }
            : result,
          null,
          2
        )
      : opts.format === "md"
      ? renderMarkdown(result, opts.failsOnly)
      : renderTable(result, opts.failsOnly);

  if (opts.out) {
    writeFileSync(opts.out, text.endsWith("\n") ? text : text + "\n");
    process.stderr.write(`wrote ${opts.out}\n`);
  } else {
    process.stdout.write(text + "\n");
  }

  process.exit(result.summary.failed > 0 ? 1 : 0);
}

main();
