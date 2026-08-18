---
name: ds-web-snapshot
description: Look up real usage data for a list of Twinkl design-system components, CMS modules, or icons in a codebase, using CodeGraph, and write it to a dated snapshot in ds-snapshots/web_snapshots/. Use whenever the user gives a list of names and asks for usage counts, adoption data, or a code-side usage snapshot — as opposed to Figma-side data, which is ds-figma-snapshot. Also captures design token usage — which colour, spacing, radius and shadow tokens the code actually references, and which are declared but dead. Requires CodeGraph indexed in the session's current working directory (the code repo, e.g. twinkl-web); this skill checks for it and initializes it if missing.
---

# Web usage snapshot

Turn a list of names into real usage counts pulled from the actual codebase, via
[CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph), and write it
as a dated snapshot so it can be compared run over run. This is the code-side
counterpart to `ds-figma-snapshot` — that skill answers what the Figma library
contains, this one answers what the code actually uses.

## Non-negotiables

1. **CodeGraph is the source for anything that is a symbol** — components,
   modules, icons. No `grep`, no manual `find`, no reading files to guess at
   usage. Every one of those counts comes from `codegraph callers`, `codegraph
   query`, `codegraph explore`, or `codegraph node`, run fresh against this
   run's index.

   **Tokens are the one exception, and they are not a symbol.** A design token
   is a CSS custom property that Tailwind turns into class names, so CodeGraph
   genuinely cannot see it — `codegraph query "color-brand"` returns an empty
   list. Token counts come from the text scan in "Tokens" below instead, and
   every token entry carries `"method": "text-scan"` so the two kinds of
   evidence can never be quietly mixed. Never use a text scan for components,
   modules or icons, where CodeGraph does work and is stronger.
2. **Metadata is verbatim or absent.** `title`, `parameters`, and `argTypes`
   come only from an actual sibling `*.stories.tsx` file, read and copied
   as-is. Never invent or fill in from memory of what a component "usually"
   has. Missing a stories file means `null`, not a guess.
3. **Every count is disambiguated to its exact defining file.** Unrelated
   components can share a name (see "Name collisions"). A count that silently
   merges two different components is wrong, not approximate — treat it as a
   bug, not a rounding error.
4. **Never overwrite a snapshot.** Same rule as `ds-figma-snapshot`: a same-day
   rerun gets `-2`, then `-3` — first free number.
5. **A requested name always ends up somewhere.** Either an entry in
   `components.json`, `modules.json`, `icons.json` or `tokens.json`, or in that
   file's `notFound` list. Never silently drop one.

## Preconditions: is CodeGraph available here?

Run in the session's current working directory — this must be the code repo
(e.g. `twinkl-web`), not `ds-skills` or `ds-snapshots`:

```bash
pnpm exec codegraph status
```

