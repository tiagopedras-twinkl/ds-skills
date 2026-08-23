---
name: ds-process-snapshots
description: Turn the captures in ds-inventory/snapshots/ into everything derived from them — rebuild the 429 records, validate them, rebuild the dependency edges, cross-check them against ds-graph, score design/code parity, and report what changed. Use whenever the user asks to process or reprocess the snapshots, refresh or rebuild the records or the inventory, re-run the checks, re-score parity, or says the records or the parity numbers are stale. Also use after ds-snapshot-all, since a capture on its own changes nothing downstream. Runs against whatever captures are on disk and takes no new ones — safe and quick to re-run after changing a rule or a decision.
---

# Process the snapshots

Everything downstream of a capture, in one command, in the right order. Capture is
`ds-snapshot-all`; this is the other half.

Run it after a capture, and run it any time a decision or a rule changes — that is the
common case and it needs no new capture. It is idempotent: two runs in a row produce
byte-identical records.

## Before anything

**Run from `~/Code/ds-inventory`.** Every step below assumes it.

Nothing here needs Figma, and only the graph cross-check needs `ds-graph`. That is the
point of the split: processing is pure, so it can run on a machine that could not
capture.

## Steps

### 1. Rebuild the records

```bash
npm run rebuild
```

This deletes `generated/records/` and rebuilds all of it from the newest capture per
surface, then lays `decisions/` over the top and validates. It resolves its own inputs,
so no path is typed and none can be mistyped.

Read its output rather than skimming it. It prints:

- **the three capture dates and the spread between them.** They will not match, and
  that is expected — but a parity score is built across all three, so a spread of more
  than a week means the oldest capture is doing real work in a number that reads as
  current. Say so in the report.
- **the record count by kind.** A large change here is either a real library change or
  a broken capture, and it is worth knowing which before going further.
- **any decision naming an id no record answers to.** A decision about something that
  has left the library is not an error, but it rots quietly.
- **the validator's result.** It exits non-zero on any error, which fails the rebuild.

### 2. Check the dependency copy is still honest

```bash
npm run check-graph
```

`generated/dependencies/figma.csv` is a committed copy of data `ds-graph` owns, and it
exists so the inspector works without `ds-graph` present. Copies drift. This rebuilds
the graph both ways and reports any node or link where they disagree.

**This is the only check that cannot run in CI**, because it needs both a snapshot and
`ds-graph` on the same machine. That is exactly why it belongs here — this skill runs
on the machine that has both, and nowhere else will ever run it.

It exits 1 on any difference. A difference is not automatically a fault: a component in
Figma with no record here is a finding about the library. Report what it says; do not
suppress it.

### 3. Score parity

Follow `ds-parity-snapshot`, which owns the scorer. It reads the three captures plus
`generated/records/`, applies `decisions/parity-rules.yaml`, and writes a dated run to
`generated/parity/<today>/`.

Read `ds-inventory/rules/parity-contract.md` first, as that skill says. Contract 1.3.0
is on disk and the scorer still writes 1.2.0 — know which you are reporting.

### 4. Report what changed

This is the step that makes the rest worth running, and it is the one the repo has
never had.

Because the rebuild is deterministic and starts from empty, **the git diff is the
change report.** Everything is rebuilt from the same inputs each time, so whatever
differs is what actually moved since the last run.

```bash
git -C ~/Code/ds-inventory diff --stat generated/
```

Lead with:

- **components added or removed.** A record that stops being written means the
  component is not in the newest Figma capture. The first rebuild dropped `tab-item`
  that way — captured on 2026-08-15, gone by 2026-08-23, and sitting stale in the
  records for eight days because nothing had ever deleted one.
- **renames**, visible as a changed `name` against an unchanged `figmaKey`.
- **parity movement**, per surface pair, against the previous run in `generated/parity/`.
- **adoption movement**, from `adoption/observations.csv`.

Then the checks: validator result, cross-check differences, and anything either
reported as a warning.

## What must not happen

**Never hand-edit anything under `generated/`.** It is rebuilt wholesale and an edit is
lost on the next run without a word. If a value there is wrong, the thing to fix is
upstream: a capture in `snapshots/`, a decision in `decisions/`, or the script that
joins them.

**Never re-run the two migration scripts.** `extract-decisions.mjs` and
`extract-code-match.mjs` lifted hand-made values out of the records and the generators
on 2026-08-23. `decisions/` is the source now, so running either again overwrites it
with whatever the last rebuild produced. Both refuse without `--force`; do not pass it.

**`adoption/observations.csv` is not regenerated.** It accumulates. A record holds only
the newest reading per surface, so earlier dates exist nowhere else — the rebuild adds
to the log and never rewrites it from scratch.
