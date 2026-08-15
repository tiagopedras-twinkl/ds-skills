---
name: ds-name-check
description: Validate component names against the design system naming specification and suggest a corrected name for every failure. Use whenever the user asks whether a name is valid, to check, audit, lint, or review component names, whether something follows the naming convention or spec, or to find badly named components. Works on a name pasted in chat, a list, a CSV or JSON file, a code or Storybook export, a ds-snapshot component inventory, or the live Figma library via the Figma Console MCP bridge. Also use when the user asks what the naming rules are, or asks to fix or rename components to match the convention — renaming is a separate confirmed step after the report.
---

# Component name check

Validate component names against `reference/component-names.md` and report every
failure with the rule it broke and, where the fix is mechanical, a corrected name.

Validation is one regex against a list of strings. Only getting the list changes
between modes, so every mode converges on the same script and the same output.
Never eyeball a name against the spec, and never re-derive the rule from the
prose. Run the script.

## Non-negotiables

1. **The spec file is the authority.** `reference/component-names.md` holds the
   regex and the platform list, and the script parses them at runtime. Never
   hardcode a rule, never relax the regex to make a run pass, and never judge a
   name by reading the prose instead of running the validator.
2. **Auditing is read-only.** Reading names never modifies anything. In Figma
   that means `figma_get_*`, `figma_list_*`, and status tools only.
3. **Renaming is a separate, confirmed step.** Never rename as part of an audit,
   even when every failure has a suggestion. See `reference/rename-figma.md`.
4. **Suggestions are mechanical only.** Casing, spacing, separators, stray
   hyphens. The script never guesses vocabulary, so `Button/desktop` gets no
   suggestion. Never fill that gap yourself.
5. **Report what the script returned.** Do not re-summarise from memory, add
   names it did not check, or soften a failure.

## Modes

Pick by what the user gives you. All four end in the same script.

### Inline

A name or a list pasted in chat. No file, no tools.

```bash
node scripts/validate-names.mjs --names "Text field, Button/Web, In--line"
```

For more than a handful, pipe on stdin instead, one per line.

### File

CSV, JSON, a code export, a Storybook manifest, anything with names in it.

Extract the names yourself, then pipe them in. Do not add parsers to the script.

```bash
cut -d, -f2 components.csv | tail -n +2 | node scripts/validate-names.mjs
```

A JSON array of strings, or of objects with a `name` field, is read directly:

```bash
node scripts/validate-names.mjs --json components.json
```

### Snapshot (prefer this for Figma)

A `ds-snapshot` component inventory. Needs no Figma session and is the default
path for auditing the library.

```bash
node scripts/validate-names.mjs --snapshot ds-snapshots/<YYYY-MM-DD>
```

The adapter rejoins `path` and `name` into the full Figma name, because the spec
applies to the whole name and ds-snapshot stores the last segment separately. It
carries `nodeId` and `source` through, so the JSON output is directly usable for
a rename pass.

Check the snapshot date first. If it is old, say so and offer live Figma.

### Live Figma

Only when there is no snapshot, the snapshot is stale, or the user asked for
live. `figma_get_status` with `probe: true` must show the Desktop Bridge paired;
if it is not, call `figma_diagnose`, report it, and stop rather than falling
back to REST.

Confirm the paired file with `figma_list_open_files`. Read the inventory with
`figma_get_design_system_kit`, write the names to a JSON array, and run
`--json`. Do not hand-check them.

If the user wants this repeatedly, tell them to run `ds-snapshot` once instead.

## Output

The script prints the report. Use `--format md --out <file>` for a file,
`--format json` when a rename pass will consume it.

**25 names or fewer** — show the table in chat. Add `--fails-only` when nearly
everything passes and the table would bury the failures.

**More than 25** — write the Markdown report to a file, and in chat give only:
the counts, the failure codes by frequency, anything with no suggestion, and the
warnings. Never paste a 400-row table into the conversation.

Then say what is available next, in one line: apply the fixable ones, or hand
the JSON to something else. Do not start renaming.

## Warnings

`orphan-platform`, `bare-and-platform`, and `duplicate` are raised across a set
and do not fail a run. They are computed over valid names only, so they never
appear for a name that already failed.

Report them, and be clear they are not naming errors. Each one means a component
is missing, duplicated, or ambiguous, which is a decision the user makes and not
something a rename fixes.

## Renaming

Only when the user has seen a report and explicitly asked. Read
`reference/rename-figma.md` at that point and follow it exactly. It covers the
confirmation gate, node id handling, and verification.

For any source other than Figma, there is nothing to rename here. Give the
JSON report and let their own tooling apply it.

## Adding this to a repo

Point `CLAUDE.md` at the spec in one line rather than pasting it:

```md
Component names follow `.claude/skills/ds-name-check/reference/component-names.md`.
```

For CI, the script exits 1 on any failure, so it drops into a workflow with no
wrapper.

## Reference files

- `reference/component-names.md` — the spec. Grammar, config block, examples,
  failure codes, and the two open decisions. Read before answering any question
  about what the rules are.
- `reference/rename-figma.md` — the confirmed rename procedure. Read only when
  renaming.
- `scripts/validate-names.mjs` — the validator. Node, no dependencies.
  `--help` prints usage.
