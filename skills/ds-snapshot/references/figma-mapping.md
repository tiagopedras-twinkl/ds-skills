# Figma to DTCG 2025.10 mapping

Every rule here is fixed. When a case is not covered, do not guess: record the item in `manifest.notes.unmapped` with a reason and leave it out of the token files. A gap that is visible in the manifest is recoverable. A guess that looks like data is not.

Reference: Design Tokens Format Module 2025.10, https://www.designtokens.org/TR/2025.10/format/

## Collections are groups

A token's path is **its collection followed by its name**. Sanitise the collection name by the rules below and prepend its segments, then the variable's own segments. `Typography/Size/2xl` in the `Tokens` collection is `Tokens.Typography.Size.2xl`; `spacing-100` in a collection called `Primitives/Spacing` is `Primitives.Spacing.spacing-100`.

This holds in `tokens.json` and in every `tokens/<collection>.<mode>.json`, so one variable has one path everywhere. Do not omit the collection group from a per-mode file on the grounds that the file only holds one collection.

Figma only requires a variable name to be unique within its collection, so the collection is half the identity. A path that leaves it out cannot hold two collections' `Typography/Size/2xl`, and cannot express one aliasing the other — the reference comes out looking like a token pointing at itself. Both of those were real losses in contract 1.x. See `references/output-contract.md`, "Token files" and "Reading a snapshot written before 2.0.0".

## Name sanitisation

DTCG forbids `.`, `{` and `}` anywhere in a token or group name, and forbids a leading `$`. Figma allows all of them. The same rules apply to a collection name and to a variable name.

1. Split the Figma name on `/`. Each segment becomes a group; for a variable name the last segment becomes the token, and every segment of a collection name is a group.
2. In each segment, replace `.` `{` `}` with `-`.
3. Trim whitespace from each segment. Collapse runs of internal whitespace to a single space.
4. If a segment then starts with `$`, prefix it with `_`. Trimming comes first, or a segment written ` $foo` would keep its leading `$`.
5. Drop empty segments.
6. Always write the original variable name to `$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaName` and the original collection name to `.figmaCollection`, each unsanitised and separate from the other. Write Figma's own `id` for the variable to `.figmaVariableId`, verbatim and unaltered — it is the only handle on a variable that a rename cannot break, and `references/output-contract.md` sets out what it may and may not be compared against.

If sanitisation makes two tokens collide **within the same collection**, keep the first by Figma's own order and put the second in `manifest.notes.unmapped` with reason `name collision after sanitisation`. Do not silently overwrite and do not append a numeric suffix, which would produce a token name that exists nowhere in Figma.

Two variables in *different* collections that sanitise to the same name are not a collision at all — their collection groups keep them apart. If one is ever dropped for that reason, the export is wrong. The residual collision between two *collection* names is handled in `references/output-contract.md`, "Merging into tokens.json".

## Variable types

Map from Figma `resolvedType`, then narrow using `scopes`. Scopes are the only deterministic signal for whether a Figma number is a dimension or a plain number, so use them rather than inferring from the name.

