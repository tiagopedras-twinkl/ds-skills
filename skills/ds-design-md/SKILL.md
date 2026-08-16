---
name: ds-design-md
description: Write a new DESIGN-<name>.md — a design-token YAML frontmatter plus an eleven-section prose write-up of a product or brand's visual system (colours, typography, spacing, radii, elevation, components, all token-referenced) — from an existing codebase, a brand guidelines deck, or a Figma design system library (one file or several). Use whenever the user asks to write, generate, produce, reverse-engineer, or document a DESIGN.md, a design system analysis, a brand write-up, or a design-token spec for a product — their own or a competitor's. Also use to refresh or extend an existing DESIGN-*.md against a newer or additional source. Do NOT use for ds-docs component usage guidance (that's ds-component-docs) or for a raw Figma token/component export with no prose (that's ds-snapshot, which this skill consumes as one of its Figma sources rather than duplicating).
---

# Design.md writer

Write a DESIGN.md — the format described in full in
`reference/format-spec.md` — from a codebase, a brand guidelines deck, or a
Figma design system library. The frontmatter is what a tool reads; the prose
is what a person reads; every value in either half traces back to something
actually observed in the source.

The five real examples this format was reverse-engineered from (Airbnb,
Apple, Claude, Linear, Notion) don't read like generic design-system
boilerplate — they read like a designer looked hard at the product and wrote
down what they saw, hex by hex. That's the standard to hit, and it only
happens by grounding every section in a real source rather than filling the
shape in from what a design system "usually" looks like.

## Non-negotiables

1. **Never invent a value.** A plausible hex, a "probably 8px" radius, an
   error state nobody actually saw — all worse than a gap that says so. Every
   real example in this family ends its `## Known Gaps` section admitting
   exactly this kind of absence. Do the same rather than padding a thin
   section.
2. **`components:` entries reference tokens, never raw values.**
   `{colors.primary}`, not `#cc785c`, inside a component definition. A raw
   value there means either a token belongs in `colors`/`typography`/
   `rounded`/`spacing` and is missing, or it's a genuine one-off worth a
   sentence in prose — never a silent inline hex.
3. **Never document `:hover`.** Every file in this family documents Default
   and Active/Pressed only. This is a deliberate convention, not a gap — don't
   apologise for it in Known Gaps either.
4. **Follow the fixed section order.** `reference/format-spec.md` is the
   authority on what's universal versus situational. Skipping a section that
   genuinely doesn't apply to this source is fine and matches what the real
   examples do; reordering one, renaming one, or inventing a new top-level
   section without a real reason is not.
5. **When sources disagree, say so.** If a brand deck states one hex and the
   shipped code renders a visibly different one, name both and say which the
   file follows and why — don't silently prefer one.
6. **`## Known Gaps` is the honest closing section.** Whenever something
   genuinely wasn't observable — form validation states, a sub-brand palette
   living elsewhere, animation timings, dark-mode counterparts out of scope —
   say so there, last, rather than letting a thin section pass as complete.
7. **Validate before calling it done.** `scripts/validate-design-md.mjs` has
   to run clean (warnings are fine, errors are not) before reporting the file
   finished.
8. **Never overwrite an existing file silently.** If `DESIGN-<name>.md`
   already exists at the target path, ask whether this run should replace it
   or write a new one — don't clobber a file that took real work to produce.

## Ask first

Before touching any source, get three things — in one go, not one at a time:

