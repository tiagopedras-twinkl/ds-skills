#!/usr/bin/env node
// Scores design/code parity per pair, per check, against the contract in
// ds-inventory/rules/parity-contract.md. Ships with the ds-process-snapshots skill rather
// than with the data it reads: the contract, the rules and the runs are
// ds-inventory's, the machinery that applies them is the skill's. Every path it
// touches arrives as an argument, so it never assumes where it was installed.
//
// Matching works option by option, not choice-set by choice-set. Figma's `State`
// set and the code's `disabled` / `selected` / `error` settings describe the same
// thing at different granularities, so insisting the sets line up before looking
// inside them threw away answers that were already available. Each Figma option
// is matched against the whole pool of code settings and their values instead.
//
// Usage, run from ds-inventory:
//   node <ds-skills>/skills/ds-process-snapshots/scripts/score-parity.mjs \
//     <figma-dir> <web-dir> <app-dir> <records-dir> <rules-file> <out-dir> \
//     [--mirror <second-out-dir>] [id ...]
//
// --mirror writes an identical second copy of parity.json, rules-used.yaml and
// findings.md to another folder — used to land the same run in snapshots/parity
// alongside the ds-inventory copy that stays the source of truth. It is a copy,
// not a second computation: both files come from one score, one rules read.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseYamlLite } from "./lib/yaml-lite.mjs";

const CONTRACT_VERSION = "1.2.0";
const PAIRS = ["figma-web", "figma-mobile", "web-mobile"];
const CHECKS = ["exists", "named", "complete", "consistent", "looksRight"];
// Looks right (0.20) has no working check yet — no comparable capture exists
// on both sides for anyone. Disabled means it neither gates nor contributes:
// the remaining four weights are renormalised to sum to 1 on their own.
const ACTIVE_CHECKS = ["exists", "named", "complete", "consistent"];
const WEIGHTS = { exists: 0.35, complete: 0.3, looksRight: 0.2, consistent: 0.1, named: 0.05 };
const ACTIVE_WEIGHT_SUM = ACTIVE_CHECKS.reduce((sum, c) => sum + WEIGHTS[c], 0);
const HEADLINE_WEIGHTS = Object.fromEntries(ACTIVE_CHECKS.map((c) => [c, WEIGHTS[c] / ACTIVE_WEIGHT_SUM]));

const [, , figmaDir, webDir, appDir, recordsDir, rulesFile, outDir, ...rest] = process.argv;
if (!figmaDir || !webDir || !appDir || !recordsDir || !rulesFile || !outDir) {
  console.error("Usage: node score-parity.mjs <figma-dir> <web-dir> <app-dir> <records-dir> <rules-file> <out-dir> [--mirror <dir>] [id ...]");
  process.exit(1);
}
const mirrorAt = rest.indexOf("--mirror");
const mirrorDir = mirrorAt === -1 ? null : rest[mirrorAt + 1];
if (mirrorAt !== -1 && !mirrorDir) {
  console.error("--mirror needs a folder after it");
  process.exit(1);
}
const onlyIds = mirrorAt === -1 ? rest : [...rest.slice(0, mirrorAt), ...rest.slice(mirrorAt + 2)];

// ── sources ─────────────────────────────────────────────────────────────────
const figmaComponents = JSON.parse(readFileSync(join(figmaDir, "components.json"), "utf8")).components;
const readCode = (dir) => {
  const load = (f) => {
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      return { items: [] };
    }
  };
  const c = load("components.json");
  return { generatedAt: c.generatedAt ?? null, items: [...(c.items || []), ...(load("modules.json").items || [])] };
};
const web = readCode(webDir);
const app = readCode(appDir);
const rulesText = readFileSync(rulesFile, "utf8");
const rulesHash = createHash("sha256").update(rulesText).digest("hex").slice(0, 12);
const rules = parseYamlLite(rulesText, rulesFile);
const figmaByKey = new Map(figmaComponents.filter((c) => c.figma?.key).map((c) => [c.figma.key, c]));

