# The component index

One generated answer to two questions that currently have several: how many
components does the library hold, and which of them has nobody written guidance
for yet.

It is built by `scripts/build-component-index.mjs`, validated against
`schemas/component-index.schema.json`, and written as a pair — a JSON for tools
and a Markdown for reading:

```bash
node <skill>/scripts/build-component-index.mjs snapshots/<YYYY-MM-DD>
```

## Why this is not a snapshot file

The obvious place for it is inside the snapshot, beside `components.json`. It must
not go there, for two separate reasons.

The first is mechanical. The contract lists every file a snapshot may hold, the
validator compares that list against the directory in both directions, and
non-negotiable 2 forbids adding a file that is not in the contract. An index
written into `snapshots/<date>/` fails validation.

The second matters more. A snapshot is what Figma held on a date. Whether
`ds-docs/component-docs/button.md` exists is a fact about the docs folder, not
about Figma — so an index inside a snapshot would go out of date every time
somebody wrote a doc, without Figma changing at all. A dated capture that stops
being true while its source is untouched is not a capture.

So the index sits **outside** the snapshot folder, exactly as the bundle does, and
is regenerated whenever either input moves. Its inputs are a snapshot already on
disk and a folder of Markdown, which means it needs no Figma connection: doc
coverage can be refreshed daily while captures stay weekly.

In the language of `ds-snapshots/inventory/DOMAINS.md` this is the **resolved**
layer, and it fills two cells that file already names — inventory's
`component-list.md` and docs' "a docs coverage report". Resolved artifacts are
disposable. Never edit one; rebuild it.

## What it is not

It is not the component inventory proposed in `ds-snapshots/inventory/`. That one
is a record per component with hand-owned fields — state, category, the code
mapping, to-dos — and it lives in the *decided* layer. This holds no hand-owned
fields whatsoever, and every value in it is derived.

The two fit together rather than competing: the index is the worklist that says
which components still need an inventory record, and which still need a doc. It is
also the honest denominator for both.

## Where the numbers come from

Three inputs, and the index names all three in `sources` so any figure in it can
be checked.

**The snapshot's `components.json`** is the population. Nothing else defines what
exists, and the index never adds, filters or renames an entry — `id` is carried
through verbatim, so this file cannot introduce an identity of its own.

**The docs folder** supplies coverage. Top-level `.md` files only, less
`README.md`. A subfolder inside a docs folder groups something else — cross-system
notes, templates — never one component's page.

**The map**, `index-map.json` in the docs folder, supplies the three things a
generator cannot work out for itself. It is hand-owned: the script reads it and
never writes it, which is the ownership rule from `DOMAINS.md` applied to the one
place this tool needs a human judgement.

```json
{
  "assetSources": ["1. Foundations"],
  "componentSources": ["2. Components"],
  "notComponentDocs": ["figma-notes-gathered.md"],
  "aliases": { "web/header": "web-header.md" }
}
```

Everything works without the map. You get a cruder answer and the script says so.

## Assets are the reason the map exists

The 2026-08-04 capture holds 322 components. Only 87 of them are components anyone
would write usage guidance for; the other 235 are the icons, pictograms and flags
in the Foundations file. Both sets are legitimately components in Figma and both
belong in a snapshot.

But a coverage figure over all 322 reads **7% documented**, and over the 87 it
reads **25%**. The first number is not a pessimistic version of the second, it is a
different question answered by accident — and it would push you to write 235 icon
pages that should never exist.

So `assetSources` names the Figma files whose components are assets. Their entries
are still counted and still listed; they are marked `not-applicable` and excluded
from the coverage denominator. Coverage is then reported **per Figma file**, never
as one library-wide percentage, because two populations in one ratio is the fault
being fixed.

### Why there are two lists and not one

`componentSources` is the inverse of `assetSources`, and it exists so a warning can
be precise instead of constant.

With only `assetSources`, a file is either a known asset file or unclassified — and
the components file is permanently unclassified, so either every run warns about it
or no run warns about anything. Neither is any use: a warning that fires every time
is one you stop reading, which is how a Figma branch name nobody has classified
slips through counted as 238 documentable components.

So a source in neither list is genuinely undecided. It counts as documentable, which
is the safe direction, and it is reported on the terminal **and in the Markdown**
every run until somebody settles it. The Markdown matters more: it is read days
later by someone who never saw the run, and a caveat that lived only in a terminal
is a caveat that was never given.

A branch capture carries the branch name as its `source`, so expect to add a line
per branch you snapshot.

### When there is nothing to index

A snapshot whose every component is an asset produces no index at all — the script
refuses and names the files it walked.

Writing one anyway gives "0 documented of 0" beside "22 pages matched no component",
which reads as an alarm about the docs folder when the truth is that the capture
walked no component file. The 2026-08-08 pair are exactly this case. A refusal that
explains itself is better than an index that reports a crisis nobody has.

## Matching a component to its doc

Three rules, in order, and the rule that fired is recorded on every match as
`matchedBy`. That field exists because a wrong match and a real doc are
indistinguishable once both simply read as `documented`.

1. **`alias`** — an explicit entry in the map. Always wins. If it names a file that
   is not there, the entry is `missing` with a note saying so, rather than silently
   passing.
2. **`id`** — the full id with its groups, `/` becoming `-`: `web/header` looks for
   `web-header.md`. Ids are unique by construction, so this rule is never
   ambiguous.
3. **`name`** — the last segment on its own: `Header` looks for `header.md`. Applied
   only when no other component shares that name.

Anything unmatched is `missing`. Anything that could match more than one page, or
whose name is shared and a page for that name exists, is `ambiguous` — listed for a
person to settle with an alias, and counted as covering nothing. **An ambiguous
match is never resolved by picking the first.** Reporting a doc for a component
nobody wrote one for is worse than reporting a gap.

`app/header` and `web/header` are the live example. Both slug to `header`, so
neither may claim a `header.md`; each needs its own alias, or its own page named
after its id.

Slugging is the contract's own rule — lowercase, non-alphanumerics collapsed to
single hyphens, no leading or trailing hyphen — so `In-line message` finds
`in-line-message.md` without special handling.

## Pages matching no component

Reported in `unmatchedDocs`, and worth reading every time. A page here means one of
two things: the component was renamed in Figma and the doc is now orphaned, or the
file was never a component doc and belongs in `notComponentDocs`.

Keeping that list at zero is what makes it useful. A section you have learned to
skip cannot warn you about a rename.

## Determinism

Same snapshot and same docs folder produce byte-identical output apart from
`generatedAt`. Components sort by `id`, doc filenames sort before grouping, and
sources sort by name. That is the same guarantee the snapshot contract makes, and
for the same reason: a diff between two runs should show what changed in the
library, never what changed in the ordering.

## Extending it

`coverage` is a block per surface, holding only `docs` at 1.0.0. Web and mobile
parity would slot in beside it as `coverage.web` and `coverage.app`, with the same
`state` / `path` / `matchedBy` shape, and the per-source tallies extend the same
way.

That was left out on purpose. Reading two product repos makes the generator slow
and fragile, the parity reports in `ds-audit` already do that join, and a coverage
figure is only worth generating once its matching rules are as inspectable as these
ones. The shape is ready for it; the work is a separate decision.

## Privacy

The index names every component in the library, so it is private design system
data under the same rule as a snapshot. Never commit it and never publish it. It is
cheap to rebuild, which is the point of a resolved artifact — there is never a
reason to store one somewhere it might escape.
