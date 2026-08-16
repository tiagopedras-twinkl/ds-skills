# ds-skills

Agent Skills for design system work.

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
├── tokens.json        default mode of every collection, merged, plus every mode per token
├── tokens/<collection>.<mode>.json
├── typography.json    text styles as typography composite tokens
├── components.json    name, path, kind, source file, variant axes, variant count
└── dependencies.json  what depends on what                        (optional)
```

It writes into the working directory of the session that ran it — `snapshots/<YYYY-MM-DD>/` directly inside whatever folder you started the agent in, never inside the skill's own installed folder. So you choose where a capture lands by choosing where you run it from, which for the tree above means a data repository rather than a tools one. A second capture on the same day never overwrites the first; it becomes `<YYYY-MM-DD>-2`.

A token is keyed by its collection followed by its name — `Primitives.Typography.Size.2xl`. Figma only makes a variable name unique *within* a collection, so the collection is half the identity; leaving it out means two collections cannot both be represented and an alias between them is indistinguishable from a token pointing at itself. Contract 2.0.0 changed this and is a breaking change for anything joining on a token path. See [`output-contract.md`](skills/ds-snapshot/references/output-contract.md), "Reading a snapshot written before 2.0.0".

Every token also records `modes` — every mode its collection declares, mapped to the value the token takes in that one. That is what makes `tokens.json` on its own a complete answer about themes, rather than the default mode with the rest in a folder beside it that a consumer holding one file cannot reach. It sits in `$extensions` because the token format has no concept of a mode and no legal way to put five values on one token; the per-mode files are unchanged, are still the source, and the validator compares the two in both directions. Added in contract 2.1.0, and additive — ignore the key and the file reads as it always did.

Every token also records `figmaVariableId`, Figma's own id for the variable. A path changes whenever someone renames a variable or moves it into another group; the id does not. For comparing two snapshots **of the same Figma file**, that is the key to join on — see "figmaVariableId, and what it is good for" for what it cannot tell you.

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

### Sharing it as one file

A snapshot is a folder, because the token files are standalone DTCG documents that off-the-shelf tools can read as-is. For uploading, attaching, or handing to another tool, pack it into one file:

```
node skills/ds-snapshot/scripts/to-bundle.mjs ds-snapshots/2026-08-03
```

```json
{
  "bundleVersion": "1.0.0",
  "snapshot": { "folder": "2026-08-03", "schemaVersion": "2.1.0", "exportedAt": "…", "dependenciesCaptured": true },
  "files": {
    "components.json":              { "…": "exactly components.json" },
    "dependencies.json":            { "…": "exactly dependencies.json" },
    "manifest.json":                { "…": "exactly manifest.json" },
    "tokens.json":                  { "…": "a standalone DTCG document" },
    "tokens/semantic.light.json":   { "…": "a standalone DTCG document" },
    "typography.json":              { "…": "a standalone DTCG document" }
  }
}
```

A container, not a second format: nothing is merged, renamed, or flattened, so each part keeps the format and the schema it already had and a consumer reads `bundle.files["tokens.json"]` exactly as it would read the file. `from-bundle.mjs <bundle.json> <dir>` restores the folder byte for byte, so a bundle someone sent you can be checked with the same validator as a fresh export.

It is written outside the snapshot folder on purpose — the contract lists every file a snapshot may contain, and a bundle is not one of them.

### Viewing it as a graph

`scripts/to-ds-graph.mjs` converts a snapshot into a flat `graph.json` of nodes and links:

```
node skills/ds-snapshot/scripts/to-ds-graph.mjs ds-snapshots/2026-08-03 graph.json
```

It needs the dependency layer, and refuses rather than emitting an empty graph without it.

The [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph) viewer does not need this step — it opens a snapshot folder or bundle directly.

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

## ds-design-md

Writes a `DESIGN-<name>.md` — a design-token frontmatter plus a prose write-up of a product or brand's visual system — from an existing codebase, a brand guidelines deck, or a Figma design system library.

The format is a two-part file: YAML frontmatter (`colors`, `typography`, `rounded`, `spacing`, a token-referenced `components` map) followed by an eleven-section body (Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do's and Don'ts, Responsive Behavior, Iteration Guide, Known Gaps) written from what was actually observed in the source, never invented. [`reference/format-spec.md`](skills/ds-design-md/reference/format-spec.md) is the authority on the shape; it was reverse-engineered from five real product analyses (Airbnb, Apple, Claude, Linear, Notion) plus an early Twinkl pass, and marks which sections are universal versus situational.

Three source types, each with its own gathering strategy:

- **A codebase** — find the token source (Tailwind config, a tokens file, CSS custom properties, a theme object) before reading components, then ground the prose in what actually renders rather than the token file alone. [`reference/source-repo.md`](skills/ds-design-md/reference/source-repo.md).
- **A brand guidelines deck** — PDF, Keynote, or a standalone HTML deck. States intent (palette, type specimens, voice) far more reliably than implementation (spacing, radii, component states) — the resulting file is expected to be thinner, and says so in Known Gaps rather than padding out values the deck never gave. [`reference/source-deck.md`](skills/ds-design-md/reference/source-deck.md).
- **A Figma library** — prefers reading an existing `ds-snapshot` over querying Figma live, then grounds the prose in screenshots of real frames, since a token map alone never shows how tokens actually compose on a page. [`reference/source-figma.md`](skills/ds-design-md/reference/source-figma.md).

A structural validator checks the result before it's reported done:

```
node skills/ds-design-md/scripts/validate-design-md.mjs DESIGN-example.md
```

It is not a full YAML/Markdown parser — it checks frontmatter keys are present and non-empty, `components:` entries reference tokens rather than raw hex, the required body sections exist, and sections that are present appear in the spec's canonical order. Exits 0 with warnings allowed, 1 on a real structural error.

## Changing the contract

The contract is versioned. Change it deliberately:

1. Bump `schemaVersion` in the manifest, the affected schema, and `output-contract.md`.
2. Update the validator to match, gating any new requirement on the snapshot's own `schemaVersion` so older snapshots stay valid.
3. Run `./tests/run.sh` and fix what breaks.
4. Record the change in `CHANGELOG.md`.

Never edit past snapshots to match a new shape. Their `schemaVersion` is what keeps them readable, and `tests/run.sh` checks that a 1.0.0 snapshot still validates against the current validator.

`tests/run.sh` runs six groups: a known-good fixture must validate; a 1.0.0 snapshot and a 1.1.0 one with the dependency layer skipped must too, and two collections holding the same variable name must both survive; every class of real breakage must be rejected — twenty-four of them, from a colour written as hex to two tokens claiming the same Figma variable id; the dependency layer built from raw captures by script must byte-match the hand-written fixture; the ds-graph adapter must produce a graph with nothing dangling; and the single-file bundle must round-trip a snapshot byte for byte. Four cases also assert *which* diagnosis the validator gives, because a self-reference reported as a circular alias chain sends anyone debugging it the wrong way. It lives outside `skills/` on purpose, so the installed skill stays lean. CI runs it on every push.

## Licence

MIT. See [LICENSE](LICENSE).
