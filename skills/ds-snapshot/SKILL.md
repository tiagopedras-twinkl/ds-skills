---
name: ds-snapshot
description: Export the Figma design system library (variables, typography styles, component inventory) into a dated, fixed-format snapshot on disk, optionally with the dependency layer — which components bind which tokens, which tokens alias which per mode, which components nest which. Use whenever the user asks to snapshot, export, refresh, extract, or audit design system data from Figma, mentions tokens, variables, text styles, a component inventory, design/code parity, or says a snapshot is stale. Also use it when they ask what depends on what, what breaks if a token or component changes, for an impact analysis or dependency graph, or to refresh a ds-graph snapshot — all of which need the dependency layer. Also use it before comparing Figma against code, which is only trustworthy against a validated snapshot. Requires Figma desktop open on the library with the Figma Console MCP bridge paired, on every file to be walked.
---

# Design system snapshot

Export the Figma design system library into `snapshots/<YYYY-MM-DD>/`, under the directory the skill is run from, as a fixed set of JSON files.

The point of this skill is the contract, not the export. Downstream consumers (parity audits, docs, diffs between dates, code generation, impact analysis) all read the same field names in the same places, so the snapshot format must be identical every run regardless of what Figma returns. Variables and typography use the Design Tokens Community Group format 2025.10, which is a real interoperable standard. Component inventory and the dependency layer use local schemas, because no standard for either exists yet.

The snapshot has two parts:

- **The inventory** — what the library contains. Always exported.
- **The dependency layer** — what depends on what. Optional, because it costs a walk of every component's descendants and often needs more than one Figma file open.

## Non-negotiables

1. **Read-only.** Never create, rename, update, or delete anything in Figma. Only `figma_get_*`, `figma_export_*`, `figma_analyze_*`, `figma_list_*`, and status tools. The dependency layer also needs `figma_execute`, which *can* write to a document — so every line you run through it must only read.
2. **The contract is fixed.** Never invent, rename, reorder, or drop a field, and never add a file that is not in the contract. When Figma returns something that does not map cleanly, record it in `$extensions` or `manifest.notes.unmapped` and keep the file shape intact. Reshaping output to suit one run is the failure this skill exists to prevent.
3. **Validation gates completion.** A snapshot is not done until `scripts/validate-snapshot.mjs` exits 0. If it fails, fix the export and re-run it. Never report a snapshot as finished, and never commit it, while validation fails.
4. **Deterministic ordering.** Same Figma state must produce byte-identical files apart from `manifest.exportedAt`. Ordering rules are in `references/output-contract.md`.
5. **A partial capture says so.** The contract writes every file every time, so a part nobody looked for is indistinguishable from a part that is genuinely empty. Whenever a snapshot holds less than all four parts, say which in the report, in words, before any number. Never describe a capture as complete, full, or a refresh when it is not.

6. **Every dependency comes from Figma.** Never infer a link from a name, from a colour value that happens to match, or from a convention. A link that is not in `boundVariables`, `valuesByMode`, an instance's main component, or a `textStyleId` does not go in the snapshot. A guess that looks like data is worse than a gap.

## Ask first

Two questions decide the shape of the run, and both are cheap to ask and expensive to get wrong. Ask them **before** touching Figma, in one go.

1. **What do you want in this snapshot?** Offer the four parts by name and default to all four:

   - **Tokens** — every variable, per collection and mode.
   - **Text styles** — typography, a separate Figma entity from variables.
   - **Components** — the component inventory, with variant axes and counts.
   - **Dependencies** — which components bind which tokens and for which properties, which tokens alias which per mode, which components nest which, which use which text styles.

   Say what the last one costs: a walk of every component's descendants, minutes rather than seconds on a large library.

   **A full-spectrum capture is all four, and it is the right default.** Anything less produces a snapshot that reads as complete and is not. Two captures on 2026-08-08 walked foundations files only, so they hold 238 icons and tokens and none of the 87 UI components, and every consumer that read them saw an empty component list rather than an error. Only offer less when the user asks for less.

   Components and dependencies both need the bridge paired on the file that holds them, so a yes to either makes question 2 matter.

