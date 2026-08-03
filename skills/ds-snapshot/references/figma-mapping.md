# Figma to DTCG 2025.10 mapping

Every rule here is fixed. When a case is not covered, do not guess: record the item in `manifest.notes.unmapped` with a reason and leave it out of the token files. A gap that is visible in the manifest is recoverable. A guess that looks like data is not.

Reference: Design Tokens Format Module 2025.10, https://www.designtokens.org/TR/2025.10/format/

## Name sanitisation

DTCG forbids `.`, `{` and `}` anywhere in a token or group name, and forbids a leading `$`. Figma allows all of them.

1. Split the Figma name on `/`. Each segment becomes a group, the last becomes the token.
2. In each segment, replace `.` `{` `}` with `-`.
3. If a segment starts with `$`, prefix it with `_`.
4. Trim whitespace from each segment. Collapse runs of internal whitespace to a single space.
5. Drop empty segments.
6. Always write the original name to `$extensions["io.github.tiagopedras-twinkl.ds-snapshot"].figmaName`.

If sanitisation makes two tokens collide within the same group, keep the first by Figma's own order and put the second in `manifest.notes.unmapped` with reason `name collision after sanitisation`. Do not silently overwrite and do not append a numeric suffix, which would produce a token name that exists nowhere in Figma.

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

A Figma variable whose value is `VARIABLE_ALIAS` becomes a DTCG curly-brace reference to the sanitised path of its target: `"$value": "{colour.brand.primary}"`.

- Resolve the alias target's sanitised path, not its raw name.
- Keep the reference. Never inline the resolved value. Aliases are the shape of the system and flattening them destroys the audit's most useful information.
- When the target is in a different collection, the reference still works inside `tokens.json` because all default modes are merged there. In a per-mode file where the target is absent, emit the reference anyway and record the item in `manifest.notes.unmapped` with reason `cross-collection alias unresolvable in mode file`. The validator reports unresolvable references in per-mode files as warnings, not errors, for exactly this case.
- If an alias chain is circular, record every token in the chain in `manifest.notes.unmapped` and omit them. Circular references are invalid DTCG.

## Modes

DTCG 2025.10 has no concept of modes or themes, so modes cannot be expressed inside one document. This is why the contract uses one file per collection and mode instead of inventing a mode key that no other tool would understand.

- `tokens.json` contains each collection's default mode only.
- `tokens/<collection>.<mode>.json` contains one collection resolved in one mode, including collections with a single mode.
- A collection with three modes produces three files, all listed in `manifest.files`.

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

Out of scope for v1.0.0 of the contract. Do not add them to a snapshot ad hoc. If they are needed, change the contract properly: bump `schemaVersion`, add the file to the layout, and update the validator.
