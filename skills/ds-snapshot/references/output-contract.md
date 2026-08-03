# Output contract v1.0.0

Every snapshot has exactly this layout. No extra files, no missing files.

```
ds-snapshots/<YYYY-MM-DD>/
├── manifest.json                        what this snapshot is
├── tokens.json                          DTCG 2025.10, default mode of every collection, merged
├── tokens/
│   └── <collection>.<mode>.json         DTCG 2025.10, one file per collection x mode
├── typography.json                      DTCG 2025.10, text styles as typography tokens
└── components.json                      component inventory
```

`<collection>` and `<mode>` are slugs: lowercase, non-alphanumerics collapsed to single hyphens, no leading or trailing hyphen. `Brand Colours` and `Dark Mode` become `tokens/brand-colours.dark-mode.json`.

Every token file, including `tokens.json` and `typography.json`, is a standalone valid DTCG document and carries:

```json
"$schema": "https://www.designtokens.org/schemas/2025.10/format.json"
```

## Ordering and formatting

These rules exist so that `git diff` between two snapshot folders shows design changes and nothing else.

1. Two-space indent, LF line endings, single trailing newline, UTF-8.
2. Within any object, `$`-prefixed properties come first in this order: `$schema`, `$type`, `$description`, `$deprecated`, `$value`, `$extensions`. All other keys follow, sorted case-insensitively, ties broken by byte order.
3. Arrays of records (`components`, `collections`, `files`) sort by their `id`, or by `name` when there is no id.
4. Variant axis names sort case-insensitively. Variant values within an axis sort case-insensitively. Figma's own ordering is not preserved: it is presentation, not data, and preserving it creates diff noise.
5. `manifest.exportedAt` is the only field expected to change when nothing in Figma changed. It lives in the manifest alone, never in the token or component files.
6. Round all floating point numbers to 4 decimal places.

## manifest.json

```json
{
  "schemaVersion": "1.0.0",
  "generator": { "skill": "ds-snapshot", "skillVersion": "1.0.0" },
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
    { "path": "components.json", "kind": "components" }
  ],
  "counts": {
    "variables": 412,
    "typographyStyles": 38,
    "components": 55,
    "componentSets": 41
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
- `collections[].id` is the collection name slug. `modes` includes `defaultMode` and sorts case-insensitively.
- `files` lists every file in the snapshot except `manifest.json` itself, and nothing else. The validator compares it against the directory in both directions.
- `counts.variables` counts variable definitions once, not once per mode, so it equals the leaf token count in `tokens.json`.
- `notes.nonStandardTypes` lists `$type` values used that the DTCG spec does not define, currently only `boolean` and `string`. Empty array when none.
- `notes.unmapped` records anything Figma returned that this contract cannot hold, one entry per item: `{ "kind": "variable", "name": "...", "reason": "..." }`. An empty array is a clean snapshot; a populated one is a signal, not a failure.

## components.json

```json
{
  "schemaVersion": "1.0.0",
  "components": [
    {
      "id": "actions/button",
      "name": "Button",
      "path": ["Actions"],
      "kind": "componentSet",
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
