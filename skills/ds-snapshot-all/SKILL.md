---
name: ds-snapshot-all
description: Capture all three design system surfaces in one go — the Figma library, the twinkl-web code, and the mobile app — into ds-inventory/snapshots/. Use whenever the user asks to refresh the snapshots, take a new capture, snapshot the design system, or says the snapshots are stale, and they have not named a single surface. Also use before a parity run or a records rebuild, since both are only trustworthy against captures that exist. This is capture only; it processes nothing. Run ds-process-snapshots afterwards to rebuild the records and score parity. Requires Figma desktop open on the three library files with the Figma Console MCP bridge paired, CodeGraph in twinkl-web, and the twinkl-family-mobileapp repo present.
---

# Capture all three surfaces

One command, three captures, one date. `ds-snapshot-figma`, `ds-snapshot-web` and
`ds-snapshot-app` each still work on their own; this runs all three so the set stays
together.

## All or nothing

**If any one capture cannot run, stop before starting any of them.** Do not capture
what you can and report the rest as skipped.

The reason is what the captures are used for. A parity run scores Figma against web
against mobile, and the records join all three. A set where two surfaces are fresh and
the third is five days old still produces a number, and nothing about that number says
which part of it is stale. Refusing outright is the honest failure; a partial set is a
quiet one.

So: **check all three preconditions first**, then capture. If a check fails, say which
one and what would fix it, and write nothing.

| Surface | Precondition | How to check |
|---|---|---|
| Figma | Figma desktop open on **1. Foundations**, **2. Components** and **3. Modules**, with the Figma Console MCP bridge paired | `figma_get_status`, then `figma_list_open_files` |
| Web | CodeGraph indexed in `~/Code/twinkl-web` | the check `ds-snapshot-web` already runs |
| App | `~/Code/twinkl-family-mobileapp` present, CodeGraph indexed | the check `ds-snapshot-app` already runs |

A partial capture already written is worse than none, so if a capture fails **after**
another has succeeded, delete what was written for that date and say so. Half a set on
disk is the thing this skill exists to prevent.

## Where they land

```
ds-inventory/snapshots/figma/<YYYY-MM-DD>/
ds-inventory/snapshots/web/<YYYY-MM-DD>/
ds-inventory/snapshots/app/<YYYY-MM-DD>/
```

All three under one folder, gitignored, beside the tooling that reads them. Never
overwrite an existing capture: a second on the same date takes a number, `-2` then
`-3`, which is the rule each individual skill already follows.

## Steps

1. **Check all three preconditions.** Report what you found for each, then stop if any
   failed. Do not offer to proceed with two.

2. **Capture Figma** — invoke `ds-snapshot-figma`, including the dependency layer. It
   is the slowest and the most likely to fail, so it goes first: a failure here costs
   nothing else.

3. **Capture web** — invoke `ds-snapshot-web`, run from `~/Code/twinkl-web`.

4. **Capture app** — invoke `ds-snapshot-app`, run from `~/Code/twinkl-family-mobileapp`.

5. **Update the catalogue.** `ds-inventory/snapshots/README.md` holds a table of
   captures. Add a row for each. A catalogue current for only some of the snapshots is
   worse than none.

6. **Report the set**, with the date of each and the spread between them. They will not
   always share a date — the three are captured in sequence and one may have been taken
   earlier in the day — but a spread of more than a day means something went wrong with
   the all-or-nothing rule and is worth saying.

7. **Say what happens next.** This skill captures and stops. Nothing has read the new
   snapshots yet: the records still describe the previous ones, and the parity score is
   still the old one. Tell the user to run `ds-process-snapshots`.

## What this deliberately does not do

It does not rebuild the records, score parity, or write a report. Capture and
processing are separate on purpose. Capture needs Figma desktop paired and CodeGraph
indexed and is slow and fragile; processing is pure and re-runnable. Keeping them apart
means a rule can be changed and everything reprocessed without capturing again — which
is the common case, and would otherwise mean a full re-capture every time.
