---
name: ds-app-snapshot
description: Look up real usage data for a list of Twinkl design-system components, icons, or design tokens in the mobile app (twinkl-family-mobileapp), using CodeGraph, and write it to a dated snapshot in ds-snapshots/app_snapshots/. This is the mobile counterpart to ds-web-snapshot — same intent (real usage counts from the actual codebase, not Figma), different mechanics because the design system here is a published npm package (@twinkltech/mobile-design-system) styled with NativeWind, not local CSS. Use whenever the user gives a list of component/icon/token names and asks for mobile usage counts or adoption data. Requires CodeGraph indexed in the session's current working directory (twinkl-family-mobileapp); this skill checks for it and initializes it if missing.
---

# App usage snapshot

Turn a list of names into real usage counts pulled from
`twinkl-family-mobileapp`, via
[CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph), and write
it as a dated snapshot so it can be compared run over run. This is the mobile
counterpart to `ds-web-snapshot` — same question ("what does the code actually
use?"), answered against a different codebase with a different styling model.

**Read `ds-web-snapshot` first if you haven't.** This skill only documents
where mobile diverges from it; steps that are identical are referenced, not
repeated.

## The one thing that's different about this repo

On web, design-system components are defined in the same repo CodeGraph
indexes. On mobile, the actual design system —
`@twinkltech/mobile-design-system` — is a **published npm package**, installed
into `node_modules`, which CodeGraph does not index.

That would be a dead end, except this app doesn't call the package directly
from screens. Every reusable, Figma-DS-bound component is wrapped locally in
`src/components/designSystem/<Name>/index.tsx` (confirmed for `Button`,
`Avatar`, `Divider`, `Switch`, `Toast`, `Tile` and others — none of them are
bare re-exports; each has a real local implementation CodeGraph can see and
find callers for). So Steps 1–4 below work exactly like web's, once you're
pointed at the right folder. What doesn't carry over is icons and tokens —
see their own sections.

## Non-negotiables

Same five as `ds-web-snapshot`, restated for this repo:

1. **CodeGraph is the source for components** — no `grep`, no manual `find`.
   **Icons and tokens are exceptions**, for the same reason as web's tokens:
   neither is a symbol CodeGraph can see (see "Icons" and "Tokens" below).
   Every icon and token entry carries `"method": "text-scan"`.
2. **Metadata is verbatim or absent.** `title`, `parameters`, `argTypes` come
   only from an actual sibling `*.stories.tsx`, read and copied as-is (this
   app uses `@storybook/react-native`, same CSF `meta` shape as web's
   `@storybook/react`). Missing a stories file means `null`.
3. **Every count is disambiguated to its exact defining file.** Names collide
   here too — `Avatar` exists both as `src/components/designSystem/Avatar/`
   (the DS component) and `src/modals/bottomSheets/ProfileSwapModal/components/Avatar.tsx`
   (an unrelated local component). Step 2 applies unchanged.
4. **Never overwrite a snapshot.** Same-day rerun gets `-2`, then `-3`.
5. **A requested name always ends up somewhere** — an entry in
   `components.json`/`icons.json`/`tokens.json`, or that file's `notFound`
   list.

## Preconditions: is CodeGraph available here?

Run in the session's current working directory — this must be
`twinkl-family-mobileapp`, not `ds-skills` or `ds-snapshots`. Unlike web,
CodeGraph is **not** an existing devDependency or documented convention in
this repo, so there's nothing to check for beforehand — just run it:

```bash
pnpm dlx @colbymchenry/codegraph status
```

- **"Not initialized"** → run `pnpm dlx @colbymchenry/codegraph init`. This
  writes a local `.codegraph/` index cache (~2s for the full repo, ~9k nodes)
  and touches nothing else — no `package.json` change, since `dlx` doesn't add
  it as a dependency. Local and reversible, safe to do without asking first.
  Re-run `status` to confirm before continuing. `.codegraph/` is untracked; if
  the user wants it gitignored, that's their call, not this skill's to make.
- **Already initialized** → proceed.

Note the plain `codegraph` binary name doesn't resolve here (`npx codegraph`
fails with "could not determine executable to run") — always use the scoped
package name, `@colbymchenry/codegraph`.

