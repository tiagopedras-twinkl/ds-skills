# Output contract v2.1.0

Every snapshot has exactly this layout. No extra files, no missing files.

The folder name is today's date. A second capture on the same date takes a number — `2026-08-15-2`, then `-3` — because an existing snapshot is never overwritten. A branch capture may carry a word instead, as `2026-08-08-main` does. Everything downstream matches on the leading date and treats the rest as a label.

```
figma_snapshots/<YYYY-MM-DD>[-<n>]/
├── manifest.json                        what this snapshot is
├── tokens.json                          DTCG 2025.10, default mode of every collection, merged
├── tokens/
│   └── <collection>.<mode>.json         DTCG 2025.10, one file per collection x mode
├── typography.json                      DTCG 2025.10, text styles as typography tokens
├── components.json                      component inventory
└── dependencies.json                    what depends on what              (optional)
```

`dependencies.json` is the only optional file, and the only one whose absence is legitimate. It is present when and only when `manifest.dependencies.captured` is `true`.

A snapshot is a folder. The single-file bundle produced by `scripts/to-bundle.mjs` is a container for sharing one, holding each of these files verbatim under its path here, and it is written outside the folder — it is never a file inside a snapshot, and adding it to one makes the snapshot invalid.

`<collection>` and `<mode>` are slugs: lowercase, non-alphanumerics collapsed to single hyphens, no leading or trailing hyphen. `Brand Colours` and `Dark Mode` become `tokens/brand-colours.dark-mode.json`.

Every token file, including `tokens.json` and `typography.json`, is a standalone valid DTCG document and carries:

```json
"$schema": "https://www.designtokens.org/schemas/2025.10/format.json"
```

## Reading a snapshot written before 2.1.0

2.1.0 only adds a key, so it breaks nothing. Every token in `tokens.json` now carries
`$extensions[…].modes`, an object of every mode of its collection to the value the token
takes in that mode. A consumer that ignores the key reads exactly what it read before.

The point is that `tokens.json` alone is now a complete answer about themes. Before 2.1.0
it held one mode per collection — the default — and every other mode lived only in
`tokens/<collection>.<mode>.json`. A consumer that could not open a folder, a browser file
picker being the obvious one, had no way to reach them at all.

The per-mode files are unchanged and are not going away. Each is a standalone DTCG document
that any token tool can read, which is the one thing an `$extensions` payload can never be.
The two are checked against each other in both directions by the validator, so the copy in
`tokens.json` cannot drift from the folder it summarises.

Branch on `manifest.schemaVersion`: `2.0.x` has no `modes` key and needs the per-mode files
to answer a theme question; `2.1.x` and later carry it on the token.

## Reading a snapshot written before 2.0.0

2.0.0 changes what a token path looks like, so it is a breaking change for anything that joins on one. A consumer must branch on `manifest.schemaVersion`:

- **`1.x`** — a token path is the variable name alone, collections are not in it, and a variable whose name is also used in another collection may be missing entirely.
- **`2.x`** — a token path starts with the collection, and every variable is present.

To match a 1.x path against a 2.x one, strip the leading collection group from the 2.x path, or compare on the `$extensions` payload, which carries `figmaName` and `figmaCollection` separately and is stable across both versions. Component ids, typography paths and everything in `components.json` are unchanged by 2.0.0.

Never rewrite a past snapshot into the new shape. Its `schemaVersion` is what keeps it readable.

## Ordering and formatting

These rules exist so that `git diff` between two snapshot folders shows design changes and nothing else.

1. Two-space indent, LF line endings, single trailing newline, UTF-8.
2. Within any object, `$`-prefixed properties come first in this order: `$schema`, `$type`, `$description`, `$deprecated`, `$value`, `$extensions`. All other keys follow, sorted case-insensitively, ties broken by byte order.
3. Arrays of records (`components`, `collections`, `files`, `sources`) sort by their `id`, or by `name` when there is no id. In `dependencies.json`, `aliases` sorts by `from` then `mode`, and the arrays inside a component entry sort as the `dependencies.json` section below sets out.
4. Variant axis names sort case-insensitively. Variant values within an axis sort case-insensitively. Figma's own ordering is not preserved: it is presentation, not data, and preserving it creates diff noise.
5. `manifest.exportedAt` is the only field expected to change when nothing in Figma changed. It lives in the manifest alone, never in the token or component files.
6. Round all floating point numbers to 4 decimal places.

