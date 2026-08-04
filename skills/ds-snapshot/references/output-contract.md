# Output contract v1.1.0

Every snapshot has exactly this layout. No extra files, no missing files.

```
ds-snapshots/<YYYY-MM-DD>/
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
  "schemaVersion": "1.1.0",
  "generator": { "skill": "ds-snapshot", "skillVersion": "1.1.0" },
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
- `notes.unmapped` records anything Figma returned that this contract cannot hold, one entry per item: `{ "kind": "variable", "name": "...", "reason": "..." }`. An empty array is a clean snapshot; a populated one is a signal, not a failure.
- `dependencies` is always present. When the layer was skipped it is `{ "captured": false, "sources": [], "counts": { … all zero } }` and `dependencies.json` is absent. Never omit the block to signal that the layer did not run.
- `dependencies.sources` lists every Figma file walked for components, sorted by `figmaFileName`, and `componentsWalked` is how many top-level components each contributed. A file the user asked for but that was not connected does not appear here — it belongs in `notes.unmapped` with reason `file not connected, components not walked`, so the gap is on the record.
- `dependencies.counts` are totals across `dependencies.json` and are cross-checked by the validator, so they cannot drift from the data.

## components.json

```json
{
  "schemaVersion": "1.1.0",
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
- `source` is the name of the Figma file the component came from, added in 1.1.0. It is always present, and is the same value for every entry when the library is one file. Two components from different files that slug to the same `id` cannot both be kept: keep the first by `source` then Figma order, and record the second in `notes.unmapped` with reason `duplicate component id across source files`. Suffixing the id would produce an id that exists in no Figma file.
- `name` is the last segment of the Figma name. `path` is the preceding segments in order, `[]` for a top-level component.
- `kind` is `component` or `componentSet`.
- `variants` maps each variant axis to its sorted values. A plain component gets `{}`.
- `variantCombinations` is how many variants the set actually contains, not the product of the axes. When they differ the set has gaps, which is useful audit signal. A plain component gets `1`.
- `description` is Figma's description, or `""`.
- `deprecated` is `true` when the name or description contains "deprecated", case-insensitive, otherwise `false`. Figma has no first-class flag, so this is a naming convention read deterministically.
- `figma.key` is `""` when the transport cannot supply it.

Only published components and component sets are included. Individual variants inside a set are not listed as their own entries.

## Token files

Standard DTCG 2025.10. Figma variable collections and slash-separated name segments become nested groups. Group nesting mirrors Figma exactly, apart from the character sanitisation in `references/figma-mapping.md`.

```json
{
  "$schema": "https://www.designtokens.org/schemas/2025.10/format.json",
  "colour": {
    "$type": "color",
    "brand": {
      "primary": {
        "$value": { "colorSpace": "srgb", "components": [0, 0.4, 0.8], "alpha": 1, "hex": "#0066cc" },
        "$extensions": { "io.github.tiagopedras-twinkl.ds-snapshot": { "figmaName": "colour/brand/primary", "figmaType": "COLOR" } }
      }
    }
  }
}
```

Every token carries an extension object with at least `figmaName` (the original unsanitised Figma name) and `figmaType` (the Figma `resolvedType`). This is what makes the snapshot reversible: nothing about the source is lost to sanitisation.

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
  "schemaVersion": "1.1.0",
  "aliases": [
    { "from": "action.primary", "to": "colour.blue.500", "mode": "Light" }
  ],
  "components": [
    {
      "id": "actions/button",
      "bindings": [
        { "token": "space.sm", "properties": ["itemSpacing", "paddingLeft"] }
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

- **`aliases`** is one entry per variable per mode, so the same `from` and `to` pair repeats across modes. That repetition is the data: a token can point at a different primitive in each theme. Both ends are token paths as keyed in `tokens.json`. Sorted by `from`, then `mode`.
- Every alias must agree with the reference already in the matching `tokens/<collection>.<mode>.json`. The validator checks both directions, which is what stops this file drifting from the token files it summarises.
- **`components`** has one entry per walked component that has at least one link, sorted by `id`. A component with no dependencies at all is left out — its absence is not a gap, and `components.json` already lists it.
- All five keys inside an entry are always present, as arrays, empty when there is nothing. Never omit a key to signal absence.
- **`bindings[].token`** is a path into `tokens.json`. **`properties`** is the Figma `boundVariables` keys, e.g. `fills`, `strokes`, `paddingLeft`, sorted. A token appears at most once per component, with its properties merged — two Figma variables sharing a name are one token here.
- **`typography`** is paths into `typography.json`, sorted.
- **`nests[].id`** is a component in `components.json`, with `count` instances found. Sorted by `id`.
- **`nestsUncaptured`** is for a nested component that was not walked — usually one living in a Figma file the bridge was not paired with, or a private part. Kept by raw Figma `name`, sorted. This is how a real dependency on something outside the snapshot stays visible instead of looking like a component with no dependencies.
- **`unresolvedBindings`** is for a binding whose variable maps to no token in this snapshot, kept by raw `figmaName`. Sorted by `figmaName`. A dangling link is a finding, not a reason to drop the link.

Both `nestsUncaptured` and `unresolvedBindings` being empty means the snapshot is closed: everything anything depends on is in it. That is the useful thing to report to the user.
