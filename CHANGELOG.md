# Changelog

Contract versions are independent of skill versions. A skill change that does not alter the
output shape does not bump the contract.

## Contract 1.1.0 — 2026-08-03

Adds the optional dependency layer: what depends on what, alongside what the library contains.

- **`dependencies.json`**, new and optional. Bindings from a component to a token with the Figma
  properties bound, aliases from token to token per mode, nesting between components, and
  typography use. Present when and only when `manifest.dependencies.captured` is `true`.
- **`manifest.dependencies`**, always present. `captured`, the Figma files walked, and totals that
  the validator cross-checks against `dependencies.json` so they cannot drift.
- **`components[].source`**, the Figma file a component came from, so a snapshot can span several
  files without losing track of where anything lives.
- **`scripts/build-dependencies.mjs`** turns raw captures into `dependencies.json` and fills in the
  manifest block.
- **`scripts/to-ds-graph.mjs`** converts a snapshot into a `graph.json` for the
  [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph) viewer and its impact queries.

A 1.0.0 snapshot is still valid: every 1.1.0-only check is gated on the snapshot's own
`schemaVersion`, and `tests/run.sh` covers that case.

### Notes on 1.1.0

The layer is links only, never a second inventory. Every path in it must resolve in `tokens.json`,
`typography.json`, or `components.json`. The two exceptions record what the snapshot does *not*
hold, which is the more useful failure mode: `unresolvedBindings` for a binding to a variable that
was never exported, and `nestsUncaptured` for a component nested but never walked.

Aliases are stored flat here as well as inside the per-mode token files, which is duplication on
purpose: reconstructing the alias graph means reading every mode file, and traversal is the whole
point of this layer. The duplication is made safe by the validator, which compares the two in both
directions and rejects a snapshot where they disagree.

Token paths drop the variable's collection, because `tokens.json` merges collections at the top
level and carries no collection group. `build-dependencies.mjs` maps Figma names onto paths by
reading the `figmaName` and `figmaStyleId` extensions the inventory already wrote, rather than
re-deriving the sanitising rules — which is what makes the conversion reproducible.

Only components need more than one Figma connection. Variables and text styles resolve across files
in place via `getVariableByIdAsync` and `getStyleByIdAsync`, so a components file binding a
foundations file's variables needs one connection. An earlier design assumed a cross-file join was
required and was wrong.

Bindings attach to a whole component, not to a variant. The variant axes are already in the
inventory, so adding variant-level detail later needs no re-capture, but it changes the shape and so
is a contract change.

## Contract 1.0.0 — 2026-08-03

Initial contract.

- Variables and typography as DTCG 2025.10, one file per collection and mode, plus a merged
  default-mode `tokens.json`.
- Component inventory: name, path, kind, variant axes and values, variant count, deprecation.
- `manifest.json` records source, collections, modes, counts, and unmapped items.
- Deterministic ordering and formatting so two snapshots differ only in `exportedAt`.

### Notes on 1.0.0

The `$extensions` namespace is `io.github.tiagopedras-twinkl.ds-snapshot`. It identifies the tool that wrote
the data, not the team that ran it, so a snapshot stays readable by anyone using this skill. The
DTCG spec requires a vendor-specific key and recommends reverse domain notation. The schemas carry
no `$id`; add the published raw URL once the repo is public if you want them resolvable.
