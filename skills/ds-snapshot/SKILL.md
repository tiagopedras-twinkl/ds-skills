---
name: ds-snapshot
description: Export the Figma design system library (variables, typography styles, component inventory) into a dated, fixed-format snapshot on disk. Use this whenever the user asks to snapshot, export, refresh, extract, or audit design system data from Figma, mentions tokens, variables, text styles, a component inventory, design/code parity, or reports that a snapshot is stale or out of date. Also use it before any task that needs to compare Figma against code, since that comparison is only trustworthy against a validated snapshot. Requires Figma desktop open on the library file with the Figma Console MCP bridge paired.
---

# Design system snapshot

Export the Figma design system library into `ds-snapshots/<YYYY-MM-DD>/` as a fixed set of JSON files.

The point of this skill is the contract, not the export. Downstream consumers (parity audits, docs, diffs between dates, code generation) all read the same field names in the same places, so the snapshot format must be identical every run regardless of what Figma returns. Variables and typography use the Design Tokens Community Group format 2025.10, which is a real interoperable standard. Component inventory uses a local schema, because no standard for that exists yet.

## Non-negotiables

1. **Read-only.** Never create, rename, update, or delete anything in Figma. Only `figma_get_*`, `figma_export_*`, `figma_analyze_*`, and status tools.
2. **The contract is fixed.** Never invent, rename, reorder, or drop a field, and never add a file that is not in the contract. When Figma returns something that does not map cleanly, record it in `$extensions` or `manifest.notes.unmapped` and keep the file shape intact. Reshaping output to suit one run is the failure this skill exists to prevent.
3. **Validation gates completion.** A snapshot is not done until `scripts/validate-snapshot.mjs` exits 0. If it fails, fix the export and re-run it. Never report a snapshot as finished, and never commit it, while validation fails.
4. **Deterministic ordering.** Same Figma state must produce byte-identical files apart from `manifest.exportedAt`. Ordering rules are in `references/output-contract.md`.

## Preconditions

Call `figma_get_status`. If the Desktop Bridge is not paired, call `figma_diagnose`, report what it says, and stop with instructions to open Figma desktop on the design system library file and run the bridge plugin. Do not silently fall back to the REST transport: on non-Enterprise plans variable reads return 403, and a partial snapshot is worse than none.

Confirm the paired file is the design system library and not a consuming product file. If the file name looks wrong, ask before exporting.

## Steps

1. **Set the target.** `ds-snapshots/<YYYY-MM-DD>/` at the repo root, using today's date. If the folder already exists, this is a same-day re-run: overwrite it. Never write to a past date's folder.

2. **Export tokens per collection and mode.** Read `references/output-contract.md` first for the file layout. Use `figma_export_tokens` with the DTCG 2025.10 dialect, one file per collection and mode. Spot-check one colour token in the result: 2025.10 colours are objects with `colorSpace` and `components`, not hex strings. If the output is the legacy dialect, or you are using `figma_get_variables` because export is unavailable, convert it yourself following `references/figma-mapping.md`.

3. **Write the merged `tokens.json`** from each collection's default mode. This is the primary artifact most consumers read.

4. **Export typography.** Use `figma_get_styles` for text styles, map them to `typography` composite tokens, and write `typography.json`. Text styles are separate Figma entities from variables, so they never appear in `tokens.json`. Line height and letter spacing conversions are the fiddly part, so follow `references/figma-mapping.md` exactly rather than improvising.

5. **Build the component inventory.** Use `figma_get_design_system_kit`, then `figma_analyze_component_set` for each component set to get its variant axes and actual variant count. Write `components.json`. Inventory only: name, location, kind, variant axes and values, variant count, description, deprecation. No layout or spec properties, no token bindings.

6. **Write `manifest.json`** describing the snapshot, including collections, modes, counts, and anything that could not be mapped.

7. **Validate.** Run `node scripts/validate-snapshot.mjs ds-snapshots/<YYYY-MM-DD>`. Fix every error and re-run until it passes. Report warnings to the user but they do not block.

8. **Report.** Give the user the headline counts, anything in `manifest.notes.unmapped`, and how the counts moved against the previous snapshot folder if one exists. If the repo has a parity audit and the user asked for one, run it now; the snapshot itself is complete either way.

## What this skill does not do

Component internals (padding, gaps, radii, per-layer token bindings, states) are deliberately out of scope. If the user wants those, treat it as a contract change (below) rather than adding fields on the fly, because half-populated spec fields are worse than absent ones.

## Reference files

- `references/output-contract.md` — the fixed file layout, every field, and the ordering rules. Read before writing any file.
- `references/figma-mapping.md` — how Figma types, units, names, and modes become DTCG. Read when converting anything by hand.
- `schemas/components.schema.json`, `schemas/manifest.schema.json` — the published contract for other tools.
- `scripts/validate-snapshot.mjs` — the gate. Node, no dependencies.

## Changing the contract

When the contract genuinely needs to change, change it deliberately: bump `schemaVersion`, and update the schema file, the validator, and `references/output-contract.md` in the same commit. Never edit past snapshots to match a new shape. Their `schemaVersion` is what makes old snapshots still readable.
