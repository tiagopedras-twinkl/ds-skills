# ds-skills

Agent Skills for design system work. Currently one skill.

## ds-snapshot

Exports a Figma design system library into a dated, fixed-format snapshot on disk.

The point is the contract, not the export. Downstream consumers (parity audits, docs, date-over-date diffs, code generation) all read the same field names in the same places, so the output shape is identical every run regardless of which library it was pointed at or what Figma returned.

- Variables and typography use the [Design Tokens Community Group format 2025.10](https://www.designtokens.org/TR/2025.10/format/), an interoperable standard.
- Component inventory uses a local schema, because no standard for that exists yet.
- A zero-dependency validator gates completion. A snapshot that fails validation is never reported as done.

### Output

```
ds-snapshots/<YYYY-MM-DD>/
├── manifest.json      source, collections, modes, counts, unmapped items
├── tokens.json        default mode of every collection, merged
├── tokens/<collection>.<mode>.json
├── typography.json    text styles as typography composite tokens
└── components.json    name, path, kind, variant axes, variant count
```

The full contract is in [`output-contract.md`](skills/ds-snapshot/references/output-contract.md). Figma-to-DTCG conversion rules are in [`figma-mapping.md`](skills/ds-snapshot/references/figma-mapping.md).

Nothing in the output identifies a particular design system or organisation. The one namespaced value is the `$extensions` key, `io.github.tiagopedras-twinkl.ds-snapshot`, which is this repository's address and identifies the tool that wrote the metadata. The DTCG spec requires a vendor-specific extension key and recommends reverse domain notation to avoid clashes between tools. If you fork this, change that key to your own namespace.

### Requirements

Figma desktop open on the design system library you want to snapshot, with the [Figma Console MCP](https://github.com/southleft/figma-console-mcp) Desktop Bridge plugin paired. The skill stops rather than falling back to the REST transport, since variable reads there are unreliable on non-Enterprise plans and a partial snapshot is worse than none.

Node 18 or later for the validator. No dependencies.

### Install

Claude Code, or any agent that reads skill folders:

```
git clone https://github.com/tiagopedras-twinkl/ds-skills.git
cp -r ds-skills/skills/ds-snapshot ~/.claude/skills/
```

Claude.ai: zip the `skills/ds-snapshot` folder and upload it under Settings, Capabilities, Skills.

### Validate a snapshot by hand

```
node skills/ds-snapshot/scripts/validate-snapshot.mjs ds-snapshots/2026-08-03
```

Exits 0 when valid, 1 with a list of problems when not. Warnings are reported but do not fail.

## Changing the contract

The contract is versioned. Change it deliberately:

1. Bump `schemaVersion` in the manifest, the affected schema, and `output-contract.md`.
2. Update the validator to match.
3. Run `./tests/run.sh` and fix what breaks.
4. Record the change in `CHANGELOG.md`.

Never edit past snapshots to match a new shape. Their `schemaVersion` is what keeps them readable.

`tests/` runs two cases: a known-good fixture must validate, and a snapshot with a broken value, a stray extension namespace, or an unsubstituted placeholder must be rejected. It lives outside `skills/` on purpose, so the installed skill stays lean. CI runs it on every push.

## Licence

MIT. See [LICENSE](LICENSE).