// ── matching helpers ────────────────────────────────────────────────────────
const fold = (s) => String(s).trim().toLowerCase();
const squash = (s) => fold(s).replace(/[^a-z0-9]/g, "");
const set = (a) => new Set((a || []).map(fold));

const designOnlyValues = set(rules.designOnlyValues);
const designOnlyAxes = set(rules.designOnlyAxes);
const impliedByAbsence = set(rules.impliedByAbsence);
const axisEquivalents = (rules.axisEquivalents || []).map((e) => ({ figma: fold(e.figma), code: fold(e.code) }));
const equivalencePairs = (rules.valueEquivalents || []).map((e) => [fold(e.figma), fold(e.code)]);
const declaredEquivalent = (a, b) => {
  const [x, y] = [fold(a), fold(b)];
  return equivalencePairs.some(([f, c]) => (f === x && c === y) || (f === y && c === x));
};
const note = (code, detail) => (detail === undefined ? { code } : { code, detail });

function compareName(a, b) {
  if (a == null || b == null) return { result: "unmeasurable", notes: [note("no-source")] };
  if (a === b) return { result: "pass", notes: [] };
  if (fold(a) === fold(b)) return { result: "pass", notes: [note("case-only-difference", `${a} → ${b}`)] };
  if (squash(a) === squash(b)) return { result: "fail", notes: [note("separator-only-difference", `${a} → ${b}`)] };
  if (declaredEquivalent(a, b)) return { result: "pass", notes: [note("declared-equivalent", `${a} → ${b}`)] };
  return { result: "fail", notes: [note("different-name", `${a} → ${b}`)] };
}

// A flat pool of everything the code side offers: every setting name, and every
// value of every setting. This is what an option is matched against.
function codePool(argTypes) {
  const settings = [];
  for (const [name, spec] of Object.entries(argTypes || {})) {
    const options = Array.isArray(spec?.options) ? spec.options : null;
    settings.push({ name, options });
  }
  return settings;
}

// Finds the best match for one Figma option, in order of how much it proves.
function findMatch(axisName, value, pool, isBoolean) {
  if (isBoolean) {
    // True/False tells us nothing. The only thing to match is the set's name.
    const eq = axisEquivalents.find((e) => e.figma === fold(axisName));
    const target = eq ? eq.code : fold(axisName);
    const hit = pool.find((s) => fold(s.name) === target || squash(s.name) === squash(target));
    return hit ? { kind: "setting", where: hit.name, exact: false } : null;
  }
  // A value of a setting, in a setting whose name matches the Figma set.
  for (const s of pool.filter((s) => fold(s.name) === fold(axisName) && s.options)) {
    const exact = s.options.find((o) => o === value);
    if (exact !== undefined) return { kind: "value", where: s.name, value: exact, exact: true };
  }
  // A value of any setting.
  for (const s of pool.filter((s) => s.options)) {
    const exact = s.options.find((o) => o === value);
    if (exact !== undefined) return { kind: "value", where: s.name, value: exact, exact: true };
  }
  for (const s of pool.filter((s) => s.options)) {
    const folded = s.options.find((o) => fold(o) === fold(value));
    if (folded !== undefined) return { kind: "value", where: s.name, value: folded, exact: false, caseOnly: true };
  }
  // A setting named after the option — Figma "Disabled" against a `disabled` flag.
  const asSetting = pool.find((s) => fold(s.name) === fold(value));
  if (asSetting) return { kind: "setting", where: asSetting.name, exact: false, caseOnly: fold(asSetting.name) === fold(value) };
  // Declared abbreviation, e.g. Large against lg.
  for (const s of pool.filter((s) => s.options)) {
    const equiv = s.options.find((o) => declaredEquivalent(o, value));
    if (equiv !== undefined) return { kind: "value", where: s.name, value: equiv, exact: false, viaRule: true };
  }
  if (impliedByAbsence.has(fold(value))) return { kind: "absence", where: null, exact: false, viaRule: true };
  return null;
}

