---
name: ds-snapshot
description: Export the Figma design system library (variables, typography styles, component inventory) into a dated, fixed-format snapshot on disk, optionally with the dependency layer — which components bind which tokens, which tokens alias which per mode, which components nest which. Use whenever the user asks to snapshot, export, refresh, extract, or audit design system data from Figma, mentions tokens, variables, text styles, a component inventory, design/code parity, or says a snapshot is stale. Also use it when they ask what depends on what, what breaks if a token or component changes, for an impact analysis or dependency graph, or to refresh a ds-graph snapshot — all of which need the dependency layer. Also use it before comparing Figma against code, which is only trustworthy against a validated snapshot. Requires Figma desktop open on the library with the Figma Console MCP bridge paired, on every file to be walked.
---

# Design system snapshot

Export the Figma design system library into `ds-snapshots/<YYYY-MM-DD>/` as a fixed set of JSON files.

The point of this skill is the contract, not the export. Downstream consumers (parity audits, docs, diffs between dates, code generation, impact analysis) all read the same field names in the same places, so the snapshot format must be identical every run regardless of what Figma returns. Variables and typography use the Design Tokens Community Group format 2025.10, which is a real interoperable standard. Component inventory and the dependency layer use local schemas, because no standard for either exists yet.

The snapshot has two parts:

- **The inventory** — what the library contains. Always exported.
- **The dependency layer** — what depends on what. Optional, because it costs a walk of every component's descendants and often needs more than one Figma file open.

## Non-negotiables

1. **Read-only.** Never create, rename, update, or delete anything in Figma. Only `figma_get_*`, `figma_export_*`, `figma_analyze_*`, `figma_list_*`, and status tools. The dependency layer also needs `figma_execute`, which *can* write to a document — so every line you run through it must only read.
2. **The contract is fixed.** Never invent, rename, reorder, or drop a field, and never add a file that is not in the contract. When Figma returns something that does not map cleanly, record it in `$extensions` or `manifest.notes.unmapped` and keep the file shape intact. Reshaping output to suit one run is the failure this skill exists to prevent.
3. **Validation gates completion.** A snapshot is not done until `scripts/validate-snapshot.mjs` exits 0. If it fails, fix the export and re-run it. Never report a snapshot as finished, and never commit it, while validation fails.
4. **Deterministic ordering.** Same Figma state must produce byte-identical files apart from `manifest.exportedAt`. Ordering rules are in `references/output-contract.md`.
5. **Every dependency comes from Figma.** Never infer a link from a name, from a colour value that happens to match, or from a convention. A link that is not in `boundVariables`, `valuesByMode`, an instance's main component, or a `textStyleId` does not go in the snapshot. A guess that looks like data is worse than a gap.

## Ask first

Two questions decide the shape of the run, and both are cheap to ask and expensive to get wrong. Ask them **before** touching Figma, in one go.

1. **Do you want the dependency layer?** Say what it adds — which components bind which tokens and for which properties, which tokens alias which primitives per mode, which components nest which, which use which text styles — and what it costs: a walk of every component's descendants, minutes rather than seconds on a large library. Without it you get the inventory only.

2. **Does the library live in one Figma file or several?** Most real libraries split foundations (variables, text styles, icons) from components, and some split components across several files. This matters *only* for the dependency layer, and it changes what the user has to do:

   - **Variables and text styles resolve across files on their own.** A component in one file binding a variable that lives in another resolves in place. Do not ask the user to open the foundations file for that reason; it is not needed and an earlier version of this workflow wrongly assumed it was.
   - **Components do not.** A component can only be walked in a file the bridge is paired with. Anything nested but not walked is recorded as an uncaptured nested name, with no dependencies of its own.

   So if the library spans several files, tell the user plainly: *for every file whose components you want the dependencies of, open the Desktop Bridge plugin on that file too.* Then confirm what is actually connected with `figma_list_open_files` before starting, and report which files you will walk and which you will not.

If the user has already said what they want, do not re-ask. If they ask for an impact analysis, a dependency graph, or a ds-graph refresh, they have answered question 1 — assume yes and ask only question 2.

## Preconditions

Call `figma_get_status` with `probe: true`. If the Desktop Bridge is not paired, call `figma_diagnose`, report what it says, and stop with instructions to open Figma desktop on the design system library file and run the bridge plugin. Do not silently fall back to the REST transport: on non-Enterprise plans variable reads return 403, and a partial snapshot is worse than none.

Call `figma_list_open_files` and confirm the paired file is the design system library and not a consuming product file. If the file name looks wrong, ask before exporting.

**When the library spans several files**, `figma_list_open_files` is also how you check the user did what you asked. Decide and state which file the tokens come from — normally the one that owns the variables — and which files you will walk for components. If a file the user named is not connected, say so and either wait or proceed without it; never walk a file and quietly skip another.

## Steps

1. **Set the target.** `ds-snapshots/<YYYY-MM-DD>/` at the repo root, using today's date. If the folder already exists, this is a same-day re-run: overwrite it. Never write to a past date's folder.

2. **Export tokens per collection and mode.** Read `references/output-contract.md` first for the file layout. Use `figma_export_tokens` with the DTCG 2025.10 dialect, one file per collection and mode. Spot-check one colour token in the result: 2025.10 colours are objects with `colorSpace` and `components`, not hex strings. If the output is the legacy dialect, or you are using `figma_get_variables` because export is unavailable, convert it yourself following `references/figma-mapping.md`.

