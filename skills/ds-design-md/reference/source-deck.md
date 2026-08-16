# Sourcing from a brand guidelines deck

A brand deck (PDF, Keynote, a slides file, or a standalone HTML deck like the
ones in `twinkl-decks/`) states *intent* — the colour palette, the logo
lockups, the type specimens, sometimes a voice-and-tone page. It almost never
states *implementation* — no button padding, no shadow values, no component
states, no breakpoints. Expect a thinner file than a repo or a Figma library
would produce, and let it be thin rather than padding it out.

## Reading the deck

- **PDF** — use the `pages` parameter on Read to page through it; a brand
  deck's swatch and type-specimen pages are usually near the front.
- **Keynote / slides exported as PDF or images** — same approach; if only
  images are available, read them as images and transcribe what's stated on
  each slide (hex values and type specs are often printed directly on the
  swatch).
- **A standalone HTML deck** — read the file directly; check for a `<style>`
  block or inline CSS custom properties before transcribing anything by eye,
  since the deck's own build may already encode the palette as tokens.

## What a deck typically gives you

- **Colour palette** — usually complete and exact: primary, secondary,
  neutrals, sometimes a stated tint/shade ramp. This maps directly to
  `colors`.
- **Type specimens** — typeface names and a size/weight scale, sometimes with
  named roles ("Display", "Headline", "Body"). Maps to `typography`, but decks
  rarely state line-height or letter-spacing precisely — read them off the
  specimen if shown at real size, and say in Known Gaps when a value had to
  be estimated rather than read.
- **Logo and lockup rules** — spacing, clear space, minimum size. This
  doesn't map to any frontmatter field; note it in `## Overview` as prose if
  it's central to the brand, otherwise skip it — it's not a design token.
- **Voice and tone** — sometimes present as adjectives or example copy. This
  is the best source for `### Principles` under Typography and for the
  framing paragraph in `## Overview` — a deck is often the *only* source that
  states the intended feeling in words, which a codebase or a Figma file
  never will.

## What a deck almost never gives you

Say plainly in `## Known Gaps` whenever these weren't in the deck — don't
guess a plausible SaaS default:

- Spacing scale, border-radius scale, shadow/elevation values.
- Component-level detail (button states, card composition, form field
  chrome) — a deck shows the logo and the palette, not a button.
- Breakpoints or responsive behaviour.
- Exact hex for anything shown only as a printed swatch photographed under
  studio lighting — if the deck states the hex directly, use that over
  eyeballing the swatch colour.

If a deck is the *only* source, the resulting file will lean heavily on
`## Overview`, `## Colors`, and `## Typography`, with `## Layout`,
`## Shapes`, `## Elevation`, `## Components`, and `## Responsive Behavior`
either thin, structurally present but explicitly marked as unconfirmed, or
skipped with a note in `## Known Gaps` — whichever is true, don't leave a
reader to guess which. When the user also has a repo or a Figma library for
the same brand, prefer that source for anything below the palette/type layer
and use the deck only for what it uniquely provides: the palette's intent and
the voice.