2. **Does the library live in one Figma file or several?** Most real libraries split foundations (variables, text styles, icons) from components, and some split components across several files. This matters for components and for the dependency layer, and it changes what the user has to do:

   - **Variables and text styles resolve across files on their own.** A component in one file binding a variable that lives in another resolves in place. Do not ask the user to open the foundations file for that reason; it is not needed and an earlier version of this workflow wrongly assumed it was.
   - **Components do not.** A component can only be walked in a file the bridge is paired with. Anything nested but not walked is recorded as an uncaptured nested name, with no dependencies of its own.

   So if the library spans several files, tell the user plainly: *for every file whose components you want the dependencies of, open the Desktop Bridge plugin on that file too.* Then confirm what is actually connected with `figma_list_open_files` before starting, and report which files you will walk and which you will not.

If the user has already said what they want, do not re-ask. "Everything", "a full capture" or "full-spectrum" answers question 1 — all four parts. An impact analysis, a dependency graph or a ds-graph refresh answers it too, because each needs components and dependencies; take all four and ask only question 2.

## Preconditions

Call `figma_get_status` with `probe: true`. If the Desktop Bridge is not paired, call `figma_diagnose`, report what it says, and stop with instructions to open Figma desktop on the design system library file and run the bridge plugin. Do not silently fall back to the REST transport: on non-Enterprise plans variable reads return 403, and a partial snapshot is worse than none.

Call `figma_list_open_files` and confirm the paired file is the design system library and not a consuming product file. If the file name looks wrong, ask before exporting.

**When the library spans several files**, `figma_list_open_files` is also how you check the user did what you asked. Decide and state which file the tokens come from — normally the one that owns the variables — and which files you will walk for components. If a file the user named is not connected, say so and either wait or proceed without it; never walk a file and quietly skip another.

## Steps

1. **Set the target.** `<cwd>/snapshots/<YYYY-MM-DD>/`, using today's date, where `<cwd>` is the directory the skill is run from. Create `snapshots/` there if it does not exist.

   That is the whole rule. Always a folder named `snapshots`, always directly inside the current directory. Never walk up looking for an existing folder, never write outside the current directory, and never pick a different name because the surroundings suggest one. The user chooses where a capture lands by choosing where to run the skill from, and a skill that second-guesses that is how captures end up somewhere nothing reads.

   **Never overwrite an existing snapshot.** If `<YYYY-MM-DD>/` is already there, add a number: `<YYYY-MM-DD>-2`, then `-3`, and so on, taking the first free one. Do the same when only the bundle exists — `ds-snapshot-<YYYY-MM-DD>.bundle.json` beside the folder means that date is taken.

   A same-day re-run is usually a wider capture than the first, and overwriting silently destroys the earlier one. Two folders cost nothing and the later number is the later capture. Never write to a past date's folder at all.

   Say the target path out loud before writing anything, so the user can stop a run that is about to land in the wrong place.

2. **Export tokens per collection and mode.** Read `references/output-contract.md` first for the file layout. Use `figma_export_tokens` with the DTCG 2025.10 dialect, one file per collection and mode. Spot-check one colour token in the result: 2025.10 colours are objects with `colorSpace` and `components`, not hex strings. If the output is the legacy dialect, or you are using `figma_get_variables` because export is unavailable, convert it yourself following `references/figma-mapping.md`. **Every token path begins with its collection**, in the per-mode files as well as the merged one, and every token records `figmaCollection` alongside `figmaName`. Figma only makes a variable name unique within its collection, so a path that leaves the collection out is not an identity — check `references/figma-mapping.md`, "Collections are groups", before writing anything. Every token also records `figmaVariableId`, Figma's own id for the variable, which is what lets two snapshots of the same file be compared through a rename. If `figma_export_tokens` does not return ids, read them with `figma_get_variables` and match on collection and name; do not leave the field empty when a second read would fill it.

3. **Write the merged `tokens.json`** from each collection's default mode, merged in case-insensitive collection-name order. This is the primary artifact most consumers read. Because each collection has its own group, no variable is ever dropped for sharing a name with one in another collection; if you find yourself writing such a note, the export is wrong.

4. **Export typography.** Use `figma_get_styles` for text styles, map them to `typography` composite tokens, and write `typography.json`. Text styles are separate Figma entities from variables, so they never appear in `tokens.json`. Line height and letter spacing conversions are the fiddly part, so follow `references/figma-mapping.md` exactly rather than improvising.

