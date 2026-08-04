# Changelog

Contract versions are independent of skill versions. A skill change that does not alter the
output shape does not bump the contract.

## Text style ids — 2026-08-04

Not a contract change, and no `schemaVersion` bump. `figmaStyleId` was already documented and written
as `S:<key>`; this only says so explicitly and makes the matching tolerant, so every existing snapshot
stays valid and no consumer has to change.

- **`figmaStyleId` is `S:<key>`** — key only, no trailing comma, no node suffix. Now stated outright in
  `references/output-contract.md`, because Figma reports one style under two ids: `S:<key>,` in the file
  that owns it, and `S:<key>,<localNodeId>` on a text node in a file that uses it.
- **`build-dependencies.mjs` normalises both sides** with `id.split(",")[0]` — the capture's ids, the
  step 4 names, and `typography.json`'s `figmaStyleId` — so a capture holding raw ids still maps.
- **Dependency capture step 2 emits normalised ids**, while keeping the raw id in the resolver cache
  because `getStyleByIdAsync` needs it verbatim. Step 4 reports the normalised id.
- `tests/build-fixture.mjs` now feeds a raw using-file id and a raw owning-file id through the builder,
  so the byte-identical check in `tests/run.sh` covers this.

Why it mattered: the lookup was exact, so raw ids made every text style miss — and miss quietly, with
zero typography links and one "absent from typography.json" note per style, no error. The 2026-08-04
snapshot of the Twinkl library hit it: 49 styles, 244 typography links only after normalising by hand.

## Tooling — 2026-08-04

Not a contract change. The snapshot folder, every file in it, and the validator are untouched, so
existing snapshots and consumers are unaffected.

- **`scripts/to-bundle.mjs`** packs a validated snapshot into one JSON file for sharing or uploading,
  and **`scripts/from-bundle.mjs`** unpacks it again. Bundle format version 1.0.0, versioned
  separately from the contract.
- The bundle is a container: each file's content sits verbatim under its contract path in
  `bundle.files`, so nothing is merged, renamed, or flattened, and the token documents remain
  standalone valid DTCG once read back out.
- The round trip is byte-exact, and `tests/run.sh` proves it: pack, unpack, `diff -r` against the
  original, then validate the unpacked copy.
- A bundle is never a file inside a snapshot folder. `to-bundle.mjs` writes outside it, since the
  contract lists every file a snapshot may contain.
- `to-bundle.mjs` refuses a folder that disagrees with its own `manifest.files`; `from-bundle.mjs`
  refuses a path that would escape the target folder, and refuses to overwrite a non-empty one.

Why a container rather than one merged document: in DTCG every top-level key that is not
`$`-prefixed is a group of tokens, so putting `components` or `manifest` beside `colour` in one
document would make DTCG tools read them as tokens. The standard also has no way to express modes,
which is why the per-mode files exist. Nesting each file whole is what buys the single upload without
giving up either.

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