## Getting the list

Same as web: names inline or from a file, trimmed, deduped, casing preserved.
Set aside anything that's an icon name or a token name (see below) — those
never go through Steps 1–4.

## Step 1 — locate every name

```bash
pnpm dlx @colbymchenry/codegraph query "<name>" --json --limit 50
```

Keep only exact `node.name` matches, same caveat as web about the `--limit`
ceiling meaning truncation.

**Classify by file path:**

| Path prefix | Goes to |
|---|---|
| `src/components/designSystem/` | `components.json` |
| anything else | not written — see below |

`src/components/app/` is deliberately **not** in this table.
`docs/COMPONENTS.md` in this repo defines it as app-shell/composite building
blocks that are *not* a 1:1 Figma DS component, so a match there isn't a
design-system component to begin with — note it in the report as "also
defined at `<path>` (app-shell component, not a DS component)" rather than
writing it to `components.json`. The same applies to a one-off component
living inside a screen folder.

A name with zero matches anywhere goes in `components.json`'s `notFound`.

## Step 2 — name collisions

Identical procedure to `ds-web-snapshot` — check the raw Step 1 results for
the same exact name in more than one file before trusting `callers`; fall
back to `explore`, then `node --file` for any collision `explore`'s "Blast
radius" omits. Confirmed live on this repo: `Avatar` collides
(`src/components/designSystem/Avatar/index.tsx` vs.
`src/modals/bottomSheets/ProfileSwapModal/components/Avatar.tsx`); `Divider`,
`Switch`, `Toast`, `Tile` did not, in an August 2026 check — collisions can
appear as the app grows, so always check, don't assume last run's answer
still holds.

## Step 3 — metadata