5. **Build the component inventory.** Use `figma_get_design_system_kit`, then `figma_analyze_component_set` for each component set to get its variant axes and actual variant count. Write `components.json`. Inventory only: name, location, kind, variant axes and values, variant count, description, deprecation, and which file it came from. No layout or spec properties, and no bindings — those belong to step 6.

   Do this for **every** file the user asked for components from, not only the one the tokens came from. Each entry records its own `source`, so one `components.json` holds the components of several files and a reader can tell which came from where.

   The contract always includes `components.json`, so a run that skipped components writes an empty list. An empty list and "we did not look" are indistinguishable in the file, which is exactly how the 2026-08-08 pair misled every consumer. When the list is empty, step 9 has to say so in words.

6. **Capture the dependency layer** — only when the user asked for it. Follow `references/dependency-capture.md` exactly; it holds the code and the Figma behaviours that shape it. Save each capture result to a file, then run `scripts/build-dependencies.mjs` to write `dependencies.json` — do not map Figma names onto snapshot ids by hand. The script reads the mapping out of the snapshot's own `figmaName` and `figmaStyleId` extensions, so it cannot drift from the sanitising the inventory already did, and a large capture never has to pass through context. Every token and component the layer references must already exist in `tokens.json`, `typography.json`, or `components.json`: this is a set of links between things the snapshot already names, never a second inventory.

7. **Write `manifest.json`** describing the snapshot, including collections, modes, counts, which files the dependency layer was captured from, and anything that could not be mapped. When the layer was skipped, `dependencies.captured` is `false` with empty sources and zero counts — the keys are always present. When it ran, `build-dependencies.mjs` has already filled that block in and printed anything for `notes.unmapped`; add those entries rather than dropping them. Every `notes.unmapped` reason comes from the fixed table in `references/output-contract.md`, "Reason strings" — never write your own wording for a case the table covers, or two runs of the same situation will not compare.

8. **Validate.** Run `node scripts/validate-snapshot.mjs` against the target folder from step 1, suffix included. Fix every error and re-run until it passes. Report warnings to the user but they do not block.

9. **Report.** Open with **coverage**, before any count: which of the four parts this snapshot holds, and which Figma file each came from. Take the component files from the distinct `source` values in `components.json` rather than from memory of what was asked for. Then the headline counts, anything in `manifest.notes.unmapped`, and how the counts moved against the previous snapshot if one exists.

   State plainly, in the first line, when a part is missing. "This snapshot holds tokens and text styles from *1. Foundations*. It holds no components and no dependency layer." A reader who has to work that out from a zero is a reader who will not.

   When the dependency layer ran, add what is worth acting on: bindings that resolved to nothing, components nested but never walked, and which files were walked. If the repo has a parity audit and the user asked for one, run it now; the snapshot itself is complete either way.

   If the folder holding `snapshots/` carries a README that catalogues the captures, add a row for this one. A catalogue that is only current for some of the snapshots is worse than none.

## Sharing a snapshot as one file

`scripts/to-bundle.mjs` packs a validated snapshot into a single JSON file, for uploading to a tool, attaching to a message, or handing to another agent:

```bash
node scripts/to-bundle.mjs snapshots/<YYYY-MM-DD>
```

It is a container, not a second format. Each file's content sits verbatim under its contract path, so `bundle.files["tokens.json"]` is still a standalone valid DTCG document and `bundle.files["components.json"]` is still exactly `components.json`. Nothing is merged, renamed, or flattened, which is what keeps one upload interchangeable with the folder — and keeps the token files readable by any DTCG tool once pulled back out.

`scripts/from-bundle.mjs <bundle.json> <dir>` restores the folder byte for byte, so a shared bundle can be validated with the same validator as a fresh export. A consumer that only reads the bundle needs nothing but `bundle.files`.

The bundle is written **outside** the snapshot folder. The contract lists every file a snapshot may contain and a bundle is not one of them, so never write one into `snapshots/<date>/`.

## Converting a snapshot to a flat graph

`scripts/to-ds-graph.mjs` converts a validated snapshot into a flat `graph.json` of nodes and links:

```bash
node scripts/to-ds-graph.mjs snapshots/<YYYY-MM-DD> graph.json
```

It needs the dependency layer. Without it there are no links to draw, and the script says so and stops.

**The [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph) viewer no longer needs this.** It reads a snapshot folder or bundle directly, so there is no `graph.json` to keep in step and nothing to copy into that repo — which holds no library data at all. Point the viewer at the snapshot instead. This adapter stays for anything else that wants a flat graph.

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