## manifest.json

```json
{
  "schemaVersion": "2.1.0",
  "generator": { "skill": "ds-snapshot", "skillVersion": "2.1.0" },
  "exportedAt": "2026-08-03T09:14:22Z",
  "spec": { "designTokens": "2025.10" },
  "source": {
    "figmaFileName": "Design System Library",
    "figmaFileKey": "",
    "figmaLastModified": "",
    "transport": "desktop-bridge"
  },
  "collections": [
    {
      "id": "primitives",
      "name": "Primitives",
      "defaultMode": "Value",
      "modes": ["Value"],
      "variableCount": 412
    }
  ],
  "files": [
    { "path": "tokens.json", "kind": "tokens-default" },
    { "path": "tokens/primitives.value.json", "kind": "tokens-mode", "collection": "Primitives", "mode": "Value" },
    { "path": "typography.json", "kind": "typography" },
    { "path": "components.json", "kind": "components" },
    { "path": "dependencies.json", "kind": "dependencies" }
  ],
  "counts": {
    "variables": 412,
    "typographyStyles": 38,
    "components": 55,
    "componentSets": 41
  },
  "dependencies": {
    "captured": true,
    "sources": [
      { "figmaFileName": "2. Components", "figmaFileKey": "", "componentsWalked": 87 }
    ],
    "counts": {
      "bindings": 2046,
      "aliases": 496,
      "nests": 297,
      "nestsUncaptured": 107,
      "typographyLinks": 249,
      "unresolvedBindings": 0
    }
  },
  "notes": {
    "nonStandardTypes": [],
    "unmapped": []
  }
}
```

Field rules:

- `figmaFileKey` and `figmaLastModified` are empty strings when the transport cannot supply them. The keys are always present. Never omit a key to signal absence.
- `transport` is `desktop-bridge` or `rest`.
- `source` is the file the tokens came from. When the library spans several files it is the one that owns the variables, and the files walked for components are in `dependencies.sources`.
- `collections[].id` is the collection name slug. `modes` includes `defaultMode` and sorts case-insensitively.
- `files` lists every file in the snapshot except `manifest.json` itself, and nothing else. The validator compares it against the directory in both directions.
- `counts.variables` counts variable definitions once, not once per mode, so it equals the leaf token count in `tokens.json`.
- `notes.nonStandardTypes` lists `$type` values used that the DTCG spec does not define, currently only `boolean` and `string`. Empty array when none.
- `notes.unmapped` records anything Figma returned that this contract cannot hold, one entry per item: `{ "kind": "variable", "name": "...", "reason": "..." }`. An empty array is a clean snapshot; a populated one is a signal, not a failure. `reason` is never improvised — the permitted strings and the `name` format each one takes are fixed in "Reason strings" below.
- `dependencies` is always present. When the layer was skipped it is `{ "captured": false, "sources": [], "counts": { … all zero } }` and `dependencies.json` is absent. Never omit the block to signal that the layer did not run.
- `dependencies.sources` lists every Figma file walked for components, sorted by `figmaFileName`, and `componentsWalked` is how many top-level components each contributed. A file the user asked for but that was not connected does not appear here — it belongs in `notes.unmapped` with reason `file not connected, components not walked`, so the gap is on the record.
- `dependencies.counts` are totals across `dependencies.json` and are cross-checked by the validator, so they cannot drift from the data.

## Reason strings

`notes.unmapped[].reason` is a closed set. The same situation must produce the same text on every run, or two snapshots of the same library cannot be compared on their gaps. Each row also fixes the `name` format, because a free-form name is just as much a source of drift as a free-form reason.

