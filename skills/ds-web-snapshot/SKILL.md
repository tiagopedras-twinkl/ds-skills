---
name: ds-web-snapshot
description: Discover every Twinkl design-system component, CMS module and icon that actually exists in a codebase, plus real usage counts for each, using CodeGraph, and write it to a dated snapshot in ds-snapshots/web_snapshots/. Use whenever the user wants a code-side usage snapshot, adoption data, or to check the code's own component/module/icon inventory — as opposed to Figma-side data, which is ds-figma-snapshot. A list of names is optional context, not a requirement — the skill discovers the full set from the code's own export surface either way, so anything built in code and absent from Figma still shows up. Also captures design token usage — which colour, spacing, radius and shadow tokens the code actually references, and which are declared but dead. Requires CodeGraph indexed in the session's current working directory (the code repo, e.g. twinkl-web); this skill checks for it and initializes it if missing.
---

# Web usage snapshot

Answer what the codebase actually has and how much each thing is used, pulled
from the code itself via
[CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph), and write it
as a dated snapshot so it can be compared run over run. This is the code-side
counterpart to `ds-figma-snapshot` — that skill answers what the Figma library
contains, this one answers what the code actually has and uses.

**A snapshot is a mirror of the code, not a lookup against a list.** Every run
discovers the complete set of components, modules and icons the code exports —
see "Step 0 — discovery" — whether or not the caller gave a list of names to
check. A list only adds a second lens on top: which of the discovered names
were the ones asked about, and which asked-about names don't exist in code at
all. A component built in code and never added to Figma has to show up here
regardless, or the snapshot is answering "what does Figma think exists"
instead of "what does the code have" — which is the one thing this skill is
for that `ds-figma-snapshot` cannot answer.

## Non-negotiables

1. **Discovery always runs, list or no list.** `components.json`,
   `modules.json` and `icons.json` are built from what the code itself exports
   (see "Step 0 — discovery"), never solely from a name list someone hands the
   skill. A caller-supplied list narrows what gets *flagged* as requested; it
   never narrows what gets *found*.
2. **CodeGraph is the source for locating and counting a symbol** —
   components, modules, icons. No `grep`, no manual `find`, no reading files to
   guess at usage. Every exact file/line and usage count comes from `codegraph
   callers`, `codegraph query`, `codegraph explore`, or `codegraph node`, run
   fresh against this run's index. (Discovery itself — *which names exist* — is
   a different question, answered by `scripts/discover-exports.mjs` walking
   the real export graph; see Step 0. CodeGraph answers what happens once a
   name is already known.)

   **Tokens are the one exception, and they are not a symbol.** A design token
   is a CSS custom property that Tailwind turns into class names, so CodeGraph
   genuinely cannot see it — `codegraph query "color-brand"` returns an empty
   list. Token counts come from the text scan in "Tokens" below instead, and
   every token entry carries `"method": "text-scan"` so the two kinds of
   evidence can never be quietly mixed. Never use a text scan for components,
   modules or icons, where CodeGraph does work and is stronger.
3. **Metadata is verbatim or absent.** `title`, `parameters`, and `argTypes`
   come only from an actual sibling `*.stories.tsx` file (components), or the
   matching generated Sanity schema type (modules — see "Module metadata"),
   read and copied as-is. Never invent or fill in from memory of what a
   component "usually" has. Nothing to copy means `null`, not a guess — and
   `null` is a legitimate, common result, not a sign the capture failed (see
   "Why argTypes is null so often").
4. **Every count is disambiguated to its exact defining file.** Unrelated
   components can share a name (see "Name collisions"). A count that silently
   merges two different components is wrong, not approximate — treat it as a
   bug, not a rounding error.
5. **Never overwrite a snapshot.** Same rule as `ds-figma-snapshot`: a same-day
   rerun gets `-2`, then `-3` — first free number.
6. **A name always ends up somewhere.** Every name this run touches — whether
   discovered in code, supplied by a caller, or both — is either an entry in
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

## Getting the list (optional)

The user may provide names inline (comma- or newline-separated) or point at a
file to read them from — typically a Figma-derived list, when the point is to
check Figma against code. If they do, trim whitespace, dedupe, and preserve
original casing — lookups are case-sensitive symbol names (`Button`, not
`button`). Anything that looks like a token rather than a symbol — it starts
with `--`, or it names a colour, spacing, radius, shadow or breakpoint rather
than a component — is set aside here and handled by "Tokens" below, not by
Steps 1–4. Tokens are never looked up in CodeGraph.

If the user gives no list at all, that's the default case, not a missing
input: run discovery and report everything the code has, same as `tokens.json`
already does with an empty `requested`.

Either way, this list (if any) only ever feeds the `requested` and `notFound`
fields in Step 5's output — see Step 0 for where the actual name universe
comes from.

