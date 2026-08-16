# The design.md format

A DESIGN.md is a design token frontmatter block plus a prose write-up, in that
order, in one file. The frontmatter is what a tool reads; the prose is what a
person reads. Every value in the prose has to trace back to a token in the
frontmatter or an explicit note that it couldn't be captured — nothing floats
free between the two halves.

This spec was reverse-engineered from six real examples: Airbnb, Apple,
Claude, Linear, Notion, and an early pass at Twinkl. They don't all use every
section — the table below marks what's actually universal versus what most of
them add. Treat the universal set as the floor, not the ceiling.

## Frontmatter

YAML, opened and closed with `---`, in this key order:

| Key | Shape | Notes |
|---|---|---|
| `version` | string | `alpha` in every example so far. Bump when the shape of a *specific* file changes in a breaking way. |
| `name` | string | `<Product>-design-analysis` or similar. |
| `description` | string | One dense paragraph, written to stand alone with no other context — this is what a search or a preview card shows. Names the canvas colour, the accent, the type voice, and the one or two things that make this system recognisable, not a generic summary. |
| `colors` | map | Flat: token name → hex, or an `rgba(...)` string for anything that's only ever used at partial opacity (scrims, overlays). No nesting. |
| `typography` | map | Named type styles (`display-xl`, `body-md`, `caption`, …), each an object with `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, and `textTransform` where relevant. |
| `rounded` | map | A corner-radius scale, smallest to largest, ending in `full` or `pill` for fully-rounded. |
| `spacing` | map | A spacing scale, smallest to largest, ending in `section` — the vertical rhythm between major page bands. |
| `components` | map | The composed pieces. See below. |

**Every value inside `components:` references the scales above** —
`{colors.primary}`, `{typography.button}`, `{rounded.md}`, `{spacing.lg}` —
never a raw hex or a bare pixel number. A raw value inside `components:` means
either a token is missing from `colors`/`typography`/`rounded`/`spacing`, or
the component genuinely uses a one-off value, in which case say so in prose
rather than smuggling it in as if it were a token.

**Variants are separate entries, not modifiers.** `button-primary`,
`button-primary-active`, `button-primary-disabled` are three keys in
`components:`, not one key with a `states:` sub-object. This is what lets a
consumer reference exactly one state by its token name.

## Body sections, in order

| # | Section | Universal? | What it covers |
|---|---|---|---|
| 1 | `## Overview` | Yes | The system in prose — a few paragraphs — then a "Key Characteristics" bullet list. This is the section most likely to be read on its own; write it that way. |
| 2 | `## Colors` | Yes | Broken into `### Brand & Accent`, `### Surface`, `### Text`, `### Hairlines & Borders`, `### Semantic`, and, only when the source actually has one, `### Scrim` or `### Brand Gradient`. Every token gets a sentence: what it is, where it's actually used — not just its hex. |
| 3 | `## Typography` | Yes | `### Font Family` (including fallback stack and where to substitute an open font for a licensed one), a `### Hierarchy` table (token, size, weight, line-height, tracking, use), `### Principles` (the *why*: which weights are load-bearing, where tracking goes negative, what's deliberately absent), and `### Note on Font Substitutes`. |
| 4 | `## Layout` | Yes | `### Spacing System` (base unit + the scale), `### Grid & Container` (max width, column counts), `### Whitespace Philosophy` (one paragraph on the pacing this system goes for). |
| 5 | `## Elevation` or `## Elevation & Depth` | Yes | A table of shadow/surface tiers, flat-to-deepest, plus `### Decorative Depth` for anything that substitutes for shadow (colour-block alternation, photography, gradients, illustration). |
| 6 | `## Shapes` | Common, not universal | The `### Border Radius Scale` as a table (token → value → use) when it needs more explanation than the Layout section gives it, plus how imagery gets cropped. Skip this section — don't leave it empty — when the radius scale is simple enough that `## Overview` and the `components:` entries already say everything worth saying. |
| 7 | `## Components` | Yes | Grouped by kind — Buttons, Navigation, Cards & Containers, Inputs & Forms, Tags/Badges, Footer, and whatever else the product actually has. Each one: token name in backticks, a short paragraph on what it looks like and where it's used. |
| 8 | `## Do's and Don'ts` | Common, not universal | Short, opinionated, written for someone about to extend the system. `### Do` / `### Don't`. |
| 9 | `## Responsive Behavior` | Common, not universal | A breakpoints table, `### Touch Targets`, `### Collapsing Strategy`, `### Image Behavior`. |
| 10 | `## Iteration Guide` | Occasional | A numbered list of rules for an agent or designer editing *this document*. Worth adding when the file is likely to be extended by something other than a person re-reading the whole thing first. |
| 11 | `## Known Gaps` | Common, not universal, always last when present | What the source didn't show — hover styling policy aside, this is anything genuinely absent: unseen error states, a sub-brand palette that lives elsewhere, animation timings, dark-mode counterparts that weren't in scope. |

A product-specific section (Twinkl's `## Imagery & Illustration`, for
instance) is fine when the product genuinely has something none of the
existing sections cover well. Insert it where it reads naturally — after
`Components` is the common spot — rather than bolting it on at the end.

## Rules that hold regardless of source

- **Never document `:hover`.** Every file in this family documents Default
  and Active/Pressed only. Hover is unreliable to extract accurately and adds
  noise a token consumer can't act on. This is deliberate, not a gap — don't
  list it under Known Gaps either.
- **Never invent a value.** A plausible-looking hex, a "probably 8px" radius,
  or an error state nobody actually saw is worse than a gap that says so.
  Every real example in this family ends with a `Known Gaps` section that
  admits exactly this — form validation states, dark-mode counterparts,
  animation timings, sub-brand palettes living elsewhere. Do the same rather
  than filling a thin section.
- **Token references, not raw values, inside `components:`.** See above.
- **The description stands alone.** Someone reading only the frontmatter
  `description` should get the same mental picture as someone reading the
  whole `## Overview`.
