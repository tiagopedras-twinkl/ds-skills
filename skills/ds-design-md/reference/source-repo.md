# Sourcing from a codebase

The goal is the same as any source: every token in the frontmatter has to
trace back to something you actually read, not something you inferred from
the product's general vibe.

## Find the token source first

Look for a single place tokens are declared before reading component files —
components will reference these, and reading them first means you recognise
the reference instead of re-deriving the value from a rendered pixel size.

Common locations, roughly in the order worth checking:

- `tailwind.config.{js,ts}` — `theme.colors`, `theme.spacing`,
  `theme.borderRadius`, `theme.fontSize`, `theme.fontFamily`. Tailwind's own
  defaults (the grey scale, the default spacing scale) are not this product's
  tokens — only what's overridden or extended belongs in the frontmatter.
- A dedicated tokens package or file — `tokens.json`, `theme.ts`,
  `design-tokens/`, anything shaped like DTCG (`$value`/`$type` pairs) or a
  flat theme object. If it's DTCG-shaped, the mapping to this format's
  `colors`/`typography`/`rounded`/`spacing` is close to 1:1.
- CSS custom properties in a base stylesheet — `:root { --color-primary: ... }`
  — often the ground truth even when a JS theme file also exists, because the
  CSS is what actually ships.
- A Storybook `theme.js`/`manager.ts` or a design-system package's own
  `README` — sometimes states the scale in prose even when it's not
  machine-readable elsewhere.
- CSS-in-JS theme objects (styled-components `ThemeProvider`, Emotion,
  vanilla-extract) — same shape as a tokens file, just imported differently.

If none of these exist, the tokens are inline in component styles. Grep for
hex values and `px`/`rem` literals across the component directory, cluster
what repeats, and name the clusters yourself — but say so explicitly in the
Overview or Known Gaps ("no central token source; values below are clustered
from inline styles across N components") rather than presenting inferred
tokens as if they were declared.

## Cross-check against what actually renders

A token file states intent; it doesn't prove a component uses it correctly,
and it never shows composition (how a card's padding, radius, and shadow
combine) or a state most people would call "the real spacing," as opposed to
what the scale technically allows. Ground the prose sections in one of these,
in order of preference:

1. **A running Storybook or dev server.** If the `run` skill applies to this
   repo, use it to bring the app up, then read the rendered pages the way you
   would a live site — this is what actually grounds `## Overview`,
   `## Elevation`, `## Shapes`, and the per-component paragraphs in
   `## Components`.
2. **Static screenshots or a design QA page**, if the repo ships one.
3. **Component source only**, as a last resort — read the JSX/template
   markup and the styles it applies, and say in Known Gaps that nothing was
   visually confirmed.

## Mapping to the frontmatter

- **`colors`** — every token the theme/config declares, renamed to this
  format's role-based convention (`primary`, `ink`, `canvas`, `surface-*`,
  `hairline`, `on-primary`, …) if the source uses different names. Note the
  source name once, in the Colors section prose, so a reader can cross-
  reference (`{colors.primary}` — sourced from `theme.colors.brand.600`).
- **`typography`** — one entry per distinct type style actually used, not
  per raw font-size in the scale. If the codebase exposes 12 sizes but only 9
  size/weight/line-height *combinations* actually appear in components, write
  9 — an unused rung isn't a real typography style.
- **`rounded` / `spacing`** — the full declared scale, even where a step
  isn't used yet; these are scales, not usage inventories.
- **`components`** — one entry per distinct visual treatment, sourced from
  the component library (Storybook stories are the fastest index of "what
  distinct things exist"). Include the state variants that exist as their own
  styled variant in code (`-active`, `-disabled`, `-selected`); skip
  `:hover` per the format spec.

## What repos usually can't give you

- **Elevation reasoning.** A `box-shadow` value is easy to read; *why* it's
  used sparingly or generously is a judgement call — make it from what you
  saw rendered, and say so.
- **Brand voice / principles prose.** Code doesn't explain itself. If there's
  no design-principles doc in the repo, keep `### Principles` short and
  descriptive (what the scale actually does) rather than inventing brand
  rationale that wasn't stated anywhere.
- **Responsive behaviour beyond CSS breakpoints.** Breakpoint values are easy
  to grep; how content actually reflows at each one needs the rendered app,
  not just the media-query list.