1. **What's the source?** A codebase, a brand guidelines deck, a Figma
   library, or a combination. If more than one, ask which one wins when they
   disagree on something (usually: code for implementation detail, a deck or
   Figma's own copy for stated brand intent).
2. **What's the subject called?** Sets the filename — `DESIGN-<kebab-case-
   name>.md` — and the `name:`/`description:` frontmatter. If it's the user's
   own product, this is usually obvious from the repo or file; for anything
   else, ask.
3. **Where should the file be saved?** Default to the current working
   directory if the user doesn't say. Don't assume a `references/` subfolder
   unless this is explicitly a calibration example alongside others, the way
   `design_md/references/` holds Airbnb, Apple, Claude, Linear, and Notion as
   comparison pieces rather than the primary subject.

If the user has already answered one of these in the request ("write a
DESIGN.md for our Storybook" names the source and implies the subject), don't
re-ask it.

## Steps

1. **Confirm source(s), subject, and save location** — see Ask first.

2. **Gather evidence.** Route to the matching reference file and follow it:
   - Codebase → `reference/source-repo.md`
   - Brand guidelines deck → `reference/source-deck.md`
   - Figma library (one file or several) → `reference/source-figma.md`

   For more than one source, gather from each in turn and keep track of
   where each value came from — you'll need that when sources disagree
   (Non-negotiable 5) and when writing the parts of Overview/Colors/
   Typography that explain *why* a token looks the way it does.

3. **Draft the frontmatter.** `version: alpha` for a first pass, `name`,
   then a `description` that stands completely alone — someone reading only
   that one paragraph should come away with the same mental picture as
   someone reading the whole `## Overview`. Then `colors`, `typography`,
   `rounded`, `spacing`, `components` in that order, following
   `reference/format-spec.md`'s field-by-field notes.

4. **Draft the body**, section by section, in the order
   `reference/format-spec.md` lays out. Write each section from the evidence
   gathered in step 2 — if a section would otherwise be guesswork, either
   skip it (for the situational sections) or write what's genuinely known
   and flag the rest in Known Gaps (for the universal ones, which can't be
   skipped outright).

5. **Validate.**

   ```bash
   node scripts/validate-design-md.mjs <path/to/DESIGN-name.md>
   ```

   Fix every error and re-run until it exits 0. Warnings are worth reading —
   a missing `## Known Gaps` or a raw hex inside `components:` is usually a
   real thing to go back and fix, not noise — but they don't block.

6. **Report.** Say which source(s) were used, which sections are fully
   grounded versus thin, and point at `## Known Gaps` rather than repeating
   its contents. If this run updated an existing file rather than writing a
   fresh one, say what changed.

## What this skill does not do

- **Component usage guidance** — how to use a component correctly, ARIA
  patterns, accessibility guidance written against GOV.UK/APG/WCAG. That's
  `ds-component-docs`, a different format for a different audience.
- **Raw Figma export with no prose** — a `tokens.json`/`components.json`
  snapshot with no interpretation. That's `ds-snapshot`, and this skill reads
  its output rather than re-implementing it.
- **Component naming validation.** That's `ds-name-check`.
- **Deciding which source wins on a genuine disagreement without telling the
  user.** Flag it; don't adjudicate silently.

## Reference files

- `reference/format-spec.md` — the format's authority: every frontmatter
  field, the eleven body sections and which are universal versus situational,
  and the rules that hold regardless of source. Read this first, always.
- `reference/source-repo.md` — where tokens live in a typical codebase, how
  to cross-check them against what actually renders, and what a repo usually
  can't give you.
- `reference/source-deck.md` — what a brand guidelines deck reliably states
  versus what it never does, and how to keep a deck-sourced file honestly
  thin rather than padded.
- `reference/source-figma.md` — using a `ds-snapshot` (or reading Figma live)
  for exact tokens, plus screenshots of real frames for how those tokens
  actually compose — a token map alone doesn't ground the prose.
- `scripts/validate-design-md.mjs` — the structural gate. Node, no
  dependencies. Not a full YAML/Markdown parser — see the comment at the top
  of the file for exactly what it checks and what it doesn't.

## Changing the format

`reference/format-spec.md` is versioned by convention, not a `schemaVersion`
field the way `ds-snapshot`'s contract is — DESIGN.md files describe products,
not a shared machine contract other tools join on. Still, change it
deliberately: if a new section or field earns its place across more than one
real file, add it to the spec and to `validate-design-md.mjs` in the same
pass, and say in the commit which real files justified it. Never add a
section to the spec because one file happened to need it once.