3. **Write the merged `tokens.json`** from each collection's default mode. This is the primary artifact most consumers read.

4. **Export typography.** Use `figma_get_styles` for text styles, map them to `typography` composite tokens, and write `typography.json`. Text styles are separate Figma entities from variables, so they never appear in `tokens.json`. Line height and letter spacing conversions are the fiddly part, so follow `references/figma-mapping.md` exactly rather than improvising.

5. **Build the component inventory.** Use `figma_get_design_system_kit`, then `figma_analyze_component_set` for each component set to get its variant axes and actual variant count. Write `components.json`. Inventory only: name, location, kind, variant axes and values, variant count, description, deprecation, and which file it came from. No layout or spec properties, and no bindings — those belong to step 6.

6. **Capture the dependency layer** — only when the user asked for it. Follow `references/dependency-capture.md` exactly; it holds the code and the Figma behaviours that shape it. Save each capture result to a file, then run `scripts/build-dependencies.mjs` to write `dependencies.json` — do not map Figma names onto snapshot ids by hand. The script reads the mapping out of the snapshot's own `figmaName` and `figmaStyleId` extensions, so it cannot drift from the sanitising the inventory already did, and a large capture never has to pass through context. Every token and component the layer references must already exist in `tokens.json`, `typography.json`, or `components.json`: this is a set of links between things the snapshot already names, never a second inventory.

7. **Write `manifest.json`** describing the snapshot, including collections, modes, counts, which files the dependency layer was captured from, and anything that could not be mapped. When the layer was skipped, `dependencies.captured` is `false` with empty sources and zero counts — the keys are always present. When it ran, `build-dependencies.mjs` has already filled that block in and printed anything for `notes.unmapped`; add those entries rather than dropping them.

8. **Validate.** Run `node scripts/validate-snapshot.mjs ds-snapshots/<YYYY-MM-DD>`. Fix every error and re-run until it passes. Report warnings to the user but they do not block.

9. **Report.** Give the user the headline counts, anything in `manifest.notes.unmapped`, and how the counts moved against the previous snapshot folder if one exists. When the dependency layer ran, add what is worth acting on: bindings that resolved to nothing, components nested but never walked, and which files were walked. If the repo has a parity audit and the user asked for one, run it now; the snapshot itself is complete either way.

## Sharing a snapshot as one file

`scripts/to-bundle.mjs` packs a validated snapshot into a single JSON file, for uploading to a tool, attaching to a message, or handing to another agent:

```bash
node scripts/to-bundle.mjs ds-snapshots/<YYYY-MM-DD>
```

It is a container, not a second format. Each file's content sits verbatim under its contract path, so `bundle.files["tokens.json"]` is still a standalone valid DTCG document and `bundle.files["components.json"]` is still exactly `components.json`. Nothing is merged, renamed, or flattened, which is what keeps one upload interchangeable with the folder — and keeps the token files readable by any DTCG tool once pulled back out.

`scripts/from-bundle.mjs <bundle.json> <dir>` restores the folder byte for byte, so a shared bundle can be validated with the same validator as a fresh export. A consumer that only reads the bundle needs nothing but `bundle.files`.

The bundle is written **outside** the snapshot folder. The contract lists every file a snapshot may contain and a bundle is not one of them, so never write one into `ds-snapshots/<date>/`.

## Feeding the ds-graph viewer

`scripts/to-ds-graph.mjs` converts a validated snapshot into the `graph.json` that the [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph) viewer and its impact queries read:

```bash
node scripts/to-ds-graph.mjs ds-snapshots/<YYYY-MM-DD> path/to/ds-graph/snapshot/graph.json
```

It needs the dependency layer. Without it there are no links to draw, and the script says so and stops. Copy the result to `viewer/src/graph.json` in that repo, which imports it at build time.

## What this skill does not do

- **Component internals.** Padding, gaps, radii, and per-layer values are out of scope. They appear only as the token a component binds, never as raw numbers.
- **Bindings per variant.** You get that `Button` binds `action.primary`; you do not get that the `primary` variant specifically does. The variant axes are in the inventory, so adding this later needs no re-capture — but it changes the shape, so it is a contract change.
- **Effect and grid styles.** Not in the contract. Do not add them to a snapshot ad hoc.

If the user wants any of these, treat it as a contract change (below) rather than adding fields on the fly, because half-populated fields are worse than absent ones.

## Reference files

- `references/output-contract.md` — the fixed file layout, every field, and the ordering rules. Read before writing any file.
- `references/figma-mapping.md` — how Figma types, units, names, and modes become DTCG. Read when converting anything by hand.
- `references/dependency-capture.md` — the code for step 6, single-file and multi-file, and the Figma API behaviours that make it necessary.
- `schemas/components.schema.json`, `schemas/dependencies.schema.json`, `schemas/manifest.schema.json` — the published contract for other tools.
- `scripts/validate-snapshot.mjs` — the gate. Node, no dependencies.
- `scripts/build-dependencies.mjs` — turns raw captures into `dependencies.json` and fills in the manifest block.
- `scripts/to-bundle.mjs`, `scripts/from-bundle.mjs` — pack a snapshot into one shareable file and unpack it again.
- `scripts/to-ds-graph.mjs` — converts a snapshot into a ds-graph `graph.json`.

## Changing the contract

When the contract genuinely needs to change, change it deliberately: bump `schemaVersion`, and update the schema file, the validator, and `references/output-contract.md` in the same commit. Never edit past snapshots to match a new shape. Their `schemaVersion` is what makes old snapshots still readable.
