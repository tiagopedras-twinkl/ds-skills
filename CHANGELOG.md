# Changelog

Contract versions are independent of skill versions. A skill change that does not alter the
output shape does not bump the contract.

## Contract 2.0.0 — 2026-08-08

**Breaking.** A token's path now begins with its Figma collection: `Typography.Size.2xl` becomes
`Primitives.Typography.Size.2xl`. Anything that joins on a token path has to be updated. Component
ids, typography paths and everything in `components.json` are unchanged.

Why it had to change. DTCG identifies a token by its path alone and has no concept of collections.
Figma only requires a variable name to be unique *within* its collection, so two collections may each
hold `Typography/Size/2xl` and that is ordinary. Against contract 1.x that cost real data, and a real
export proved it: of 523 variables in the *1. Foundations* library, 15 shared a name across the
`Primitives` and `Tokens` collections, 14 of them appeared in **no** file of the snapshot at all, and
the export still validated because the losses were absorbed as recorded gaps. Worse, the `Tokens`
copies aliased the `Primitives` copies — and with no collection in the path, that reference came out
pointing at itself, which is invalid DTCG and which the validator reported as a circular alias chain.
So the per-collection mode files, which exist precisely to keep collections apart, could not hold
those tokens either.

Putting the collection at the front removes both problems by construction rather than by rule, and
takes a third with them: two collections that type the same name differently (`FONT_SIZE` yielding
`dimension`, `ALL_SCOPES` yielding `number`) are now separate tokens that each keep their own `$type`.

- **Token paths carry their collection**, in `tokens.json` and in every `tokens/<collection>.<mode>.json`,
  so one variable has one path everywhere and a cross-collection reference reads the same in every file.
  A collection whose own name contains `/` opens a group per segment.
- **`$extensions … .figmaCollection`**, new and required on every token, holding the unsanitised
  collection name beside `figmaName`.
- **`$extensions … .figmaVariableId`**, new and required on every token, holding Figma's own id for
  the variable verbatim. It is the only field that identifies a variable independently of what it is
  called or where it sits, which is what makes two snapshots of the same file comparable through a
  rename: between 2026-08-04 and 2026-08-07, 339 of 456 variables changed nothing but their path, and
  on paths alone that reads as 339 deletions and 339 additions. `""` when the transport cannot supply
  one, never absent — and the validator says plainly what an empty one costs. Ids must be unique
  within a document; two tokens sharing one means a variable was written twice, and is an error.
  Ids mean nothing across Figma files, so only compare snapshots of the same file.
- **A written merge policy for `tokens.json`.** Collections merge in case-insensitive name order.
  Same-named variables from different collections can no longer collide; the two residual collisions —
  two collection names that sanitise alike, and a collection group landing on an existing token — are
  defined, and the loser is recorded rather than dropped silently.
- **A closed set of `notes.unmapped` reason strings**, with the `name` format fixed for each, so the
  same situation produces the same text on every run. The validator warns on anything outside it —
  a warning rather than an error, so an unanticipated case is still recorded instead of being dropped.
  `kind` gains `alias` and `file`, both of which were already in use and neither of which the published
  schema allowed.
- **The validator tells a real cycle from a name shadow.** A token referencing its own path now gets
  its own diagnosis, and says which of the two it can be given the snapshot's contract version.
- **`build-dependencies.mjs` no longer splits a capture label on its first `/`.** A label is
  `<collection>/<name>` and both halves may contain `/`, so collections like `Primitives/Spacing` were
  being mis-mapped. It now matches labels rebuilt from the snapshot's own extensions, and a
  cross-collection alias is recorded instead of being silently discarded as a self-reference.

Migrating: branch on `manifest.schemaVersion`. To match a 1.x path against a 2.x one, strip the
leading collection group, or compare on `$extensions`, which carries `figmaName` and `figmaCollection`
separately in both. Past snapshots are not rewritten — their `schemaVersion` is what keeps them
readable, and `tests/run.sh` checks a 1.0.0 snapshot still validates.

Out of scope, and deliberately so: the library that produced the failing export also uses identical
names for different variables in two collections, which is confusing in Figma regardless of tooling.
That is for the design system team. A snapshot tool cannot assume its input is well formed, so the
skill behaves correctly either way.

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