## Step 0 — discovery

Before anything is looked up individually, get the code's own list of what
exists:

```bash
node <ds-skills>/skills/ds-web-snapshot/scripts/discover-exports.mjs \
  --repo <path-to-code-repo> \
  --out  /Users/tiagopedras/Code/ds-snapshots/web_snapshots/<YYYY-MM-DD>
```

This walks the real export graph — starting at each tree's top barrel file(s)
and following `export { X } from "./y"` / `export * from "./y"` until every
name resolves to a concrete declaration — for the same three trees Step 1
classifies into:

| Tree | Barrel(s) walked |
|---|---|
| `ui/src/components/` | every `index.ts` under the tree (there is no single top-level barrel — each component directory, and any nested sub-component directory, is its own) |
| `core/cms/src/modules/` | `core/cms/src/modules/index.ts` |
| `ui/src/icons/` | `ui/src/icons/index.ts` |

It writes `discovered-exports.json` into the snapshot folder (kept as
supporting evidence, not one of the four files a snapshot contract lists) and
prints a names-per-tree summary to stderr.

**The name universe for Steps 1–4 is the union of what this discovers and
whatever the user requested (if anything).** A name in both is
requested-and-found. A name only in the user's list is `notFound` once Step 1
confirms CodeGraph agrees it isn't there. A name only in discovery is
found-but-never-requested — write it to `items` exactly like any other name,
and see `foundNotRequested` in Step 5.

