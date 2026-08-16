# Sourcing from Figma

Figma is the richest source of the three, but a token dump alone still isn't
enough — it tells you what exists, not how it's actually composed on a page.
Use two layers together: a `ds-snapshot` (or a live equivalent) for exact
token values, and rendered screenshots for the prose that describes how those
tokens combine.

## Layer 1 — tokens, text styles, components

**Prefer a `ds-snapshot` over reading Figma live**, when one exists and is
recent:

- Check for `ds-snapshots/<date>/` (or a `.bundle.json`) in the current
  project. If one exists and is reasonably fresh, read `tokens.json`,
  `typography.json`, and `components.json` directly — this is already
  DTCG-format, already validated, and cheaper than re-querying Figma.
- If it's stale or missing and the user wants a one-off document rather than
  a maintained snapshot, it's fine to read Figma live instead of invoking the
  full `ds-snapshot` skill. But if the user is going to want this file kept
  in sync over time, or wants the dependency layer (what components bind
  which tokens), point them at `ds-snapshot` instead of duplicating its work
  here.

**Reading live**, when no snapshot applies:

- Confirm the Desktop Bridge is paired (`figma_get_status` with
  `probe: true`) before anything else, exactly as `ds-snapshot` does. Don't
  fall back to the REST transport for variable reads — same reasoning as
  that skill: unreliable on non-Enterprise plans, and a partial capture is
  worse than none.
- `figma_get_variables` / `figma_export_tokens` for colour and spacing/radius
  variables, `figma_get_styles` for text styles, `figma_get_design_system_kit`
  plus `figma_analyze_component_set` for the component inventory. This is
  exactly `ds-snapshot`'s step 2, 4, and 5 — reuse its
  `references/figma-mapping.md` for the DTCG conversion rules rather than
  improvising unit or line-height conversions.
- **A design system spanning several files** (a common Foundations /
  Components / Modules split) needs the bridge paired on every file whose
  components you want to read. Variables and text styles resolve across
  files on their own; components don't. Ask which files are open with
  `figma_list_open_files` before starting, same as `ds-snapshot` does.

## Layer 2 — how it's actually used

A token map doesn't tell you that the search bar is the one fully-rounded
element on an otherwise square-cornered page, or that a rating number is
rendered four times larger than any other text on the site. That's what the
five reference examples in this format are full of, and it only comes from
looking at real frames:

- `figma_capture_screenshot` or `figma_get_component_image` on the frames
  that represent the product's key surfaces — home/marketing page, a primary
  list or card view, a detail view, a form. Pick surfaces the way you would
  pick pages to review on a live site: the ones that show the system doing
  real work, not an isolated component sheet.
- For each surface, note: which tokens actually appear together (a card's
  radius + shadow + padding as a set, not as three separate facts), where
  colour is used sparingly versus generously, what shape language repeats
  (are corners uniformly soft, or is roundness reserved for one category of
  element), and what the elevation actually looks like at rest versus
  raised.
- This is what grounds `## Overview`, `## Elevation`, `## Shapes`, and the
  per-component paragraphs under `## Components` — the frontmatter tokens on
  their own only ground the `## Colors` and `## Typography` sections.

## Mapping to the frontmatter

Follow the same collection/mode/id logic `ds-snapshot` uses if you're reading
a snapshot — `references/figma-mapping.md` in that skill covers unit and
name conversion in detail; don't re-derive it here. In short:

- **`colors`** — one entry per token actually bound to something visible on
  the surfaces you looked at, renamed to this format's role-based convention.
  A token that exists in the library but never appears on a real surface is
  a candidate for Known Gaps ("N further tokens exist in the library but
  weren't observed in use"), not a silent inclusion.
- **`typography`** — one entry per text style, using the style's own name as
  the mapping note.
- **`rounded` / `spacing`** — from the variable collections that hold them,
  or, if the library doesn't formalise these as variables, clustered from
  what the component inventory's frame sizes and paddings actually show —
  say which, in `## Layout`.
- **`components`** — from the component inventory, one entry per component
  or component-set default, cross-checked against the screenshots for
  anything the inventory alone wouldn't show (composition, spacing between
  sibling elements, which variant is actually the one used on real pages).

## What Figma usually can't give you

- **Which variant is "the default" in practice.** The library may expose ten
  variants of a button with no signal about which one ships most often —
  the screenshots answer this; the inventory alone doesn't.
- **Responsive behaviour**, unless the file explicitly includes breakpoint
  frames. A component library built for one canvas size doesn't imply
  anything about how it reflows.
- **Anything that only exists in code** — loading states, animation,
  real-data edge cases (a genuinely empty list, a five-line title wrapping).
  Say so in Known Gaps rather than guessing from the static frame.