function matchOptions(figmaVariants, argTypes, perRecordExceptions) {
  const axes = [];
  const tally = { complete: { pass: 0, fail: 0, na: 0, unmeasurable: 0 }, consistent: { pass: 0, fail: 0, na: 0, unmeasurable: 0 } };
  const except = set(perRecordExceptions);
  const pool = codePool(argTypes);
  const usedSettings = new Set();

  for (const [axisName, figmaValues] of Object.entries(figmaVariants || {})) {
    const axis = { figmaAxis: axisName, matchedIn: [], options: [], notes: [] };
    const axisExcused = designOnlyAxes.has(fold(axisName)) || except.has(fold(axisName));
    const isBoolean = figmaValues.every((v) => ["true", "false"].includes(fold(v)));

    for (const v of figmaValues) {
      const opt = { figmaValue: v, matchedTo: null, complete: null, consistent: null, notes: [] };
      const excused = axisExcused || designOnlyValues.has(fold(v)) || except.has(fold(`${axisName}.${v}`));

      if (excused) {
        opt.complete = "na";
        opt.consistent = "na";
        opt.notes.push(note(axisExcused && !designOnlyValues.has(fold(v)) ? "design-only" : "design-only", `${axisName}=${v}`));
      } else {
        const m = findMatch(axisName, v, pool, isBoolean);
        if (!m) {
          opt.complete = "fail";
          opt.consistent = "fail";
          opt.notes.push(note("option-missing-in-code", `${axisName}=${v}`));
        } else {
          opt.matchedTo = m.kind === "value" ? `${m.where}=${m.value}` : m.kind === "absence" ? "(absence of a setting)" : m.where;
          if (m.where) usedSettings.add(fold(m.where));
          opt.complete = "pass";
          if (m.exact) {
            opt.consistent = "pass";
          } else if (m.caseOnly) {
            opt.consistent = "pass";
            opt.notes.push(note("case-only-difference", `${v} → ${opt.matchedTo}`));
          } else if (m.kind === "absence") {
            opt.consistent = "pass";
            opt.notes.push(note("satisfied-by-absence", `${axisName}=${v}`));
          } else if (m.viaRule) {
            opt.consistent = "fail";
            opt.notes.push(note("declared-equivalent", `${v} → ${opt.matchedTo}`));
          } else {
            opt.consistent = "fail";
            opt.notes.push(note("different-name", `${axisName}=${v} → ${opt.matchedTo}`));
          }
        }
      }
      tally.complete[opt.complete]++;
      tally.consistent[opt.consistent]++;
      axis.options.push(opt);
    }
    axis.matchedIn = [...new Set(axis.options.filter((o) => o.matchedTo).map((o) => String(o.matchedTo).split("=")[0]))];
    axes.push(axis);
  }

  const codeOnly = pool.filter((s) => s.options && !usedSettings.has(fold(s.name))).map((s) => s.name);
  return { axes, tally, codeOnly };
}

// web-mobile compares two code sides. Web's settings are treated as the declared
// side; mobile-only settings are reported, not scored.
function matchCodeToCode(webArgs, appArgs) {
  const shim = {};
  for (const [name, spec] of Object.entries(webArgs || {})) {
    if (Array.isArray(spec?.options)) shim[name] = spec.options;
  }
  return matchOptions(shim, appArgs, []);
}

const rollUp = (t) => {
  const scored = t.pass + t.fail;
  if (scored === 0) {
    // Nothing was scored. If nothing was excused and nothing was unanswerable
    // either, the component simply declares no options — a plain component
    // rather than a set. That is not a missing source, so it is n/a.
    if (t.unmeasurable > 0) return "unmeasurable";
    return "na";
  }
  return t.fail === 0 ? "pass" : "fail";
};