| `kind` | `reason` | `name` is | Written when |
| --- | --- | --- | --- |
| `variable` | `name collision after sanitisation` | `<figma name> (<collection>)` | Two variables in one collection sanitise to the same path. The first by Figma's order is kept. |
| `variable` | `token path already held by another collection` | `<figma name> (<collection>)` | A collection group collision left this variable nowhere to go. See "Merging into tokens.json". |
| `variable` | `alias whose ends are not both in tokens.json` | `<from label> -> <to label>` | The dependency layer captured an alias one of whose ends is not a token here. Written by `build-dependencies.mjs`. |
| `collection` | `collection group collides with another collection after sanitisation` | `<collection name>` | Two collection names sanitise to the same group path. One entry per losing collection. |
| `alias` | `cross-collection alias unresolvable in mode file` | `tokens/<collection>.<mode>.json (<n> references)` | A per-mode file references a token in another collection, which by definition is not in that file. One entry per mode file, never one per reference. Expected and harmless. |
| `alias` | `circular alias chain` | `<path> -> <path> -> …` in chain order, starting at the lowest path | A Figma alias chain returns to its start. Every token in the chain is left out of the token files. |
| `textStyle` | `unrecognised font style, defaulted to 400` | `<figma style name>` | A Figma font style name maps to no OpenType weight. |
| `textStyle` | `used by a component but absent from typography.json` | `<figma style name>` | The dependency layer found a text style the inventory does not hold. |
| `component` | `duplicate component id within source file` | `<figma name> (<file name>, node <nodeId>)` | Two components in one Figma file slug to the same id. |
| `component` | `duplicate component id across source files` | `<figma name> (<file name>, node <nodeId>)` | Components from different files slug to the same id. |
| `component` | `walked for dependencies but absent from components.json` | `<figma name>` | The dependency walk found a component the inventory does not list. |
| `file` | `file not connected, components not walked` | `<figma file name>` | The user named a file for the dependency layer that the bridge was not paired with. |

Three reason strings were improvised during the 2026-08-07 export against contract 1.1.0 and are **not** part of this set: `duplicate token path in merged tokens.json, already held by collection <name>`, `aliases a same-named variable in another collection, which a DTCG path cannot tell apart from a self-reference`, and `cross-collection alias whose path also names a variable in this collection, so it is ambiguous`. All three described losses that 2.0.0 makes unreachable. Do not carry them forward, and do not edit the snapshot that holds them — its `schemaVersion` is what keeps it readable.

The validator warns, rather than fails, on a reason outside this table. A situation nobody anticipated should still be recorded; a warning makes the improvisation visible so the table can be extended deliberately, whereas an error would tempt an exporter to drop the note instead, which is the silent loss this whole section exists to prevent.

## components.json

```json
{
  "schemaVersion": "2.1.0",
  "components": [
    {
      "id": "actions/button",
      "name": "Button",
      "path": ["Actions"],
      "kind": "componentSet",
      "source": "2. Components",
      "variants": {
        "size": ["lg", "md", "sm"],
        "type": ["primary", "secondary", "tertiary"]
      },
      "variantCombinations": 9,
      "description": "Primary interactive control.",
      "deprecated": false,
      "figma": { "nodeId": "1203:45", "key": "" }
    }
  ]
}
```

Field rules:

- `id` is the slug of the component's full Figma name including its groups, keeping `/` as the separator. Unique within the file. This is the join key downstream consumers use, so it must be stable across runs.
- `source` is the name of the Figma file the component came from, added in 1.1.0. It is always present,
  and unlike a token's collection it is **not** part of the id: a component's Figma name is already unique
  across the library in practice, and prefixing every id with a file name would break the join with code
  and Storybook that this id exists to serve. Two files that do produce the same id are recorded, not renamed. and is the same value for every entry when the library is one file. Two components from different files that slug to the same `id` cannot both be kept: keep the first by `source` then Figma order, and record the second in `notes.unmapped` with reason `duplicate component id across source files`. Suffixing the id would produce an id that exists in no Figma file.
- `name` is the last segment of the Figma name. `path` is the preceding segments in order, `[]` for a top-level component.
- `kind` is `component` or `componentSet`.
- `variants` maps each variant axis to its sorted values. A plain component gets `{}`.
- `variantCombinations` is how many variants the set actually contains, not the product of the axes. When they differ the set has gaps, which is useful audit signal. A plain component gets `1`.
- `description` is Figma's description, or `""`.
- `deprecated` is `true` when the name or description contains "deprecated", case-insensitive, otherwise `false`. Figma has no first-class flag, so this is a naming convention read deterministically.
- `figma.key` is `""` when the transport cannot supply it.

