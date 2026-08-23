# Renaming in Figma

Read this only when the user has seen a report and explicitly asked to apply the
suggestions. Never read it as part of an audit.

Renaming writes to the user's document and cannot be undone from here. The audit
is safe and repeatable; this is neither. Keeping them apart is what lets the
audit run freely.

## Rules

1. **Never rename without an explicit yes in this conversation.** "Fix them",
   "apply the suggestions", "rename them" all count. A report the user has not
   replied to does not.
2. **Only rename where `suggestion` is non-null.** A failure with no suggestion
   needs a human decision. Never invent a name to fill the gap.
3. **Only rename from a JSON report of the current library state.** Re-run the
   audit against live Figma first if the report came from a snapshot, because a
   snapshot can be days old and node ids may have moved.
4. **Show the full list and get confirmation before the first write.** Old name
   to new name, one per line, with the count. Not a sample.
5. **One batch, then verify.** After writing, re-read the names and re-run the
   validator. Report what actually changed, not what was attempted.
6. **Stop on the first error.** A partial rename is recoverable if you say
   exactly where it stopped. It is not if you carried on and lost the position.

## Preconditions

Call `figma_get_status` with `probe: true`. The Desktop Bridge must be paired.
If it is not, call `figma_diagnose`, report it, and stop.

Call `figma_list_open_files` and confirm the paired file is the library the
report came from. If the report has a `source` field, it must match. A rename
run against the wrong file is the worst outcome this skill can produce, so check
rather than assume.

## Procedure

Save the audit as JSON first:

```bash
node scripts/validate-names.mjs --snapshot <dir> --format json --fails-only \
  --out /tmp/name-check.json
```

Then build the rename list from entries that have both a `nodeId` and a
`suggestion`. Present it to the user as `old → new`, with the count, and wait.

After confirmation, apply the renames with `figma_execute`. Node ids come from
the report, never from a name lookup, because names are exactly what is in flux.

```js
// input: pairs = [{ nodeId: "1:23", to: "Text Field" }, ...]
const results = [];
for (const { nodeId, to } of pairs) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) { results.push({ nodeId, ok: false, error: "not found" }); break; }
  const from = node.name;
  node.name = to;
  results.push({ nodeId, from, to, ok: true });
}
return results;
```

Break on the first failure rather than continuing. The returned array is the
record of what happened, so report from it and not from the input list.

## After

1. Re-run the audit against live Figma.
2. Report: renamed, skipped and why, still failing.
3. If a `ds-snapshot-figma` exists for this library it is now stale on names. Say so.
   Do not refresh it silently, that is the other skill's job and the user's call.

## What not to do

- Do not rename to resolve an `orphan-platform` or `bare-and-platform` warning.
  Those need a component to be created, split, or deleted, which is a design
  decision.
- Do not rename anything the validator passed, however inconsistent it looks.
  The spec is the authority, not taste.
- Do not touch component descriptions, variant property names, or variant
  values. Only the node name.