// ── per-record scoring ──────────────────────────────────────────────────────
function scoreRecord(rec) {
  const figma = rec.figma?.figmaKey ? figmaByKey.get(rec.figma.figmaKey) : null;
  const figmaName = rec.figma?.name ?? null;
  const expected = rec.parityExpected || { figma: "yes", web: "yes", mobile: "yes" };
  const exceptions = expected.axisExceptions || [];
  const codeEntries = Array.isArray(rec.code) ? rec.code : [];

  const lookup = (items, n) => (n == null ? null : items.find((i) => squash(i.name) === squash(n)) || null);
  const side = (platform, items) => {
    const entry = codeEntries.find((c) => c.platform === platform) || null;
    const declared = entry && entry.match !== "none" ? entry.name : null;
    let item = lookup(items, declared);
    const behind = !item && !declared && !!lookup(items, figmaName);
    if (behind) item = lookup(items, figmaName);
    return { item, behind, declared };
  };
  const w = side("web", web.items);
  const m = side("mobile", app.items);

  const present = { figma: !!figma, web: !!w.item, mobile: !!m.item };
  const nameOf = { figma: figmaName, web: w.item?.name ?? null, mobile: m.item?.name ?? null };
  const pairs = {};

  for (const pair of PAIRS) {
    const [left, right] = pair.split("-");
    const p = { expected: null, checks: {}, axes: [], codeOnlySettings: [] };
    const exp = [expected[left], expected[right]];
    p.expected = exp.includes("no") ? "no" : exp.includes("undecided") ? "undecided" : "yes";

    if (p.expected === "no") {
      for (const c of CHECKS) p.checks[c] = { result: "na", notes: [note("surface-not-expected", pair)] };
      pairs[pair] = p;
      continue;
    }

    const both = present[left] && present[right];
    p.checks.exists = {
      result: both ? "pass" : "fail",
      notes: both ? [] : [note("component-absent", `not built on ${present[left] ? right : left}`)],
      detail: { [left]: present[left], [right]: present[right] },
    };
    if (!both) {
        for (const c of ["named", "complete", "consistent", "looksRight"]) p.checks[c] = { result: "na", notes: [note("not-built", "component absent; nothing to compare")] };
      pairs[pair] = p;
      continue;
    }

    p.checks.named = compareName(nameOf[left], nameOf[right]);

    let r;
    if (pair === "figma-web") r = matchOptions(figma.variants, w.item.argTypes, exceptions);
    else if (pair === "figma-mobile") r = matchOptions(figma.variants, m.item.argTypes, exceptions);
    else r = matchCodeToCode(w.item.argTypes, m.item.argTypes);

    p.axes = r.axes;
    p.codeOnlySettings = r.codeOnly;
    p.checks.complete = { result: rollUp(r.tally.complete), counts: r.tally.complete, notes: [] };
    p.checks.consistent = { result: rollUp(r.tally.consistent), counts: r.tally.consistent, notes: [] };
    p.checks.looksRight = { result: "unmeasurable", notes: [note("no-source", "no comparable capture on both sides")] };
    pairs[pair] = p;
  }

  return {
    id: rec.id,
    figmaName,
    webName: nameOf.web,
    mobileName: nameOf.mobile,
    webStatus: w.item?.parameters?.docsHeader?.status ?? null, // recorded, never scored
    recordBehindSnapshot: [w.behind && "web", m.behind && "mobile"].filter(Boolean),
    pairs,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
const wanted = new Set(onlyIds);
const records = [];
for (const file of readdirSync(recordsDir).filter((f) => f.endsWith(".yaml"))) {
  if (wanted.size && !wanted.has(basename(file, ".yaml"))) continue;
  const rec = parseYamlLite(readFileSync(join(recordsDir, file), "utf8"), file);
  if (["component", "module"].includes(rec.kind)) records.push(rec);
}
const scored = records.map(scoreRecord);

const totals = {};
for (const pair of PAIRS) {
  totals[pair] = {};
  for (const check of CHECKS) {
    const t = { pass: 0, fail: 0, na: 0, unmeasurable: 0 };
    for (const r of scored) t[r.pairs[pair].checks[check].result]++;
    totals[pair][check] = t;
  }
}

// ── headline, per pair ───────────────────────────────────────────────────────
// One record's pair only counts once none of the active checks came back
// unmeasurable — a missing source disqualifies the whole instance rather than
// being silently dropped from just its own check. `na` checks (excused, or
// unreachable because the component doesn't exist) leave that instance's own
// denominator, same rule the individual checks use.
const headline = {};
const headlineCounts = {};
for (const pair of PAIRS) {
  let sum = 0;
  let eligible = 0;
  let disqualified = 0;
  for (const r of scored) {
    const checks = r.pairs[pair].checks;
    if (ACTIVE_CHECKS.some((c) => checks[c].result === "unmeasurable")) {
      disqualified++;
      continue;
    }
    const scoredChecks = ACTIVE_CHECKS.filter((c) => checks[c].result === "pass" || checks[c].result === "fail");
    if (!scoredChecks.length) continue; // every active check n/a for this instance
    eligible++;
    const weightSum = scoredChecks.reduce((s, c) => s + HEADLINE_WEIGHTS[c], 0);
    sum += scoredChecks.reduce((s, c) => s + HEADLINE_WEIGHTS[c] * (checks[c].result === "pass" ? 1 : 0), 0) / weightSum;
  }
  headline[pair] = eligible ? Math.round((sum / eligible) * 1000) / 10 : null;
  headlineCounts[pair] = { eligible, disqualified, excluded: scored.length - eligible - disqualified };
}

const out = {
  contractVersion: CONTRACT_VERSION,
  generatedAt: new Date().toISOString().slice(0, 10),
  inputs: {
    figmaSnapshot: figmaDir,
    webSnapshot: webDir,
    webGeneratedAt: web.generatedAt,
    appSnapshot: appDir,
    appGeneratedAt: app.generatedAt,
    rules: rulesFile,
    rulesVersion: rules.rulesVersion ?? null,
    rulesUpdatedOn: rules.rulesUpdatedOn ?? null,
    rulesHash,
    rulesCopy: "rules-used.yaml",
  },
  scope: { records: scored.map((r) => r.id), note: wanted.size ? "scoped to a test sample" : "all components and modules" },
  weights: WEIGHTS,
  headlineWeights: HEADLINE_WEIGHTS,
  headline,
  headlineCounts,
  headlineNote:
    "Looks right (weight 0.20) is disabled — no comparable capture exists on both sides yet. It neither gates nor " +
    "contributes; the other four weights are renormalised across themselves (see headlineWeights). One figure per " +
    "surface pair, never blended across all three, matching CONTRACT.md's rule that parity is scored per pair.",
  totals,
  records: scored,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "parity.json"), JSON.stringify(out, null, 2) + "\n");
// The rules are half of what produced these numbers. A path to a file that has
// since been edited proves nothing, so the run keeps its own copy.
writeFileSync(join(outDir, "rules-used.yaml"), rulesText);

// ── findings.md ─────────────────────────────────────────────────────────────
const LABELS = {
  "component-absent": "Not built on that surface",
  "option-missing-in-code": "Option with no equivalent on the other side",
  "option-only-in-code": "Exists in code, not in the other side",
  "different-name": "Called something different",
  "separator-only-difference": "Same words, different spacing",
  "case-only-difference": "Same word, different case",
  "declared-equivalent": "Shortened in code",
  "satisfied-by-absence": "Covered by a setting simply not being on",
  "design-only": "Design-only, excused",
  "surface-not-expected": "Not expected on this surface",
  "no-source": "Nothing to compare against",
  "not-built": null, // already reported under "Not built on that surface"
};
const grouped = new Map();
const add = (code, line) => {
  if (!grouped.has(code)) grouped.set(code, new Set());
  grouped.get(code).add(line);
};
for (const r of scored) {
  for (const pair of PAIRS) {
    const p = r.pairs[pair];
    for (const n of p.checks.named?.notes || []) if (n.detail) add(n.code, `${r.figmaName} [${pair}] — ${n.detail}`);
    if (p.checks.exists.result === "fail") add("component-absent", `${r.figmaName} [${pair}] — ${p.checks.exists.notes[0].detail}`);
    for (const a of p.axes)
      for (const o of a.options) for (const n of o.notes) add(n.code, `${r.figmaName} [${pair}] — ${n.detail}`);
    if (p.codeOnlySettings?.length) add("option-only-in-code", `${r.figmaName} [${pair}] — ${p.codeOnlySettings.join(", ")}`);
  }
}
// Findings that pass and that nobody intends to fix — every codebase lower-cases
// its settings. The count is worth keeping; 45 lines of `Primary → primary` are
// not. Every line is still in parity.json.
const COUNT_ONLY = new Set(["case-only-difference", "satisfied-by-absence"]);
const order = ["component-absent", "option-missing-in-code", "different-name", "separator-only-difference", "declared-equivalent", "case-only-difference", "option-only-in-code", "design-only"];
let md = `# Parity findings — ${out.generatedAt}\n\nContract ${CONTRACT_VERSION}, rules v${rules.rulesVersion ?? "?"} (${rules.rulesUpdatedOn ?? "no date"}).\nFigma ${basename(figmaDir)}, web ${basename(webDir)}, app ${basename(appDir)}.\nEach line is one thing to decide or fix. Grouped by what kind of thing it is.\n`;
for (const code of [...order, ...[...grouped.keys()].filter((k) => !order.includes(k))]) {
  const lines = grouped.get(code);
  if (!lines || LABELS[code] === null) continue;
  md += `\n## ${LABELS[code] || code} (${lines.size})\n\n`;
  if (COUNT_ONLY.has(code)) {
    md += `Counted, not listed — these all pass and none needs fixing. Every line is in \`parity.json\`.\n`;
    continue;
  }
  for (const l of [...lines].sort()) md += `- ${l}\n`;
}
writeFileSync(join(outDir, "findings.md"), md);

// ── mirror ──────────────────────────────────────────────────────────────────
// Same three files, byte for byte, in a second folder. ds-inventory/generated/parity/
// stays the copy a record's parityExpected and the inspector read; the mirror in
// snapshots/parity exists so a run is findable next to the captures it was scored
// from, without becoming a second thing anyone computes or trusts separately.
if (mirrorDir) {
  mkdirSync(mirrorDir, { recursive: true });
  writeFileSync(join(mirrorDir, "parity.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(mirrorDir, "rules-used.yaml"), rulesText);
  writeFileSync(join(mirrorDir, "findings.md"), md);
}

// ── readable summary ────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nparity contract ${CONTRACT_VERSION} — ${scored.length} record(s)`);
console.log(`figma ${basename(figmaDir)}   web ${basename(webDir)}   app ${basename(appDir)}`);
console.log(`rules v${rules.rulesVersion ?? "?"} (${rules.rulesUpdatedOn ?? "no date"}, ${rulesHash})\n`);
for (const r of scored) {
  console.log(`${r.figmaName}  (${r.id})${r.recordBehindSnapshot.length ? `   [record behind snapshot: ${r.recordBehindSnapshot}]` : ""}`);
  for (const pair of PAIRS) {
    const p = r.pairs[pair];
    console.log(
      `  ${pad(pair, 13)} ` +
        CHECKS.map((c) => {
          const k = p.checks[c].counts;
          return `${c}=${p.checks[c].result}${k ? ` ${k.pass}/${k.pass + k.fail}${k.na ? ` +${k.na}na` : ""}` : ""}`;
        }).join("  ")
    );
  }
  console.log("");
}
console.log("totals");
for (const pair of PAIRS) {
  console.log(`  ${pair}`);
  for (const check of CHECKS) {
    const t = totals[pair][check];
    console.log(`    ${pad(check, 11)} pass ${t.pass}  fail ${t.fail}  n/a ${t.na}  unmeasurable ${t.unmeasurable}`);
  }
}
console.log(`\nwritten ${join(outDir, "parity.json")} and findings.md`);
if (mirrorDir) console.log(`mirrored to ${mirrorDir}`);