| Figma resolvedType | Scopes include | `$type` | `$value` shape |
| --- | --- | --- | --- |
| `COLOR` | any | `color` | `{ colorSpace, components, alpha, hex }` |
| `FLOAT` | `WIDTH_HEIGHT`, `GAP`, `CORNER_RADIUS`, `STROKE_FLOAT`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`, `TEXT_CONTENT` spacing, `FONT_SIZE`, `LETTER_SPACING` | `dimension` | `{ value, unit: "px" }` |
| `FLOAT` | `LINE_HEIGHT` | `number` | plain number, as a multiplier |
| `FLOAT` | `FONT_WEIGHT` | `fontWeight` | number 1 to 1000 |
| `FLOAT` | `OPACITY`, `EFFECT_FLOAT` | `number` | plain number |
| `FLOAT` | `ALL_SCOPES`, empty, or mixed dimension and non-dimension scopes | `number` | plain number |
| `STRING` | `FONT_FAMILY` | `fontFamily` | string |
| `STRING` | anything else | `string` | string |
| `BOOLEAN` | any | `boolean` | `true` or `false` |

Notes:

- `dimension` requires a unit even when the value is `0`. Figma numbers are px, so the unit is always `"px"`; never emit `rem`.
- A `FLOAT` with mixed scopes falls back to `number` deliberately. Guessing `dimension` from a name like `spacing/md` would be right often and wrong invisibly.
- `string` and `boolean` are not defined in section 8 of the spec. They are used because dropping the variables would lose real design system data. Every `$type` used that the spec does not define must be listed in `manifest.notes.nonStandardTypes`.

## Colours

Figma gives `{ r, g, b, a }` as floats from 0 to 1, which is already the DTCG `srgb` component form.

```json
{ "colorSpace": "srgb", "components": [0, 0.4, 0.8], "alpha": 1, "hex": "#0066cc" }
```

- `components` is `[r, g, b]`, each rounded to 4 decimal places. Do not multiply by 255.
- `alpha` is always present, rounded to 4 decimal places, `1` when Figma reports no alpha.
- `hex` is always present, lowercase, six digits, computed from the components with alpha ignored. It is optional in the spec but included because most downstream consumers still want it.
- Gradients and image fills are not variables and never appear here.

## Aliases

A Figma variable whose value is `VARIABLE_ALIAS` becomes a DTCG curly-brace reference to the sanitised path of its target, **collection included**: `"$value": "{Primitives.colour.brand.primary}"`.

- Resolve the alias target's sanitised path, not its raw name. Read the target's own collection from Figma and put that at the front; never assume the target shares the collection of the variable pointing at it.
- Keep the reference. Never inline the resolved value. Aliases are the shape of the system and flattening them destroys the audit's most useful information.
- A cross-collection alias is therefore always distinguishable from a self-reference, because the two paths differ in their first group. In contract 1.x it was not, and the two were confused. If an alias ever comes out with its target equal to its source, it is a real cycle in Figma.
- The reference resolves inside `tokens.json`, because all default modes of all collections are merged there. In a per-mode file the target of a cross-collection alias is by definition absent: emit the reference anyway and record one entry in `manifest.notes.unmapped` per mode file with reason `cross-collection alias unresolvable in mode file`, named `tokens/<collection>.<mode>.json (<n> references)`. Never one entry per reference. The validator reports these as warnings, not errors, for exactly this case.
- If an alias chain is genuinely circular, omit every token in the chain and record one entry with `kind: "alias"` and reason `circular alias chain`, named as the chain in order starting at its lowest path. Circular references are invalid DTCG.

## Modes

DTCG 2025.10 has no concept of modes or themes, so modes cannot be expressed inside one document. This is why the contract uses one file per collection and mode instead of inventing a mode key that no other tool would understand.

- `tokens.json` contains each collection's default mode only, merged in case-insensitive collection-name order.
- `tokens/<collection>.<mode>.json` contains one collection resolved in one mode, including collections with a single mode. Its tokens still carry the collection group, so paths match `tokens.json` exactly.
- A collection with three modes produces three files, all listed in `manifest.files`.

Two collections may hold a variable of the same name and give it a different type — one scoped `FONT_SIZE` yielding `dimension`, the other `ALL_SCOPES` yielding `number`. Since 2.0.0 they are separate tokens at separate paths, so each keeps its own `$type` and no reconciliation rule is needed. Do not normalise them to a common type: the divergence is real and worth seeing.

## Text styles

Figma text styles are not variables. Read them with `figma_get_styles` and map to `typography` composite tokens.

- `fontFamily`: the family name as a string. If the style's font is bound to a variable, emit a reference to that variable's path instead.
- `fontSize`: `{ value, unit: "px" }`.
- `fontWeight`: map the Figma style name to its numeric OpenType weight (`Thin` 100, `Extra Light` 200, `Light` 300, `Regular` 400, `Medium` 500, `Semi Bold` 600, `Bold` 700, `Extra Bold` 800, `Black` 900). Unrecognised style names default to `400` and are recorded in `manifest.notes.unmapped` with reason `unrecognised font style, defaulted to 400`. Italic and other axes are not part of the `typography` type; record the raw style name in `$extensions`.
- `letterSpacing`: `PIXELS` maps directly to `{ value, unit: "px" }`. `PERCENT` converts to px as `percent / 100 * fontSize`, rounded to 4 decimal places, with the original recorded in `$extensions.figmaLetterSpacing`. DTCG dimensions allow only px and rem, so there is no way to keep a percentage as such.
- `lineHeight`: DTCG expects a unitless multiplier of the font size.
  - `PERCENT` becomes `percent / 100`.
  - `PIXELS` becomes `pixels / fontSize`, rounded to 4 decimal places.
  - `AUTO` has no faithful numeric equivalent. Omit `lineHeight` entirely and record `{ "unit": "AUTO" }` in `$extensions.figmaLineHeight`. Do not substitute `1` or `1.2`: a fabricated multiplier would read as a real design decision.
  - In every case record the original in `$extensions.figmaLineHeight`.

## Effect and grid styles

Out of scope for the contract as of v2.1.0. Do not add them to a snapshot ad hoc. If they are needed, change the contract properly: bump `schemaVersion`, add the file to the layout, and update the validator.
