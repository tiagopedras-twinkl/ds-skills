#!/usr/bin/env node
/**
 * validate-design-md.mjs — structural check for a DESIGN-*.md file.
 *
 * This is NOT a full YAML/Markdown parser. It checks the shape a design.md
 * file is supposed to have — see ../reference/format-spec.md for the
 * authority — using line-based pattern matching. That's enough to catch the
 * mistakes that actually recur (a missing frontmatter key, a raw hex sitting
 * inside `components:`, a skipped required section, sections out of order)
 * without pulling in a YAML dependency for a one-shot check.
 *
 * Usage:
 *   node validate-design-md.mjs <path/to/DESIGN-name.md>
 *
 * Exit 0 with warnings allowed; exit 1 if any error is found.
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node validate-design-md.mjs <path/to/DESIGN-name.md>");
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(path, "utf8");
} catch (err) {
  console.error(`Could not read ${path}: ${err.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];

// ---------------------------------------------------------------------------
// Split frontmatter from body
// ---------------------------------------------------------------------------

const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
if (!fmMatch) {
  errors.push("No YAML frontmatter found (expected `---` ... `---` at the top of the file).");
  report();
  process.exit(1);
}
const [, frontmatter, body] = fmMatch;

// ---------------------------------------------------------------------------
// Frontmatter: required top-level keys, in order
// ---------------------------------------------------------------------------

const REQUIRED_FM_KEYS = [
  "version",
  "name",
  "description",
  "colors",
  "typography",
  "rounded",
  "spacing",
  "components",
];

// A top-level key starts at column 0. Indented lines (nested values) don't count.
const fmLines = frontmatter.split(/\r?\n/);
const topLevelKeys = [];
for (const line of fmLines) {
  const m = line.match(/^([a-zA-Z][\w-]*):/);
  if (m) topLevelKeys.push(m[1]);
}

for (const key of REQUIRED_FM_KEYS) {
  if (!topLevelKeys.includes(key)) {
    errors.push(`Frontmatter is missing required key \`${key}:\`.`);
  }
}

const presentRequired = REQUIRED_FM_KEYS.filter((k) => topLevelKeys.includes(k));
const presentIndices = presentRequired.map((k) => topLevelKeys.indexOf(k));
const orderOk = presentIndices.every((idx, i) => i === 0 || idx > presentIndices[i - 1]);
if (!orderOk) {
  warnings.push(`Frontmatter keys are present but not in the canonical order (${REQUIRED_FM_KEYS.join(", ")}).`);
}

// description sanity: non-trivial length, single line or folded scalar
const descMatch = frontmatter.match(/^description:\s*(.*)$/m);
if (descMatch && descMatch[1].replace(/^["']|["']$/g, "").trim().length < 60) {
  warnings.push(
    "`description` looks short for a stand-alone brief — the format expects one dense paragraph naming the canvas colour, the accent, the type voice, and what makes the system recognisable."
  );
}

// colors/typography/rounded/spacing/components: each must have at least one
// indented (nested) line before the next top-level key.
function blockFor(key) {
  const startIdx = fmLines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (startIdx === -1) return null;
  const rest = fmLines.slice(startIdx + 1);
  const endOffset = rest.findIndex((l) => /^[a-zA-Z][\w-]*:/.test(l));
  const block = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return block;
}

for (const key of ["colors", "typography", "rounded", "spacing", "components"]) {
  const block = blockFor(key);
  if (block === null) continue; // already reported as missing above
  const nonEmpty = block.some((l) => l.trim().length > 0);
  if (!nonEmpty) {
    errors.push(`\`${key}:\` is present but empty.`);
  }
}

// components: block should reference tokens, not raw hex, for style-ish props
const componentsBlock = blockFor("components");
if (componentsBlock) {
  const styleProp = /^\s*(backgroundColor|textColor|borderColor|color|fill|activeIndicator|headerBackground)\s*:\s*"?#[0-9a-fA-F]{3,8}\b/;
  componentsBlock.forEach((line) => {
    if (styleProp.test(line)) {
      warnings.push(
        `components: has a raw hex value — \`${line.trim()}\` — style properties should reference a token (\`{colors.x}\`) instead of an inline hex.`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Body: required and recommended H2 sections, in canonical relative order
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = [
  { name: "Overview", pattern: /^## Overview\b/m },
  { name: "Colors", pattern: /^## Colors\b/m },
  { name: "Typography", pattern: /^## Typography\b/m },
  { name: "Layout", pattern: /^## Layout\b/m },
  { name: "Elevation", pattern: /^## Elevation\b/m }, // matches "Elevation" and "Elevation & Depth"
  { name: "Components", pattern: /^## Components\b/m },
];

const RECOMMENDED_SECTIONS = [
  { name: "Shapes", pattern: /^## Shapes\b/m },
  { name: "Do's and Don'ts", pattern: /^## Do.s and Don.ts\b/m },
  { name: "Responsive Behavior", pattern: /^## Responsive Behavior\b/m },
  { name: "Known Gaps", pattern: /^## Known Gaps\b/m },
];

const bodyHeadings = [...body.matchAll(/^## (.+)$/gm)].map((m) => ({
  text: m[1].trim(),
  index: m.index,
}));

for (const section of REQUIRED_SECTIONS) {
  if (!section.pattern.test(body)) {
    errors.push(`Body is missing required section \`## ${section.name}\`.`);
  }
}

for (const section of RECOMMENDED_SECTIONS) {
  if (!section.pattern.test(body)) {
    warnings.push(
      `Body has no \`## ${section.name}\` section. Common in this format but not universal — skip it only when it genuinely doesn't apply, not because the source was thin.`
    );
  }
}

// Relative order check across whichever of the canonical sections are present
const CANONICAL_ORDER = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation",
  "Shapes",
  "Components",
  "Do's and Don'ts",
  "Responsive Behavior",
  "Iteration Guide",
  "Known Gaps",
];

function canonicalIndex(headingText) {
  // Match "Elevation" and "Elevation & Depth" to the same canonical slot, etc.
  const idx = CANONICAL_ORDER.findIndex((c) => headingText.startsWith(c));
  return idx;
}

const presentCanonical = bodyHeadings
  .map((h) => ({ ...h, canon: canonicalIndex(h.text) }))
  .filter((h) => h.canon !== -1);

for (let i = 1; i < presentCanonical.length; i++) {
  if (presentCanonical[i].canon < presentCanonical[i - 1].canon) {
    warnings.push(
      `Section \`## ${presentCanonical[i].text}\` appears before \`## ${presentCanonical[i - 1].text}\`, out of the spec's canonical order.`
    );
  }
}

// Known Gaps, when present, should be the last canonical section
const knownGapsHeading = bodyHeadings.find((h) => h.text.startsWith("Known Gaps"));
if (knownGapsHeading) {
  const last = bodyHeadings[bodyHeadings.length - 1];
  if (last.text !== knownGapsHeading.text) {
    warnings.push("`## Known Gaps` is present but isn't the last section in the file.");
  }
}

// ---------------------------------------------------------------------------
// :hover check — the format never documents it
// ---------------------------------------------------------------------------

if (/:hover\b/.test(raw) || /\bhover state\b/i.test(body)) {
  warnings.push(
    "File mentions `:hover` or a hover state. This format documents Default and Active/Pressed only — check this wasn't meant to be dropped."
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report() {
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✓ ${path} — structurally valid, no warnings.`);
    return;
  }
  if (errors.length) {
    console.log(`✗ ${path} — ${errors.length} error(s):`);
    for (const e of errors) console.log(`  - ${e}`);
  }
  if (warnings.length) {
    console.log(`${errors.length ? "" : "✓ (with warnings) "}${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

report();
process.exit(errors.length ? 1 : 0);