Only published components and component sets are included. Individual variants inside a set are not listed as their own entries.

## Token files

Standard DTCG 2025.10.

**A token's path is its collection followed by its name.** The Figma collection name is sanitised and split on `/` into the outermost groups, then the variable's own slash-separated name segments follow. A variable called `Typography/Size/2xl` in the `Tokens` collection is keyed `Tokens.Typography.Size.2xl`, and a collection called `Primitives/Spacing` opens two groups, so its `spacing-100` is keyed `Primitives.Spacing.spacing-100`. Apart from the character sanitisation in `references/figma-mapping.md`, group nesting mirrors Figma exactly.

This is what makes a token path a complete identity. DTCG identifies a token by its path alone and has no concept of collections, but Figma only requires a variable name to be unique *within* its collection — so without the collection in the path, two collections holding the same name cannot both be represented, and an alias from one to the other is indistinguishable from a token pointing at itself. Putting the collection at the front removes both problems by construction rather than by rule.

The collection group appears in `tokens.json` **and** in every `tokens/<collection>.<mode>.json`, even though a per-mode file holds one collection and the group is therefore constant within it. Uniformity is the point: one token has one path everywhere in the snapshot, and a cross-collection reference reads the same in every file.

```json
{
  "$schema": "https://www.designtokens.org/schemas/2025.10/format.json",
  "Primitives": {
    "colour": {
      "$type": "color",
      "brand": {
        "primary": {
          "$value": { "colorSpace": "srgb", "components": [0, 0.4, 0.8], "alpha": 1, "hex": "#0066cc" },
          "$extensions": {
            "io.github.tiagopedras-twinkl.ds-snapshot": {
              "figmaCollection": "Primitives",
              "figmaName": "colour/brand/primary",
              "figmaType": "COLOR",
              "figmaVariableId": "VariableID:12:340",
              "modes": {
                "Value": { "colorSpace": "srgb", "components": [0, 0.4, 0.8], "alpha": 1, "hex": "#0066cc" }
              }
            }
          }
        }
      }
    }
  }
}
```

