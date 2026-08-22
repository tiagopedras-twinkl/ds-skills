#!/usr/bin/env node
// Validates a parity run against ds-inventory/parity/CONTRACT.md, and the rules
// that produced it against reality. Ships with the ds-parity-run skill, beside
// the scorer whose output it checks.
//
// The check that earns this script is the dead-rule warning. An exception that
// no longer matches anything is how a real gap hides: somebody excuses Figma's
// `Breakpoint` axis, the axis is later renamed, and the exception keeps quietly
// excusing nothing while the renamed axis goes unscored.
//
// Usage, run from ds-inventory:
//   node <ds-skills>/skills/ds-parity-run/scripts/validate-parity.mjs \
//     <run-dir> <rules-file> <records-dir>

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { parseYamlLite } from "./lib/yaml-lite.mjs";

const CONTRACT_VERSION = "1.2.0";
const OUTCOMES = new Set(["pass", "fail", "na", "unmeasurable"]);
const CHECKS = ["exists", "named", "complete", "consistent", "looksRight"];
const PAIRS = ["figma-web", "figma-mobile", "web-mobile"];

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const [, , runDir, rulesFile, recordsDir] = process.argv;
if (!runDir || !rulesFile || !recordsDir) {
  console.error("Usage: node validate-parity.mjs <run-dir> <rules-file> <records-dir>");
  process.exit(1);
}

const run = JSON.parse(readFileSync(join(runDir, "parity.json"), "utf8"));

// Validate the rules the run actually used, not whatever the live file says now.
// A run is checked against its own inputs or the check means nothing.
const copyPath = join(runDir, "rules-used.yaml");
let rulesSource = copyPath;
if (!existsSync(copyPath)) {
  err(`${copyPath} is missing — the run did not keep a copy of the rules that produced it`);
  rulesSource = rulesFile;
}
const rulesText = readFileSync(rulesSource, "utf8");
const rules = parseYamlLite(rulesText, rulesSource);

const copyHash = createHash("sha256").update(rulesText).digest("hex").slice(0, 12);
if (run.inputs?.rulesHash && run.inputs.rulesHash !== copyHash)
  err(`rulesHash in parity.json is ${run.inputs.rulesHash} but rules-used.yaml hashes to ${copyHash}`);

if (existsSync(rulesFile)) {
  const liveHash = createHash("sha256").update(readFileSync(rulesFile, "utf8")).digest("hex").slice(0, 12);
  if (run.inputs?.rulesHash && liveHash !== run.inputs.rulesHash)
    warn(`the live rules (${liveHash}) differ from the ones this run used (${run.inputs.rulesHash}) — re-score before quoting these numbers`);
}

if (run.inputs?.rulesVersion == null) err("inputs.rulesVersion is missing — a run must name which rules produced it");
if (run.inputs?.rulesUpdatedOn == null) warn("inputs.rulesUpdatedOn is null — a version with no date is hard to place later");

// The check that makes a hand-set version trustworthy. Compare against the most
// recent earlier run: if the rules changed and the version did not, every
// comparison between the two runs is silently wrong, because the same version
// number describes two different sets of exceptions.
const runsDir = dirname(runDir);
const thisRun = basename(runDir);
let previous = null;
try {
  previous = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < thisRun)
    .map((d) => d.name)
    .sort()
    .pop();
} catch {
  /* no runs folder to compare against */
}
if (previous) {
  try {
    const prev = JSON.parse(readFileSync(join(runsDir, previous, "parity.json"), "utf8")).inputs || {};
    const sameHash = prev.rulesHash === run.inputs?.rulesHash;
    const sameVersion = prev.rulesVersion === run.inputs?.rulesVersion;
    if (!sameHash && sameVersion)
      err(
        `rules changed since ${previous} (${prev.rulesHash} → ${run.inputs.rulesHash}) but rulesVersion is still ${run.inputs.rulesVersion} — bump it in parity/rules.yaml, or the two runs cannot be compared`
      );
    if (sameHash && !sameVersion)
      warn(`rulesVersion moved ${prev.rulesVersion} → ${run.inputs.rulesVersion} since ${previous} but the rules are identical`);
    if (!sameHash && !sameVersion) console.log(`  note     rules v${prev.rulesVersion} → v${run.inputs.rulesVersion} since ${previous}; diff rules-used.yaml to see what changed`);
  } catch {
    warn(`could not read the previous run (${previous}) to compare rules against`);
  }
}

// ── the run itself ──────────────────────────────────────────────────────────
if (run.contractVersion !== CONTRACT_VERSION)
  err(`contractVersion is ${run.contractVersion}, this validator knows ${CONTRACT_VERSION}`);

const weightSum = Object.values(run.weights || {}).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1) > 1e-9) err(`weights sum to ${weightSum}, must sum to 1`);
for (const c of CHECKS) if (!(c in (run.weights || {}))) err(`no weight declared for check "${c}"`);

for (const key of ["figmaSnapshot", "webSnapshot", "appSnapshot", "rules"])
  if (!run.inputs?.[key]) err(`inputs.${key} is missing — a run must name every source it read`);
for (const key of ["webGeneratedAt", "appGeneratedAt"])
  if (!run.inputs?.[key]) warn(`inputs.${key} is null — a run without its source's capture date cannot be compared to another`);

if (run.headline !== null && !run.headlineNote) err("a headline figure is published with no note saying what it covers");