(`npx codegraph status` if the repo isn't pnpm-managed.)

- **Initialized already** → proceed.
- **"Not initialized" but the repo is set up for it** (a `docs/codegraph.md`,
  a committed `.mcp.json` referencing codegraph, or it's a devDependency) →
  run `pnpm install && pnpm codegraph` (or the repo's documented init command).
  This is local, reversible, and takes well under a minute — safe to do
  without asking first. Re-run `status` to confirm before continuing.
- **No CodeGraph configuration anywhere in the repo** → stop. Tell the user
  plainly this repo isn't set up for CodeGraph, so there's no usage data to
  pull here. Do not fall back to `grep` under this skill's name — that's a
  different, much less reliable method, and returning its results as if they
  were CodeGraph's would be misleading.

## Getting the list

The user provides names inline (comma- or newline-separated) or points at a
file to read them from. Trim whitespace, dedupe, and preserve their original
casing — lookups are case-sensitive symbol names (`Button`, not `button`).

Anything that looks like a token rather than a symbol — it starts with `--`, or
it names a colour, spacing, radius, shadow or breakpoint rather than a
component — is set aside here and handled by "Tokens" below, not by Steps 1–4.
Tokens are never looked up in CodeGraph.

## Step 1 — locate every name

For each name:

```bash
pnpm exec codegraph query "<name>" --json --limit 50
```

Keep only results where `node.name` is an **exact** match — the query itself
is fuzzy and will return near-matches. Each surviving result is one
definition; note its `filePath`, `kind`, and `startLine`. If the result count
comes back exactly at the limit, re-run with a higher `--limit` — that many
exact hits usually means truncation, not that the name is genuinely that
common.

**Classify by file path:**

| Path prefix | Goes to |
|---|---|
| `ui/src/components/` | `components.json` |
| `core/cms/src/modules/` | `modules.json` |
| `ui/src/icons/` | `icons.json` |
| anything else | not written to a file — see below |

A definition outside the three recognised trees isn't written, but note it in
the final report as "also defined at `<path>`" rather than discarding it
silently — a component with an unofficial parallel copy elsewhere is itself a
useful finding (design-system fragmentation), not noise.

A name with **zero** matches in any of the three trees goes in that file's
`notFound` list (see Step 5 for which file — if it's genuinely nowhere, note
it once in the report rather than in all three).

## Step 2 — name collisions

Multiple unrelated symbols can share a name — `Avatar`, `Checkbox`, and
`Dialog` all exist as separate, unconnected components across different parts
of this codebase, not just in `ui/src/components`. Before trusting a caller
count, check whether this exact name appears more than once anywhere in Step
1's raw (pre-classification) results, in a **different** file.

- **No collision** — safe to use directly:

  ```bash
  pnpm exec codegraph callers "<name>" --json --limit 2000
  ```

  `usage.count` = length of the returned `callers` array. `usage.callers` =
  every `{name, filePath, startLine}` entry in it. If the count lands exactly
  on 2000, say so — it may be capped.

- **Collision** — `callers` merges every same-named symbol's callers with no
  way to split them back apart; do not use it here. Instead:

  ```bash
  pnpm exec codegraph explore "<name>"
  ```

  Its "Blast radius" section lists one bullet per exact defining file, shaped
  like:

  ```
  `Name` (path/to/file.tsx:LINE) — N callers in `a`, `b`, `c` +M more
  ```

  Match the bullet whose file matches this definition's `filePath`. Take **N**
  as `usage.count` — it is already disambiguated per file and exact (verified
  against `callers --json` in the no-collision case, where the two agree
  precisely). Take the listed sample files as `usage.callers`, each as
  `{ "filePath": "..." }` (no name or line available from this path). Set
  `"sampled": true` on that entry, since the caller list here is a sample, not
  the full set — never claim completeness the source doesn't give you.

  **`explore`'s "Blast radius" list is itself curated, not exhaustive.** On a
  415-item run (2026-08-18) it silently omitted the bullet for the exact
  defining file in several genuine collisions (`Banner`, `Footer`, `Header`,
  `Notification`, `Tabs` all had no matching bullet at all, despite being real
  collisions). Don't treat a missing bullet as "zero callers" or as "not a
  collision after all" — fall back to:

  ```bash
  pnpm exec codegraph node "<name>" --file "<filePath>"
  ```

  and read the `Called by ←` line: count what's listed plus `+N more` if
  present (or exactly what's listed if there's no `+N more` — that means the
  list is already complete). This also fully disambiguates by file, the same
  as `explore`'s bullets do, so it's a safe substitute whenever the bullet
  you're looking for isn't there. Slower (one call per collision instead of
  one per distinct name), but only needed for the collisions `explore` missed.

## Step 3 — metadata

Realistically this only ever populates for entries going into `components.json`
and occasionally `icons.json`; CMS modules rarely have Storybook stories.

Look for a sibling `*.stories.tsx` next to the component's source file, in the
same directory. If one exists, read it and find its `meta`/`export default`
object (the one `satisfies Meta<...>`). Copy `title`, `parameters`, and
`argTypes` verbatim into the JSON — same structure, same values, no
reformatting or summarising. If no stories file exists, all three are `null`.

## Step 4 — build the file URL

```bash
git remote get-url origin   # → https://github.com/<owner>/<repo>.git
```

Build:

```
https://github.com/<owner>/<repo>/blob/main/<filePath>#L<startLine>
```

Always `main`, never the session's current branch — a feature-branch link
breaks the moment the branch is deleted, and a snapshot is meant to still
resolve when read later.

## Step 5 — write the files

Target folder, always this exact absolute path regardless of the session's
working directory — the code lives in the product repo, the data lives here,
per the tools/data split in the root `CLAUDE.md`:

```
/Users/tiagopedras/Code/ds-snapshots/web_snapshots/<YYYY-MM-DD>/
```

**Never overwrite.** If `<YYYY-MM-DD>/` already exists, use `<YYYY-MM-DD>-2`,
then `-3` — first free number.

All three files share one shape:

```json
{
  "generatedAt": "2026-08-17T14:32:00Z",
  "repo": "twinkltech/twinkl-web",
  "branch": "main",
  "requested": ["Button", "Avatar", "Checkbox"],
  "notFound": ["Typo-Name"],
  "items": [
    {
      "name": "Button",
      "fileUrl": "https://github.com/twinkltech/twinkl-web/blob/main/ui/src/components/button/button.tsx#L155",
      "title": "Components/Button",
      "parameters": { "layout": "centered" },
      "argTypes": { "variant": { "options": ["primary", "secondary"], "control": { "type": "select" } } },
      "usage": {
        "count": 636,
        "sampled": true,
        "callers": [
          { "filePath": "apps/web/src/app/[country]/[language]/(no-nav)/checkout/[id]/page.tsx" }
        ]
      }
    }
  ]
}
```

`usage` isn't in the literal field list a request for this skill might give
you (name, file URL, title, parameters, argTypes) — but it's the entire point
of the skill, so every entry carries it regardless.

Write:

- **`components.json`** — items classified under `ui/src/components/`
- **`modules.json`** — items classified under `core/cms/src/modules/`
- **`icons.json`** — items classified under `ui/src/icons/`
- **`tokens.json`** — every design token, written by the script in "Tokens"
  below rather than assembled by hand

Write all four every run, even when one has zero items — with an empty `items`
array. An empty list and "wasn't checked" must stay distinguishable in the file
itself, so never skip writing one because it happens to be empty.

## Tokens

Tokens don't go through Steps 1–4 at all. CodeGraph indexes symbols, and a
token isn't one: it is a CSS custom property declared in `ui/themes/*.css`,
which Tailwind turns into utility class names. `codegraph query "color-brand"`
returns an empty list, and it always will. So token usage is measured by a
text scan instead, run by a script rather than by hand — the counting is
mechanical (thousands of matches across thousands of files) and has none of
the judgement Step 2 needs.

```bash
node <ds-skills>/skills/ds-web-snapshot/scripts/scan-tokens.mjs \
  --repo /Users/tiagopedras/Code/twinkl-web \
  --out  /Users/tiagopedras/Code/ds-snapshots/web_snapshots/<YYYY-MM-DD>
```

Optional flags: `--themes <dir>` if the theme CSS doesn't live at `ui/themes`,
and `--requested "--color-brand,--spacing-200"` when the user named specific
tokens — that fills `requested` and `notFound` without narrowing the scan.

**Run it every time, whether or not the user asked about tokens.** It takes
about a second, it needs no list from the user, and a snapshot missing a run's
token picture can't be compared against the runs either side of it.

### How it counts

The script reads every `--name: value;` declaration in the theme CSS — that is
the code-side list of tokens, and each token's value in each theme is recorded
alongside it. Then, for every token, it counts:

- **Utility classes** the token generates, from the Tailwind v4 namespace it
  sits in — `--color-brand` becomes `bg-brand`, `text-brand`, `border-brand`
  and the rest; `--spacing-200` becomes `p-200`, `gap-200`, `size-200` and so
  on. Matching is bounded at both ends, so `bg-brand` never counts a
  `bg-brand-subtle`, and a leading `-` is allowed for negative values.
- **Direct references** — `var(--color-brand)` written by hand, in TypeScript
  or CSS.
- **Breakpoints**, which appear as variants (`lg:`, `max-lg:`) rather than as
  classes.

Each hit is attributed to the file it came from, and files are separated into
source, Storybook stories and tests, and into `ui/` (the design system itself)
versus everything else (product code). That separation is the point: a token
used only inside `ui/` has been built but not adopted, and a token appearing
only in a test hasn't been used at all.

### What it cannot see

Say both of these in the report whenever token numbers are quoted:

- A class name assembled at runtime — `` bg-${colour} `` — is invisible to a
  text scan, so a token used only that way reads as unused.
- A test asserting a token is *absent* still counts as a reference. Rare, and
  visible in the `inTests` figure.

If the numbers ever look untrustworthy, the stronger method is to build the
Tailwind CSS and read which utilities it actually generated. That needs a
working build and minutes rather than seconds, so it is a deliberate upgrade,
not a fallback to reach for mid-run.

### Reading the result

`totals` reconciles into four groups that add up to the token count:
`usedInProductCode`, `designSystemOnly`, `testOrStoryOnly`, and `unused`.

A large `unused` number is not automatically a problem — raw palette shades
(`--color-blue-250`, `--color-gold-400`) are meant to be reached through
semantic tokens, never directly, so they are expected to sit at zero. Split
those out before reporting. **Unused *semantic* tokens are the finding**, and
so is a whole namespace reading zero: on the 2026-08-18 run all 21
`--dimension-*` tokens (every rounding and font size) scored nothing, because
they were never wired to a Tailwind namespace and so generate no classes at
all. A family-wide zero usually means a wiring gap, not disuse — check whether
the namespace can produce classes before reporting it as dead.

## Report

Plain language, short. State: the target folder path, how many names were
requested, how many were found and where (split by components / modules /
icons), how many weren't found anywhere, and any collisions hit — name them,
since a collision is itself a real finding (e.g. "`Avatar` exists as three
separate, unrelated components; only the one in `ui/src/components/avatar`
was counted for `components.json`"). Then the counts worth a human's
attention — highest and lowest usage, anything surprising — not a full table
dump unless asked.

Then tokens, as their own short paragraph: how many are declared, and the four
groups from `totals`. Name the unused *semantic* tokens and any family sitting
at zero; don't list unused palette shades individually. Close with the two
limits from "What it cannot see" — a reader who doesn't know the counts come
from a text scan will over-trust them.

## Why almost no script

Steps 1–4 are direct CodeGraph CLI calls, read and written by the agent —
CodeGraph's own output already needs judgement to interpret correctly,
especially the collision case in Step 2, which isn't a clean parsing job a
fixed script could do reliably.

`scan-tokens.mjs` is the exception because token counting is the opposite kind
of work: no ambiguity to resolve, just thousands of exact string matches that
an agent would be slower and less accurate at. Its counts were verified
against independent `ripgrep` runs on 2026-08-18 and matched exactly.

If the component contract needs machine validation later (mirroring
`ds-figma-snapshot`'s validator), add that deliberately rather than
half-building one now.
