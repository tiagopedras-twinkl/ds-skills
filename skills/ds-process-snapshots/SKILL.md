---
name: ds-process-snapshots
description: Turn the captures in ds-inventory/snapshots/ into everything derived from them — rebuild the 429 records, validate them, rebuild the dependency edges, cross-check them against ds-graph, score design/code parity, and report what changed. Use whenever the user asks to process or reprocess the snapshots, refresh or rebuild the records or the inventory, or re-run the checks. Also use for anything about parity, since the scorer lives here: score or refresh parity, how aligned design and code are, what is missing in code or missing in Figma, which components or options have drifted, a parity report, or the parity numbers being stale — and before any claim about design/code alignment, since a score is only trustworthy against snapshots that exist and are dated. Also use after ds-snapshot-all, since a capture on its own changes nothing downstream. Runs against whatever captures are on disk and takes no new ones — safe and quick to re-run after changing a rule or a decision. Must be run from ds-inventory.
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

The scorer lives in this skill, in `scripts/`. It reads the three captures plus
`generated/records/`, applies `decisions/parity-rules.yaml`, and writes a dated run to
`generated/parity/<today>/`, mirrored byte-for-byte into
`ds-inventory/snapshots/parity/<today>/` so the run is findable beside the captures it
was scored from. `ds-inventory` stays the copy that matters — the one the inspector
reads and the one a record's `parityExpected` is judged against; the mirror is a
convenience copy, not a second computation.

**Read `ds-inventory/rules/parity-contract.md` before scoring.** It defines the three
pairs, the five checks, the four outcome values, and every reason code. Nothing here
re-explains it, and reporting a number without knowing which of `n/a` and
`unmeasurable` it came from is how a parity claim becomes wrong. The active contract is
**1.2.0**, which is what the scorer writes; 1.3.0 was a token-scoring draft that does
not run and sits in `rules/parity-contract-drafts/`.

The one thing to carry in your head: **a parity run is not a snapshot.** A snapshot is a
neutral mirror of one reality on one date. This is a judgement made on top of three of
them, applying rules a person wrote. That is why it lives in `ds-inventory` and not
beside the captures.

**Say all three capture dates out loud before running.** Step 1 has already printed
them. A run silently made from a three-week-old Figma capture is worse than no run at
all; if any one side is more than a couple of weeks behind the others, stop and tell the
user which one it is and what it means for the result. Do not refresh a snapshot without
being asked — capture is `ds-snapshot-all`, and it is not this step's job.

Nothing in `scripts/` knows where it was installed: every path it touches arrives as an
argument. `<ds-skills>` below is wherever this skill lives — `~/Code/ds-skills` on
Tiago's machine.

**Score**, from `ds-inventory`:

```bash
node <ds-skills>/skills/ds-process-snapshots/scripts/score-parity.mjs \
  snapshots/figma/<date> snapshots/web/<date> snapshots/app/<date> \
  generated/records decisions/parity-rules.yaml generated/parity/<today> \
  --mirror snapshots/parity/<today>
```

With no ids after the output folder it scores every component and module — 112 records
today. Append ids to scope it to a sample while testing a rules change. Token groups and
text styles are out of scope: they have no `figma` block and no code side captured, and
scoring them would invent findings out of a gap in the tooling.

**Validate:**

```bash
node <ds-skills>/skills/ds-process-snapshots/scripts/validate-parity.mjs \
  generated/parity/<today> decisions/parity-rules.yaml generated/records
```

Errors block: fix the cause and re-score. Warnings never block but every one is worth
reading, and two kinds matter most. A **dead rule** — an exception that matched nothing
this run — is how a real gap hides, because a renamed axis leaves its exception quietly
excusing nothing. A **pass with unjudged options** is a check reading "pass" while part
of the component went unanswered.

Each run keeps its own copy of the rules as `rules-used.yaml`, so it stays reproducible
after the live rules move on. If the validator warns that the two differ, the numbers in
that run predate a decision — re-score before quoting them.

**Read `findings.md`, not `parity.json`.** The findings file is the same data grouped for
a person, one line per thing to decide or fix. `parity.json` is for the inspector and for
a diff against the next run.

**Propose rules, never invent them.** Where an option matched nothing, work out whether
it is a genuine gap or a naming difference nobody has written down — this is the part the
script cannot do and you can. Then **propose** entries for `decisions/parity-rules.yaml`
and let the user approve them. Every rule you add changes the score, so a rule slipped in
without being named is a score nobody can trust. Mark anything you add with the date and
a one-line reason.

#### What never happens in a run

**No score is written onto a record.** A score derived from three snapshots with three
capture dates goes stale the moment any one is re-run, and a record holding a copy would
look authoritative while being quietly wrong. The only parity data in a record is the
hand-owned `parityExpected` block, which is the user's. No tool writes it, including you.

**No single blended parity percentage.** The five checks are published separately. A
weighted headline is only ever computed over pairs where all five are measurable, which
today is none of them, because no component has a comparable screenshot on both sides.
`null` is the correct answer and the run says why.

**No guessing at what a component is meant to be.** Absence from a surface counts as a
failure until someone excuses it in that record's `parityExpected`. That is deliberate:
the default cannot be "excused", or the score improves whenever people stop answering
questions.

#### Known limits, worth restating in any report

The record set is built from the Figma snapshot, so **a component that exists only in
code has no record and is invisible to this score.** It answers "is Figma built" and not
yet "is code designed".

**Check 5 is not implemented.** Comparing how two things look needs a Figma capture and a
code capture of the same variant on the same ground, and today's screenshots are
Storybook docs pages rather than single components. Every `looksRight` reads
`unmeasurable`, which is the honest answer, not a failure.

**The web-mobile pair treats web as the declared side.** Settings that exist only in the
mobile app are reported but not scored against anything.

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
reported as a warning. Say which snapshot dates the numbers came from, every time.

Write the prose version into `ds-audit/reports/<date> - parity.md`, which is where every
other audit in this system lands.

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
