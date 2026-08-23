---
name: ds-parity-snapshot
description: Score how closely the Twinkl design system matches what is built, by comparing a Figma snapshot against the web and mobile code snapshots — per surface pair, across five checks — and write a dated parity run plus a readable findings list. Use whenever the user asks to score or refresh parity, asks how aligned design and code are, asks what is missing in code or missing in Figma, asks which components or options have drifted, asks for a parity report, or says the parity numbers are stale. Also use before any claim about design/code alignment, since the score is only trustworthy against snapshots that exist and are dated. Requires three snapshots on disk — Figma, web and app — and must be run from ds-inventory.
---

# Run a parity score

Compare a Figma snapshot against the web and mobile code snapshots and write a
dated parity run into `ds-inventory/generated/parity/<YYYY-MM-DD>/`, mirrored
byte-for-byte into `ds-inventory/snapshots/parity/<YYYY-MM-DD>/` so the run is
findable next to the captures it was scored from. `ds-inventory` stays the copy
that matters — the one the inspector reads and the one a record's
`parityExpected` is judged against; the mirror is a convenience copy, not a
second computation.

**Read `ds-inventory/rules/parity-contract.md` before doing anything else.** It defines
the three pairs, the five checks, the four outcome values, and every reason code.
Nothing in this skill re-explains it, and reporting a number without knowing which
of `n/a` and `unmeasurable` it came from is how a parity claim becomes wrong.

The one thing to carry in your head: **a parity run is not a snapshot.** A
snapshot is a neutral mirror of one reality on one date. This is a judgement made
on top of three of them, applying rules a person wrote. That is why it lives in
`ds-inventory` and not beside the captures.

## Before you run anything

Three snapshots must exist. Find the newest of each and **say all three dates out
loud before running**, because a run silently made from a three-week-old Figma
capture is worse than no run at all.

| Side | Where | If it is missing or stale |
|---|---|---|
| Figma | `ds-inventory/snapshots/figma/<date>/components.json` | `ds-snapshot-figma` |
| Web | `ds-inventory/snapshots/web/<date>/components.json` | `ds-snapshot-web`, run from `twinkl-web` |
| Mobile | `ds-inventory/snapshots/app/<date>/components.json` | `ds-snapshot-app`, run from `twinkl-family-mobileapp` |

If any one is more than a couple of weeks older than the others, stop and tell the
user which one is behind and what it means for the result. Do not refresh a
snapshot without being asked — capturing from Figma needs the desktop app open and
paired, and it is not this skill's job.

Run everything **from `ds-inventory`**, so the relative paths below resolve. The
two scripts live in this skill, in `scripts/`; the contract, the rules, the
records and the runs live in `ds-inventory`. That split is the point — the
machinery travels with the skill and can be updated in one place, while the
judgements a person made stay in the repo they describe. Nothing in `scripts/`
knows where it was installed: every path it touches arrives as an argument.

## Steps

1. **Score.** From `ds-inventory`:

   ```
   node <ds-skills>/skills/ds-parity-snapshot/scripts/score-parity.mjs \
     ../ds-inventory/snapshots/figma/<date> \
     ../ds-inventory/snapshots/web/<date> \
     ../ds-inventory/snapshots/app/<date> \
     generated/records decisions/parity-rules.yaml generated/parity/<today> \
     --mirror ../ds-inventory/snapshots/parity/<today>
   ```

   `<ds-skills>` is wherever this skill is installed — `~/Code/ds-skills` on
   Tiago's machine.

   With no ids after the output folder it scores every component and module —
   112 records today. Append ids to scope it to a sample while testing a rules
   change. Token groups and text styles are out of scope: they have no `figma`
   block and no code side captured, and scoring them would invent findings out of
   a gap in the tooling.

2. **Validate.**

   ```
   node <ds-skills>/skills/ds-parity-snapshot/scripts/validate-parity.mjs \
     generated/parity/<today> decisions/parity-rules.yaml generated/records
   ```


   Errors block: fix the cause and re-score. Warnings never block but every one
   is worth reading, and two kinds matter most. A **dead rule** — an exception
   that matched nothing this run — is how a real gap hides, because a renamed
   axis leaves its exception quietly excusing nothing. A **pass with unjudged
   options** is a check reading "pass" while part of the component went
   unanswered.

   Each run keeps its own copy of the rules as `rules-used.yaml`, so it stays
   reproducible after the live `rules.yaml` moves on. If the validator warns that
   the two differ, the numbers in that run predate a decision — re-score before
   quoting them.

3. **Read `findings.md`, not `parity.json`.** The findings file is the same data
   grouped for a person, one line per thing to decide or fix. `parity.json` is
   for the inspector and for a diff against the next run.

4. **Propose rules, never invent them.** Where an option matched nothing, work out
   whether it is a genuine gap or a naming difference nobody has written down —
   this is the part the script cannot do and you can. Then **propose** entries for
   `decisions/parity-rules.yaml` and let the user approve them. Every rule you add changes
   the score, so a rule slipped in without being named is a score nobody can
   trust. Mark anything you add with the date and a one-line reason.

5. **Report.** Lead with what changed since the last run in `generated/parity/`, then
   the findings worth acting on. Say which snapshot dates the numbers came from,
   every time. Write the prose version into `ds-audit/reports/<date> - parity.md`,
   which is where every other audit in this system lands.

## What never happens in a run

**No score is written onto a record.** A score derived from three snapshots with
three capture dates goes stale the moment any one is re-run, and a record holding
a copy would look authoritative while being quietly wrong. The only parity data in
a record is the hand-owned `parityExpected` block, which is the user's. No tool
writes it, including you.

**No single blended parity percentage.** The five checks are published separately.
A weighted headline is only ever computed over pairs where all five are
measurable, which today is none of them, because no component has a comparable
screenshot on both sides. `null` is the correct answer and the run says why.

**No guessing at what a component is meant to be.** Absence from a surface counts
as a failure until someone excuses it in that record's `parityExpected`. That is
deliberate: the default cannot be "excused", or the score improves whenever people
stop answering questions.

## Known limits, worth restating in any report

The record set is built from the Figma snapshot, so **a component that exists only
in code has no record and is invisible to this score.** It answers "is Figma
built" and not yet "is code designed".

**Check 5 is not implemented.** Comparing how two things look needs a Figma
capture and a code capture of the same variant on the same ground, and today's
screenshots are Storybook docs pages rather than single components. Every
`looksRight` reads `unmeasurable`, which is the honest answer, not a failure.

**The web-mobile pair treats web as the declared side.** Settings that exist only
in the mobile app are reported but not scored against anything.
