# Changelog

Contract versions are independent of skill versions. A skill change that does not alter the
output shape does not bump the contract.

## Contract 1.0.0 — 2026-08-03

Initial contract.

- Variables and typography as DTCG 2025.10, one file per collection and mode, plus a merged
  default-mode `tokens.json`.
- Component inventory: name, path, kind, variant axes and values, variant count, deprecation.
- `manifest.json` records source, collections, modes, counts, and unmapped items.
- Deterministic ordering and formatting so two snapshots differ only in `exportedAt`.

### Notes on 1.0.0

The `$extensions` namespace is `io.github.tiagopedras-twinkl.ds-snapshot`. It identifies the tool that wrote
the data, not the team that ran it, so a snapshot stays readable by anyone using this skill. The
DTCG spec requires a vendor-specific key and recommends reverse domain notation. The schemas carry
no `$id`; add the published raw URL once the repo is public if you want them resolvable.