This is a mechanical export-walk, not a usage question, so it doesn't go
through CodeGraph the way Step 1's per-name lookups do — the same reasoning
that puts token counting in its own text-scan script rather than forcing it
through a tool built for a different question. What it can miss: a symbol
genuinely defined but never exported from any barrel (correctly invisible —
dead code isn't a component) is different from a symbol re-exported through a
pattern this script's regex-based walk doesn't recognise (a miss worth fixing
in the script, not something to silently work around by hand). If a name you
know exists in code doesn't show up in `discovered-exports.json`, check which
case it is before assuming the component doesn't exist.

## Step 1 — locate every name

For every name in the union built in Step 0 — discovered names and any
requested names, deduplicated (most requested names will already be in the
discovered set; run the ones that aren't, since a name CodeGraph confirms
doesn't exist anywhere is exactly what `notFound` is for):

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

### Component metadata

Look for a sibling `*.stories.tsx` next to the component's source file, in the
same directory. If one exists, read it and find its `meta`/`export default`
object (the one `satisfies Meta<...>`). Copy `title`, `parameters`, and
`argTypes` verbatim into the JSON — same structure, same values, no
reformatting or summarising. If no stories file exists, all three are `null`.

**Why `argTypes` is null, or empty, so often.** On the 2026-08-18 run only 40
of 75 requested components carried a non-empty `argTypes`. That is not a
capture gap — every one of those cases was checked against its actual stories
file, and the field is genuinely absent or empty in the source, in three
distinct ways worth telling apart in the report:

- **No stories file at all** → `title`, `parameters` and `argTypes` are all
  `null`. Nothing to copy.
- **A stories file exists but its `meta` object never sets `argTypes`** →
  `argTypes` is `null`, `title`/`parameters` may still be populated.
- **`argTypes` is present but written as an empty object**, `argTypes: {}` —
  copy it verbatim as `{}`, not `null`. It's a real, deliberate value in the
  source; treating it the same as "missing" (as a naive falsy check would)
  hides the difference between "nobody wrote controls for this story" and
  "this component genuinely has none". Report these as their own count,
  separate from true `null`.

A component whose only sibling stories file belongs to a different exported
name (common in compound components — `header/account-menu/account-menu.stories.tsx`
covers `HeaderAccountMenu`, not a plain `Header`) still uses that sibling; the
rule is "same directory as the source file", not "same name as the
component".

### Module metadata

CMS modules have no Storybook stories — confirmed empty on the 2026-08-18 run,
zero `*.stories.tsx` anywhere under `core/cms/src/modules/`. What they do have
is a generated Sanity schema type, the editorial fields a content editor can
actually set for that module, which is the closer analogue to a component's
argTypes than the module's own React props (`documentId`, `draftMode`, `zone`
and similar are wiring, not design-relevant options).

`scripts/discover-exports.mjs` (Step 0) already extracts this while it runs —
its `moduleArgTypes` output maps each Sanity type name it found to a
components.json-shaped `argTypes` object, resolving:

- a field typed as an inline string-literal union (`"first" | "second"`) →
  `{ options: [...], control: { type: "select" } }`
- a field typed as a bare alias whose own `export type Alias = "a" | "b"`
  lives elsewhere in the same file (one hop of resolution, no further) → same
  shape
- anything else (`string`, an object-shaped field like `ImageWithMetadataField`
  or `CustomActionField`) → `{ type: "<the type name>" }`, real but not a
  closed set of options

**Match by name, stripping a trailing `Module`.** A module's exported name
(`HeroBannerModule`) and its Sanity schema type name (`HeroBanner`) usually
differ by exactly that suffix. Look up `moduleArgTypes[name]`, and if that
misses, `moduleArgTypes[name.replace(/Module$/, "")]`. On the 2026-08-18 code,
this matched 40 of 43 discovered modules — a large jump from 0 of 30 before
this existed. The remaining few (AB-testing's module, whose schema splits
across several personalisation-variant types rather than one, was one) get
`argTypes: null`, correctly — there's no single schema type to point at, not a
missed capture.

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

All three files share one shape, contract **2.0.0** (see "Reading a snapshot
written before 2.0.0" below — these three files had no version field and no
`foundNotRequested` group before this rewrite):

```json
{
  "schemaVersion": "2.0.0",
  "generatedAt": "2026-08-17T14:32:00Z",
  "repo": "twinkltech/twinkl-web",
  "branch": "main",
  "requested": ["Button", "Avatar", "Checkbox"],
  "notFound": ["Typo-Name"],
  "foundNotRequested": ["HeaderAccountMenu", "IconSocialMediaFacebook"],
  "items": [
    {
      "name": "Button",
      "requestedByCaller": true,
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

`items` holds **every** name Step 0 discovered, whether or not it was ever
requested — that's what makes this a mirror of the code rather than a report
card on a list. `requested` and `notFound` keep exactly their old meaning
(caller-supplied names, and which of those don't exist in code); they are `[]`
when the caller gave no list, the same way `tokens.json` already reports
`requested: []`. `foundNotRequested` is the new field: every name in `items`
that isn't in `requested` — the group nobody could see before this rewrite,
since it used to never get looked up at all. Each item's own
`requestedByCaller` flag saves a consumer from cross-referencing the top-level
array just to answer "was this one of the names asked about".

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

### Reading a snapshot written before 2.0.0

A pre-2.0.0 `components.json`/`modules.json`/`icons.json` has no
`schemaVersion` field at all — that absence is itself the version marker, the
same convention `ds-figma-snapshot` uses. Its `items` only ever held
caller-requested names (discovery didn't exist yet), so there is no
`foundNotRequested` group and no `requestedByCaller` flag to read — treat every
item in an unversioned file as implicitly requested. Don't backfill these
fields onto an old snapshot; re-run the skill instead if the discovery view is
what's needed.

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

Plain language, short. Lead with the three-group split, since that's the
point of a discovery-first snapshot, not an afterthought:

- **How many the code has, per tree** — components / modules / icons — from
  Step 0's discovery, independent of anything requested.
- **Found and requested** — how many of the caller's list matched, if they
  gave one.
- **Requested but missing** (`notFound`) — real gaps, or typos; say which.
- **Found but never requested** (`foundNotRequested`) — the group this
  rewrite exists to surface. Don't just give a count; name a few, especially
  any that look like a whole missing category rather than stragglers (e.g. "9
  icons exist under `social-media/` and `native/` that were never in the
  requested list at all" reads very differently from "9 icons here and there
  got missed").

Then collisions hit — name them, since a collision is itself a real finding
(e.g. "`Avatar` exists as three separate, unrelated components; only the one
in `ui/src/components/avatar` was counted for `components.json`"). Then the
usage counts worth a human's attention — highest and lowest, anything
surprising — not a full table dump unless asked.

For `argTypes`, say how many components/modules got real, non-empty option
data versus `null` versus an explicit empty `{}` — three different things,
per "Why `argTypes` is null so often" and "Module metadata" above — rather
than folding them into one "has metadata" number, which is what made the
original 40-of-75 figure look worse than it was.

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

`scan-tokens.mjs` and `discover-exports.mjs` are the exceptions, and for the
same reason: both are mechanical, judgement-free work at a scale an agent
would be slower and less accurate at — thousands of string matches for token
counting, hundreds of export statements to follow for discovery. Neither
involves the kind of "which of these ambiguous results is actually right"
call that Step 2's collisions need. `scan-tokens.mjs`'s counts were verified
against independent `ripgrep` runs on 2026-08-18 and matched exactly;
`discover-exports.mjs`'s component/icon/module lists were checked the same
day against every name in the previous run's `requested` arrays: 74 of 75
components, 310 of 310 icons, and 30 of 30 modules resolved — the one miss,
`linkVariants`, was never a component to begin with, a `cva()` style-variants
export that had been mis-requested.

If the component contract needs machine validation later (mirroring
`ds-figma-snapshot`'s validator), add that deliberately rather than
half-building one now.