const headlineWeightSum = Object.values(run.headlineWeights || {}).reduce((a, b) => a + b, 0);
if (run.headlineWeights && Math.abs(headlineWeightSum - 1) > 1e-9) err(`headlineWeights sum to ${headlineWeightSum}, must sum to 1`);
for (const pair of PAIRS) {
  const h = run.headline?.[pair];
  if (h !== null && h !== undefined && (typeof h !== "number" || h < 0 || h > 100)) err(`headline.${pair} is ${h}, expected null or a number 0–100`);
}

// ── every record, every pair, every check ───────────────────────────────────
const onDisk = new Set(readdirSync(recordsDir).filter((f) => f.endsWith(".yaml")).map((f) => basename(f, ".yaml")));
for (const r of run.records || []) {
  if (!onDisk.has(r.id)) err(`${r.id}: scored but no record exists on disk`);
  for (const pair of PAIRS) {
    const p = r.pairs?.[pair];
    if (!p) {
      err(`${r.id}: no result for pair ${pair}`);
      continue;
    }
    for (const c of CHECKS) {
      const res = p.checks?.[c]?.result;
      if (!OUTCOMES.has(res)) err(`${r.id} ${pair} ${c}: "${res}" is not a valid outcome`);
    }
    // The contract's one gating rule: nothing above Exists is scored when it fails.
    if (p.checks?.exists?.result === "fail")
      for (const c of ["named", "complete", "consistent", "looksRight"])
        if (["pass", "fail"].includes(p.checks[c]?.result))
          err(`${r.id} ${pair}: Exists failed but ${c} was scored ${p.checks[c].result}`);
    // A pass hiding unjudged options is legal but must never be silent.
    for (const c of ["complete", "consistent"]) {
      const chk = p.checks?.[c];
      if (chk?.result === "pass" && chk.counts?.unmeasurable > 0)
        warn(`${r.id} ${pair} ${c}: reads "pass" with ${chk.counts.unmeasurable} option(s) unjudged`);
    }
  }
}

// ── did every rule actually match something? ────────────────────────────────
const allNotes = [];
for (const r of run.records || [])
  for (const pair of PAIRS) {
    const p = r.pairs[pair];
    for (const c of CHECKS) for (const n of p.checks?.[c]?.notes || []) allNotes.push(n);
    for (const a of p.axes || []) {
      for (const n of a.notes || []) allNotes.push(n);
      for (const o of a.options || []) for (const n of o.notes || []) allNotes.push(n);
    }
  }
const detailsFor = (code) => allNotes.filter((n) => n.code === code).map((n) => String(n.detail ?? ""));
const fold = (s) => String(s).trim().toLowerCase();

const designOnly = detailsFor("design-only").map(fold);
for (const v of rules.designOnlyValues || [])
  if (!designOnly.some((d) => d.endsWith(`=${fold(v)}`))) warn(`rules: designOnlyValues "${v}" excused nothing in this run`);
for (const a of rules.designOnlyAxes || [])
  if (!designOnly.some((d) => d.startsWith(`${fold(a)}=`))) warn(`rules: designOnlyAxes "${a}" excused nothing in this run`);

const shortened = detailsFor("declared-equivalent").map(fold);
for (const e of rules.valueEquivalents || [])
  if (!shortened.some((d) => d.startsWith(`${fold(e.figma)} `))) warn(`rules: valueEquivalents "${e.figma} → ${e.code}" matched nothing in this run`);

const absence = detailsFor("satisfied-by-absence").map(fold);
for (const v of rules.impliedByAbsence || [])
  if (!absence.some((d) => d.endsWith(`=${fold(v)}`))) warn(`rules: impliedByAbsence "${v}" covered nothing in this run`);

const named = [...detailsFor("different-name"), ...detailsFor("case-only-difference")].map(fold);
for (const e of rules.axisEquivalents || [])
  if (!named.some((d) => d.startsWith(`${fold(e.figma)}=`))) warn(`rules: axisEquivalents "${e.figma} → ${e.code}" matched nothing in this run`);

// ── per-record exceptions that name something Figma does not have ───────────
const figmaAxesOf = new Map();
for (const r of run.records || []) {
  const axes = new Set();
  for (const pair of PAIRS) for (const a of r.pairs[pair].axes || []) if (a.figmaAxis) axes.add(fold(a.figmaAxis));
  figmaAxesOf.set(r.id, axes);
}
for (const id of run.scope?.records || []) {
  let rec;
  try {
    rec = parseYamlLite(readFileSync(join(recordsDir, `${id}.yaml`), "utf8"), id);
  } catch {
    continue;
  }
  for (const ex of rec.parityExpected?.axisExceptions || []) {
    const axis = fold(String(ex).split(".")[0]);
    if (!figmaAxesOf.get(id)?.has(axis)) warn(`${id}: axisException "${ex}" names an axis this component does not have in Figma`);
  }
  for (const surface of ["figma", "web", "mobile"]) {
    const v = rec.parityExpected?.[surface];
    if (v !== undefined && !["yes", "no", "undecided"].includes(String(v)))
      err(`${id}: parityExpected.${surface} is "${v}" — must be yes, no or undecided`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nvalidating ${runDir} against contract ${CONTRACT_VERSION}`);
console.log(`${run.records?.length ?? 0} record(s), ${allNotes.length} note(s)\n`);
for (const w of warnings) console.log(`  warning  ${w}`);
for (const e of errors) console.log(`  ERROR    ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) {
  console.log("Errors block. Fix them and re-run the scorer.");
  process.exit(1);
}
console.log("Run is valid. Warnings do not block but every one is worth reading.");