Every token carries an extension object with at least `figmaName` (the original unsanitised Figma name, without its collection), `figmaCollection` (the original unsanitised collection name), `figmaType` (the Figma `resolvedType`) and `figmaVariableId` (Figma's own identifier for the variable). This is what makes the snapshot reversible: nothing about the source is lost to sanitisation. `figmaCollection` also gives the dependency layer an exact key — a capture labels a variable `<collection>/<name>`, which is precisely `figmaCollection` + `/` + `figmaName`, so nothing has to be re-derived or split on a separator that appears inside both halves.

`figmaCollection` and `figmaVariableId` are on tokens only. Text styles are not variables: they belong to no collection, so `typography.json` does not carry `figmaCollection` and its paths do not gain a group, and they carry `figmaStyleId` in place of a variable id.

### figmaVariableId, and what it is good for

`figmaVariableId` is Figma's own identifier, verbatim — `VariableID:12:340`. It is the only field in a snapshot that identifies a variable independently of what it is called or where it sits.

That makes it the right key for **comparing two snapshots of the same Figma file**. A token path changes whenever a designer renames a variable or moves it into a different group, and that happens often: between the 2026-08-04 and 2026-08-07 snapshots of *1. Foundations*, 339 of 456 variables kept everything about themselves except their path. On ids, those are 339 unchanged variables; on paths, they are 339 deletions and 339 additions, and the real changes are lost in the noise.

Its limits are as firm as its use:

- **It is unique within one Figma file and means nothing outside it.** Two libraries in different files may hand out the same id for unrelated variables. Only compare ids between snapshots whose `source.figmaFileKey` — or failing that, `source.figmaFileName` — is the same.
- **It survives a rename, a move and a value change; it does not survive deletion.** A variable deleted and recreated under the same name is a new id, correctly, because to Figma it is a new variable.
- **It says nothing about intent.** Two ids being equal means Figma considers them the same variable, no more. A rename that changes what a token *means* still reads as unchanged, so an id match is the start of a diff, not the end of one.
- **Ids are unique within each document.** No two tokens in one file may carry the same non-empty id; the validator rejects that, because it would mean one variable was written twice.

It is `""` when the transport cannot supply it, and the key is always present. Never omit it to signal absence. An empty id is not a failure, but it does mean this snapshot cannot be compared to another by variable, so the validator says so.

### modes, and why the per-mode files stay

Added in 2.1.0. Every token in `tokens.json` carries `modes` in its extension payload: an
object keyed by every mode its collection declares, whose values are exactly the `$value`
that mode's file gives the token. Mode names sort case-insensitively. The key is present on
every token, including those in a collection with a single mode, where it holds one entry —
uniformity costs a line and saves every consumer a special case.

It is in `$extensions` rather than in `$value` because DTCG has no concept of a mode and
there is no legal way to put five values on one token. `$extensions` is the spec's own
escape hatch: a tool that does not know the key ignores it and still reads a valid default.
Inventing a `$modes` sibling would make the file invalid, and every standard token tool
would stop reading it.

`modes` is only on tokens in `tokens.json`. A per-mode file holds one mode by definition, so
repeating it there would say nothing, and `typography.json` has no modes at all.

**The per-mode files stay, and are still the source.** Each is a standalone DTCG document
that Style Dictionary or Tokens Studio can open directly to build one theme, which an
extension payload can never be. `modes` exists so that one file can answer a theme question
— for a consumer reading over HTTP, or a browser tool handed a single file through a picker,
which cannot reach a sibling on disk at all.

Two copies of anything can disagree, so the validator compares them in both directions:
every mode a collection declares must be present on the token and equal the per-mode file's
value, and nothing a per-mode file holds may be missing from `modes`. That makes the copy
structural rather than a promise. When the two disagree, the per-mode file is right — it is
the one written from Figma.

### Merging into tokens.json

`tokens.json` holds each collection's default mode. Collections are merged in case-insensitive order of collection name, ties broken by byte order, which makes the result independent of the order Figma happened to return them in.

Because each collection occupies its own group, two variables from different collections can no longer land on the same path. Only two collisions remain possible, and both are recorded rather than resolved silently:

1. **Two collections whose names sanitise to the same group path.** The first by merge order keeps the group. Every variable of the second is left out and recorded once per variable in `notes.unmapped` as `kind: "variable"` with reason `token path already held by another collection`, plus one `kind: "collection"` entry with reason `collection group collides with another collection after sanitisation`.
2. **A collection group whose path is already occupied by a token from an earlier collection** — possible when one collection is named `Primitives` and another `Primitives/Spacing`, and the first holds a variable actually named `Spacing`. The incumbent token wins; the arriving variables are recorded with reason `token path already held by another collection`.

Collisions *within* one collection are a separate case, covered by `name collision after sanitisation` in `references/figma-mapping.md`.

No variable is ever dropped from `tokens.json` for merely sharing a name with a variable in another collection. If that appears in `notes.unmapped`, the export is wrong, not the library.

### Extension namespace

The spec requires a vendor-specific `$extensions` key and recommends reverse domain notation to avoid clashes between tools. The key identifies the tool that wrote the data, not the team that ran it, so it is `io.github.tiagopedras-twinkl.ds-snapshot` where `tiagopedras-twinkl` is the GitHub owner of this repository.

Substitute `OWNER` once, when you fork or publish the repo, in three places: this file, `references/figma-mapping.md`, and `tests/build-fixture.mjs`. The validator rejects any snapshot that still contains the literal placeholder, and rejects a snapshot that mixes more than one namespace.

Do not use your organisation's namespace here. Every consumer of a snapshot has to read this key, so it belongs to the tool and stays the same no matter who runs it. Changing it after the first real snapshot is a contract change.

## typography.json

Text styles as `typography` composite tokens, grouped by their slash-separated Figma name.

```json
{
  "$schema": "https://www.designtokens.org/schemas/2025.10/format.json",
  "heading": {
    "$type": "typography",
    "level-1": {
      "$value": {
        "fontFamily": "Inter",
        "fontSize": { "value": 42, "unit": "px" },
        "fontWeight": 700,
        "letterSpacing": { "value": 0.1, "unit": "px" },
        "lineHeight": 1.2
      },
      "$extensions": {
        "io.github.tiagopedras-twinkl.ds-snapshot": {
          "figmaName": "Heading/Level 1",
          "figmaStyleId": "S:abc123",
          "figmaLineHeight": { "unit": "PERCENT", "value": 120 }
        }
      }
    }
  }
}
```

`fontFamily`, `fontSize` and `fontWeight` are always present. `letterSpacing` and `lineHeight` are omitted only in the cases `references/figma-mapping.md` defines, and when omitted the reason is recorded in `$extensions`.

`figmaStyleId` is written as `S:<key>` — the key only, with no trailing comma and no node suffix. Figma reports the same style under two different ids: `S:<key>,` in the file that owns it, and `S:<key>,<localNodeId>` on a text node in a file that uses it. Only `<key>` is common to both, so it is the only part worth storing. Write it as `id.split(",")[0]` whichever id you have. The dependency layer matches a component's text styles against this field, and `references/dependency-capture.md` explains what a raw id costs there.

## dependencies.json — optional, added in 1.1.0

The links between things the rest of the snapshot already names. It is not a second inventory: apart from `nestsUncaptured` and `unresolvedBindings`, which exist precisely to record what the snapshot does *not* hold, every id and path in this file must resolve in `tokens.json`, `typography.json`, or `components.json`.

```json
{
  "schemaVersion": "2.1.0",
  "aliases": [
    { "from": "Semantic.action.primary", "to": "Primitives.colour.blue.500", "mode": "Light" }
  ],
  "components": [
    {
      "id": "actions/button",
      "bindings": [
        { "token": "Primitives.space.sm", "properties": ["itemSpacing", "paddingLeft"] }
      ],
      "typography": ["body.base"],
      "nests": [{ "id": "actions/icon", "count": 6 }],
      "nestsUncaptured": [{ "name": "ArrowRight", "count": 6 }],
      "unresolvedBindings": [{ "figmaName": "Tokens/Icon/icon", "properties": ["fills"] }]
    }
  ]
}
```

Field rules:

- **`aliases`** is one entry per variable per mode, so the same `from` and `to` pair repeats across modes. That repetition is the data: a token can point at a different primitive in each theme. Both ends are token paths as keyed in `tokens.json`, so both name their collection and a cross-collection alias is stated as plainly as any other. Sorted by `from`, then `mode`.
- `from` and `to` are never equal. A token cannot alias itself, and since 2.0.0 a token in one collection aliasing a same-named token in another is two distinct paths, so it is recorded like any other alias rather than collapsing into a self-reference.
- Every alias must agree with the reference already in the matching `tokens/<collection>.<mode>.json`. The validator checks both directions, which is what stops this file drifting from the token files it summarises.
- **`components`** has one entry per walked component that has at least one link, sorted by `id`. A component with no dependencies at all is left out — its absence is not a gap, and `components.json` already lists it.
- All five keys inside an entry are always present, as arrays, empty when there is nothing. Never omit a key to signal absence.
- **`bindings[].token`** is a path into `tokens.json`, collection included. **`properties`** is the Figma `boundVariables` keys, e.g. `fills`, `strokes`, `paddingLeft`, sorted. A token appears at most once per component, with its properties merged. Two Figma variables that share a name but sit in different collections are two tokens here and get an entry each — before 2.0.0 they were merged into one, which is exactly the loss that version removed.
- **`typography`** is paths into `typography.json`, sorted.
- **`nests[].id`** is a component in `components.json`, with `count` instances found. Sorted by `id`.
- **`nestsUncaptured`** is for a nested component that was not walked — usually one living in a Figma file the bridge was not paired with, or a private part. Kept by raw Figma `name`, sorted. This is how a real dependency on something outside the snapshot stays visible instead of looking like a component with no dependencies.
- **`unresolvedBindings`** is for a binding whose variable maps to no token in this snapshot, kept by raw `figmaName`. Sorted by `figmaName`. A dangling link is a finding, not a reason to drop the link.

Both `nestsUncaptured` and `unresolvedBindings` being empty means the snapshot is closed: everything anything depends on is in it. That is the useful thing to report to the user.
