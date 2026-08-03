# ds-skills

Agent Skills for design system work. Currently one skill.

## ds-snapshot

Exports a Figma design system library into a dated, fixed-format snapshot on disk.

The point is the contract, not the export. Downstream consumers (parity audits, docs, date-over-date diffs, code generation, impact analysis) all read the same field names in the same places, so the output shape is identical every run regardless of which library it was pointed at or what Figma returned.

- Variables and typography use the [Design Tokens Community Group format 2025.10](https://www.designtokens.org/TR/2025.10/format/), an interoperable standard.
- Component inventory and the dependency layer use local schemas, because no standard for either exists yet.
- A zero-dependency validator gates completion. A snapshot that fails validation is never reported as done.

The snapshot has two parts. The **inventory** — what the library contains — is always exported. The **dependency layer** — what depends on what — is optional, because it costs a walk of every component's descendants and often needs more than one Figma file open. The skill asks about it before it starts.

### Output

```
ds-snapshots/<YYYY-MM-DD>/
├── manifest.json      source, collections, modes, counts, unmapped items
├── tokens.json        default mode of every collection, merged
├── tokens/<collection>.<mode>.json
├── typography.json    text styles as typography composite tokens
├── components.json    name, path, kind, source file, variant axes, variant count
└── dependencies.json  what depends on what                        (optional)
```

The full contract is in [`output-contract.md`](skills/ds-snapshot/references/output-contract.md). Figma-to-DTCG conversion rules are in [`figma-mapping.md`](skills/ds-snapshot/references/figma-mapping.md).

### The dependency layer

Answers one question before you change anything:

> If I change this token, style or component, what else moves?

Four kinds of link, all read from Figma directly — nothing is inferred from a name or from a colour value that happens to match:

- **bindings** — a component uses a token, and for which property (`fills`, `strokes`, `paddingLeft`…)
- **aliases** — a token points at another token, recorded per mode, so a theme swap is visible
- **nests** — a component contains another component, with a count
- **typography** — a component uses a text style

It is a set of links between things the snapshot already names, not a second inventory. Every path in it resolves in `tokens.json`, `typography.json`, or `components.json`, and the validator proves it. The two exceptions exist to record what the snapshot does *not* hold: `unresolvedBindings` for a binding to a variable that was never exported, and `nestsUncaptured` for a component that was nested but never walked — usually an icon living in a Figma file the bridge was not paired with. Both being empty means the snapshot is closed.

**Multiple Figma files.** Variables and text styles resolve across files on their own, so a components file binding a foundations file's variables needs only one connection. Components are the exception: one can only be walked in a file the bridge is paired with. So if you want the dependencies of components in several files, open the Desktop Bridge plugin on each of them — the skill asks which files at the start and reports which it walked.

Capture code and the Figma behaviours that shape it are in [`dependency-capture.md`](skills/ds-snapshot/references/dependency-capture.md). `scripts/build-dependencies.mjs` turns the raw captures into `dependencies.json`, reading the Figma-name-to-token-path mapping out of the snapshot's own `$extensions` rather than re-deriving it.

### Viewing it as a graph

`scripts/to-ds-graph.mjs` converts a snapshot into the `graph.json` that the [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph) viewer and its impact queries read:

```
node skills/ds-snapshot/scripts/to-ds-graph.mjs ds-snapshots/2026-08-03 graph.json
```

It needs the dependency layer, and refuses rather than emitting an empty graph without it.

Nothing in the output identifies a particular design system or organisation. The one namespaced value is the `$extensions` key, `io.github.tiagopedras-twinkl.ds-snapshot`, which is this repository's address and identifies the tool that wrote the metadata. The DTCG spec requires a vendor-specific extension key and recommends reverse domain notation to avoid clashes between tools. If you fork this, change that key to your own namespace.

### Requirements

Figma desktop open on the design system library you want to snapshot, with the [Figma Console MCP](https://github.com/southleft/figma-console-mcp) Desktop Bridge plugin paired. The skill stops rather than falling back to the REST transport, since variable reads there are unreliable on non-Enterprise plans and a partial snapshot is worse than none.

Node 18 or later for the validator. No dependencies.

### Install

Claude Code, or any agent that reads skill folders:

```
git clone https://github.com/tiagopedras-twinkl/ds-skills.git
cp -r ds-skills/skills/* ~/.claude/skills/
```

Claude.ai: zip a skill folder and upload it under Settings, Capabilities, Skills.

### Validate a snapshot by hand

```
node skills/ds-snapshot/scripts/validate-snapshot.mjs ds-snapshots/2026-08-03
```

Exits 0 when valid, 1 with a list of problems when not. Warnings are reported but do not fail.

Beyond field and type checks it proves the parts agree with each other: every count in the manifest matches the data it describes, every path in the dependency layer resolves in the file that defines it, and every alias in `dependencies.json` matches the reference already written in the corresponding per-mode token file — in both directions, so neither can drift from the other.

What it reports rather than rejects: bindings to variables the snapshot does not hold, and components nested but never walked. Both are gaps worth seeing, not reasons to fail a snapshot.

## Changing the contract

The contract is versioned. Change it deliberately:

1. Bump `schemaVersion` in the manifest, the affected schema, and `output-contract.md`.
2. Update the validator to match, gating any new requirement on the snapshot's own `schemaVersion` so older snapshots stay valid.
3. Run `./tests/run.sh` and fix what breaks.
4. Record the change in `CHANGELOG.md`.

Never edit past snapshots to match a new shape. Their `schemaVersion` is what keeps them readable, and `tests/run.sh` checks that a 1.0.0 snapshot still validates against the current validator.

`tests/run.sh` runs five groups: a known-good fixture must validate; a 1.0.0 snapshot and a 1.1.0 one with the dependency layer skipped must too; every class of real breakage must be rejected — seventeen of them, from a colour written as hex to an alias that disagrees with its per-mode token file; the dependency layer built from raw captures by script must byte-match the hand-written fixture; and the ds-graph adapter must produce a graph with nothing dangling. It lives outside `skills/` on purpose, so the installed skill stays lean. CI runs it on every push.

## Licence

MIT. See [LICENSE](LICENSE).