Sibling `*.stories.tsx` next to the component's `index.tsx`, same directory.
Read its `meta` object (`title`, `component`, `argTypes` — this app's CSF
uses `@storybook/react-native`'s `Meta`/`StoryObj`, structurally identical to
web's). Copy `title` and `argTypes` verbatim; `parameters` is rare here
(mobile stories tend not to set Storybook web-style `parameters` like
`layout` — if absent, it's `null`, don't invent one). No stories file means
all `null`.

## Step 4 — build the file URL

```bash
git remote get-url origin   # → https://github.com/twinkltech/twinkl-family-mobileapp.git
```

```
https://github.com/twinkltech/twinkl-family-mobileapp/blob/dev/<filePath>#L<startLine>
```

**`dev`, not `main`** — confirmed via `gh api repos/twinkltech/twinkl-family-mobileapp
--jq .default_branch` on 2026-08-22 (`origin/HEAD` also points at `dev`
locally; a `main` branch exists too but isn't the default). Always the
default branch, never the session's checked-out branch, same reasoning as
web: a feature-branch link breaks once the branch is deleted.

This repo is private under the `twinkltech` org. `gh api` against it 404s
under the **tiagopedras** (personal) account — switch first, per the account
table in the root `CLAUDE.md`:

```bash
gh auth switch --hostname github.com --user tiagopedras-twinkl
```

## Step 5 — write the files

Target folder, always this exact absolute path regardless of the session's
working directory — mirrors `web_snapshots` in the tools/data split:

```
/Users/tiagopedras/Code/ds-snapshots/app_snapshots/<YYYY-MM-DD>/
```

**Never overwrite** — `<YYYY-MM-DD>-2`, then `-3`, first free number, same
rule as every other snapshot in this folder.

Shape is the same as web's `components.json`, minus the CMS-module concept
(see "Not covered" below):

```json
{
  "generatedAt": "2026-08-22T10:00:00Z",
  "repo": "twinkltech/twinkl-family-mobileapp",
  "branch": "dev",
  "requested": ["Button", "Avatar", "Divider"],
  "notFound": [],
  "items": [
    {
      "name": "Button",
      "fileUrl": "https://github.com/twinkltech/twinkl-family-mobileapp/blob/dev/src/components/designSystem/buttons/Button/index.tsx#L228",
      "title": "Design System/Buttons/Button",
      "parameters": null,
      "argTypes": { "variant": { "control": "select", "options": ["primary", "secondary", "tertiary", "ghost", "outlined", "error", "link"] } },
      "usage": {
        "count": 20,
        "sampled": false,
        "callers": [
          { "name": "SavedScreen", "filePath": "src/screens/saved/SavedScreen.tsx", "startLine": 71 }
        ]
      }
    }
  ]
}
```

Write:

- **`components.json`** — items classified under `src/components/designSystem/`
- **`icons.json`** — written by `scan-icons.mjs`, see "Icons" below
- **`tokens.json`** — written by `scan-tokens.mjs`, see "Tokens" below

Write all three every run, even when one has zero items. No `modules.json` —
see "Not covered" for why.

## Icons

Icons in this app are SVG assets re-exported through one barrel file,
`src/components/icons/index.ts` — 46 entries as of August 2026, each shaped
`export { default as ActivitiesIcon } from "@/assets/icons/activities.svg";`.
That's not a function or component definition, so CodeGraph has nothing to
index beyond the import site: `codegraph query "ActivitiesIcon"` finds only
the barrel's own export line, and `codegraph callers "ActivitiesIcon"` comes
back `{ "callers": [] }` even for an icon actually used elsewhere — confirmed
live, `ActivitiesIcon` is passed as `icon={ActivitiesIcon}` in
`SavedScreen.tsx:71`, which `callers` cannot see at all.

So icon usage is measured by a text scan, the direct mobile equivalent of why
web's tokens get one:

```bash
node <ds-skills>/skills/ds-app-snapshot/scripts/scan-icons.mjs \
  --repo /Users/tiagopedras/Code/twinkl-family-mobileapp \
  --out  /Users/tiagopedras/Code/ds-snapshots/app_snapshots/<YYYY-MM-DD>
```

Optional: `--barrel <path>` if the icon barrel moves, `--requested "Name,Name"`
to record which of the user's names aren't in the barrel at all.

**Run it every time**, same as web's token scan — it takes about a second and
needs no list from the user.

### How it counts

It parses the barrel file's export lines for the name-to-asset map, then
scans every `.ts/.tsx/.js/.jsx` file for whole-word references to each
exported name, excluding the barrel's own import line in the referencing
file (so importing an icon doesn't itself count as a use — only what happens
with it afterwards does). Files are split into source, stories and tests.

### What it cannot see

`src/components/icons/Iconography.stories.tsx` renders every icon in the
barrel for its Storybook overview page, which puts a floor of at least 1 on
every icon's count and 1 file in every icon's `inStories` figure — that isn't
real product adoption, so always read `inSource` alongside the headline
`count`, not instead of it. An icon referenced only via a computed/dynamic
name (built from a string at runtime) is invisible to this method, same
class of blind spot as web's `` bg-${colour} ``.

## Tokens

Design tokens aren't CSS custom properties authored in this repo — they're
generated inside `@twinkltech/mobile-design-system` and consumed two ways at
once, per this app's own documented styling convention
(`.github/agents/ui-styling.md`): spacing, gap, radius and font-weight mostly
go through **NativeWind class names** (`gap-150`, `p-200`, `rounded-xl`,
`font-medium`); colours and some dimensions go through **JS token objects**
(`edsLight.text.default`, `cornerRadius.xl`) via `style` props, because
NativeWind's colour classes can't express Twinkl's light/dark scheme
switching the way `scheme(edsLight.x, edsDark.x)` does. A token counts if
*either* form is used — neither is more "real" than the other here.

```bash
node <ds-skills>/skills/ds-app-snapshot/scripts/scan-tokens.mjs \
  --repo /Users/tiagopedras/Code/twinkl-family-mobileapp \
  --out  /Users/tiagopedras/Code/ds-snapshots/app_snapshots/<YYYY-MM-DD>
```

Optional: `--package <name>` if the DS package is ever renamed (default
`@twinkltech/mobile-design-system`), `--requested "background-brand,spacing-200"`.

**Run it every time**, same reasoning as web and icons.

### How it counts

The script `require()`s the installed package's own
`nativewind-preset.js` — the same file NativeWind itself loads to generate
utility classes — rather than hand-copying a key list, so it always matches
whichever package version is actually installed (checked live: 162 tokens
at `@twinkltech/mobile-design-system@0.0.28`, spanning colour, spacing, gap,
radius, font-size and font-weight). For every token it counts:

- **NativeWind utility classes**, from a prefix set narrowed to what
  React Native actually resolves — no `ring`/`outline`/`divide`/`accent`
  /`caret`/`decoration`/`placeholder`, all DOM-only concepts that would just
  be false negatives if left in, but not false positives either way since a
  prefix that never appears in this codebase never over-counts.
- **Direct JS property access** — three shapes, matched separately:
  `edsLight`/`edsDark`/`ldsLight` theme objects (nested two levels,
  `edsLight.background.default`), the numeric-keyed `spacing`/`gap` objects
  (bracket-only, since `spacing.200` isn't valid JS — `spacing["200"]`), and
  the word-keyed `cornerRadius`/`fontSize`/`fontWeight` objects (dot
  notation).

Spacing and gap are tracked as **separate tokens** even where their value
lists are identical (`spacing-200` vs `gap-200`) — they're two distinct CSS
custom properties (`--spacing-200`, `--gap-200`) under the hood, not one
token with two names.

Raw palette shades (`primitives.blue["500"]`) are tracked in their own
`primitives` array, not folded into the semantic token list — same
distinction web draws between palette and semantic tokens, and for the same
reason: these are meant to be reached through a semantic token, so
appearing here at all is itself worth a look, not routine.

### What it cannot see

Same two limits as web's scan, restated for this codebase: a class name or
theme-object key assembled at runtime is invisible, and a test asserting a
token is *absent* still counts as a reference (visible in `inTests`). One
mobile-specific addition: the prefix set in `PREFIXES` is deliberately
narrower than Tailwind's full web set — if the app ever adopts a
NativeWind/Tailwind utility this list doesn't cover, that token will read as
under-used here even if it's genuinely wired up. If a family looks
suspiciously flat, check whether NativeWind actually supports a utility
prefix for it before reporting the number as real.

### Reading the result

Same four groups as web: `usedInProductCode`, `designSystemOnly` (only
inside `src/components/designSystem/` — the app's DS-bound wrapper layer,
standing in for web's `ui/`), `testOrStoryOnly`, `unused`. A whole family
sitting at zero usually means the prefix list above is missing something for
that family, not that the family is genuinely dead — check before reporting
it as a finding.

## Not covered — decide separately if wanted

- **`src/components/app/`** — app-shell/composite components. Not Figma-DS
  components by this app's own definition (`docs/COMPONENTS.md`), so
  deliberately outside this skill's scope, not an oversight.
- **Sanity CMS content modules** (`homeScreenModule`, `openChatModule`, etc.,
  in `src/types/sanity/sanity.types.ts`) — the closest thing this app has to
  web's CMS modules, but a fundamentally different kind of usage to count:
  narrowing a discriminated union in a switch/render function, not invoking a
  component. Forcing that through Steps 1–4 or a text scan the way icons and
  tokens work would need its own designed method, not a copy of either — left
  out of this first version rather than half-built.
- **The design-system package's own iconography set**
  (`@twinkltech/mobile-design-system/iconography`, separate from the app-level
  barrel) — if a component ever imports from there directly instead of
  through `src/components/icons/`, this skill won't see it. Not observed in
  an August 2026 check of `src/`; revisit `scan-icons.mjs` if that changes.

## Report

Same shape as web: target folder path, how many names requested/found/not
found, any collisions (name them), then the counts worth attention — not a
full table dump. Then icons as their own short paragraph (declared count,
used/unused, the Storybook-inflation caveat). Then tokens (declared count,
the four groups, the family-flatness caveat, the className/JS-split
distinction). Close with what neither text scan can see, so counts aren't
over-trusted.

## Why almost no script

Same division of labour as `ds-web-snapshot`: Steps 1–4 are direct CodeGraph
CLI calls needing judgement (especially Step 2's collisions), read and
interpreted by the agent. `scan-icons.mjs` and `scan-tokens.mjs` are the
exceptions because both are exhaustive exact-match counting jobs with no
ambiguity to resolve — the same shape of work as web's `scan-tokens.mjs`,
just against a barrel file and an installed package instead of local CSS.
