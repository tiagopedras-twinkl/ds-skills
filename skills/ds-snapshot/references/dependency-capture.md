# Dependency capture

Step 6 of the skill. Only runs when the user asked for the dependency layer.

Four capture steps through `figma_execute`, plus a mapping pass you do yourself. Steps 2 to 4 depend on state step 1 leaves on `globalThis`.

Everything here is read-only. Nothing below calls a `create*`, `set*`, `remove`, or an assignment on a Figma node.

## Why it works this way

Details that cost real time to find. Do not simplify them away.

- **`getVariableByIdAsync` resolves imported library variables in place**, including name, collection, per-mode values, and alias targets. A components file binds variables that live in a separate foundations file, and this resolves them without opening that file. There is no cross-file join to do, and no reason to make the user open the foundations file for variables.
- **`getStyleByIdAsync` resolves imported text styles in place** the same way. Step 4 uses it only to name a style the snapshot could not match, since `typography.json` already records each style's `figmaStyleId`.
- **Components are the exception.** A component can only be walked in a file the bridge is paired with. This is the only reason a multi-file library needs more than one connection.
- **Walking a whole file in one call times out.** Batch by page. Roughly 25 pages takes about 4 seconds; `figma_execute` allows 30 seconds.
- **`globalThis` persists between `figma_execute` calls.** The resolver cache lives there. Without it the same variable id gets fetched hundreds of times and the walk times out. If a step fails with `__deps is undefined`, the plugin reloaded — re-run step 1 for that file, then continue.
- **Results over roughly 50KB are auto-saved to a file** instead of being returned. Read that file from disk rather than pulling the payload into context.
- **`boundVariables` values are sometimes an array, sometimes a single object.** `fills`, `strokes`, and `effects` give arrays; everything else gives one object. Normalise with `Array.isArray(v) ? v : [v]`.
- **`textStyleId` is `figma.mixed`** when one text node uses several styles. `figma.mixed` is a symbol, so a `typeof === "string"` test silently drops those styles. Use `getStyledTextSegments` for that case.
- **A text style's id is not the same string in every file.** In the file that owns the style, `getLocalTextStylesAsync()` reports `S:<key>,` — trailing comma, nothing after it. In a file that *uses* the style, a text node's `textStyleId` is `S:<key>,<localNodeId>`. Only `<key>` is shared. `build-dependencies.mjs` matches a walked component's `textStyles` against `typography.json`'s `figmaStyleId` with an exact lookup, so raw ids make **every** match fail — and fail quietly: `dependencies.json` comes out with zero typography links and one note per style saying it is absent from `typography.json`, with no error anywhere. This bit the 2026-08-04 snapshot of the Twinkl library, where 49 styles produced 244 typography links only once the ids were normalised. Normalise both sides to `id.split(",")[0]`, which is `S:<key>`. Step 2 below does it on the way out, `typography.json` records `figmaStyleId` in that form (see `references/output-contract.md`), and the builder normalises again on both sides so an older capture holding raw ids still maps.
- Skip components whose name starts with `.` or `_` — Figma treats those as private. This applies to what gets walked, not to nested instance names: a private part that something nests still shows up as a nested name.
- Skip a `COMPONENT` whose parent is a `COMPONENT_SET`. Walk the set itself, or every variant is captured separately.

## Multi-file

Run steps 1 and 2 once per file whose components you want. In Local Mode, `figma_execute` takes a `fileKey` to target a connected file without changing the active one; get the keys from `figma_list_open_files`. Cloud Mode pairs with a single file and rejects `fileKey`, so there you switch files with `figma_navigate` and run the steps again.

Steps 3 and 4 run once, at the end, against whichever file is active. The resolver cache is per plugin instance, so with `fileKey` targeting it accumulates across files as intended.

Record every file you walked in `manifest.dependencies.sources`, and never walk one file and quietly skip another the user named.

## Step 1 — initialise, per file

```js
globalThis.__deps = globalThis.__deps || { vars: {}, styles: {} };

// Cached resolver: id -> { label, entry }. Shared by every later step.
globalThis.__deps.resolve = async (id) => {
  const S = globalThis.__deps;
  if (S.vars[id]) return S.vars[id];
  const v = await figma.variables.getVariableByIdAsync(id);
  if (!v) {
    S.vars[id] = { label: null, entry: null };
    return S.vars[id];
  }
  const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
  const collection = col ? col.name : "(unknown collection)";
  const modes = {};
  for (const m of col ? col.modes : []) {
    const raw = v.valuesByMode[m.modeId];
    modes[m.name] = raw && raw.type === "VARIABLE_ALIAS" ? { alias: raw.id } : raw;
  }
  S.vars[id] = {
    label: `${collection}/${v.name}`,
    entry: { id: v.id, name: v.name, collection, type: v.resolvedType, modes },
  };
  return S.vars[id];
};

return {
  fileName: figma.root.name,
  fileKey: figma.fileKey || "",
  pageCount: figma.root.children.length,
  pages: figma.root.children.map((p, i) => ({ index: i, name: p.name })),
};
```

Note the `||` on the first line: re-running this for a second file must keep the cache built while walking the first.

## Step 2 — walk components, per file, in page batches

The dependency layer itself. Edit `FROM` and `TO` each call; `TO` is inclusive. Use `timeout: 30000`.

```js
const FROM = 0, TO = 24;                     // inclusive page indices
const S = globalThis.__deps;
const out = [];

for (let i = FROM; i <= TO && i < figma.root.children.length; i++) {
  const page = figma.root.children[i];
  await page.loadAsync();

  const tops = page
    .findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] })
    .filter((n) => n.type === "COMPONENT_SET" || !(n.parent && n.parent.type === "COMPONENT_SET"))
    .filter((n) => !/^[._]/.test(n.name));

  for (const top of tops) {
    const bindings = new Map();              // variable label -> Set of property names
    const instances = {};                    // nested component name -> count
    const styleIds = new Set();              // raw ids, "S:<key>,<localNodeId>"

    for (const n of [top, ...top.findAll(() => true)]) {
      for (const [prop, val] of Object.entries(n.boundVariables || {})) {
        for (const a of Array.isArray(val) ? val : [val]) {
          if (!a || !a.id) continue;
          const { label } = await S.resolve(a.id);
          if (!label) continue;              // deleted variable, nothing to point at
          if (!bindings.has(label)) bindings.set(label, new Set());
          bindings.get(label).add(prop);
        }
      }

      if (n.type === "TEXT") {
        if (typeof n.textStyleId === "string") {
          if (n.textStyleId) styleIds.add(n.textStyleId);
        } else {
          for (const seg of n.getStyledTextSegments(["textStyleId"])) {
            if (seg.textStyleId) styleIds.add(seg.textStyleId);
          }
        }
      }

      if (n.type === "INSTANCE") {
        const main = await n.getMainComponentAsync();
        if (main) {
          const name = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name : main.name;
          instances[name] = (instances[name] || 0) + 1;
        }
      }
    }

    // Step 4 resolves these, and getStyleByIdAsync needs the id exactly as the node
    // reported it — so the cache keeps the raw form and only the output is normalised.
    for (const id of styleIds) S.styles[id] = true;

    out.push({
      figmaName: top.name,
      page: page.name,
      type: top.type,
      // Keyed by label, so two Figma variables sharing a "<collection>/<name>"
      // produce one entry with the properties merged rather than a duplicate.
      bindings: [...bindings].map(([label, props]) => [label, [...props].sort()])
        .sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1)),
      instances,
      // "S:<key>", dropping the ",<localNodeId>" this file appends — that suffix is
      // local to this file, so leaving it on makes every match against
      // typography.json's figmaStyleId fail silently.
      textStyles: [...new Set([...styleIds].map((id) => id.split(",")[0]))].sort(),
    });
  }
}

return { fileName: figma.root.name, components: out };
```

If a batch times out, halve the range and run both halves. Nothing is lost — the resolver cache survives, so the retry is faster.

## Step 3 — close the variable graph

Step 2 only resolved variables that something binds. Their alias targets have not been fetched, so the alias chain from a token down to a primitive is incomplete. Repeat until nothing new appears.

```js
const S = globalThis.__deps;

let passes = 0;
for (; passes < 20; passes++) {
  const missing = new Set();
  for (const rec of Object.values(S.vars)) {
    if (!rec.entry) continue;
    for (const val of Object.values(rec.entry.modes)) {
      if (val && typeof val === "object" && val.alias && !S.vars[val.alias]) missing.add(val.alias);
    }
  }
  if (!missing.size) break;
  for (const id of missing) await S.resolve(id);
}

// One alias edge per variable per mode, with both ends as "<collection>/<name>".
const aliases = [];
for (const rec of Object.values(S.vars)) {
  if (!rec.entry) continue;
  for (const [mode, val] of Object.entries(rec.entry.modes)) {
    if (!val || typeof val !== "object" || !val.alias) continue;
    const target = S.vars[val.alias];
    if (target && target.label) aliases.push({ from: rec.label, to: target.label, mode });
  }
}

return { passes, variableCount: Object.keys(S.vars).length, aliases };
```

`passes` is diagnostic: an alias chain three deep needs three passes. If it reaches 20 the chain is circular. `references/figma-mapping.md` already requires circular chains to be recorded in `manifest.notes.unmapped` and omitted — do the same here rather than working around it.

## Step 4 — resolve the text style ids

```js
const S = globalThis.__deps;
const seen = new Set();
const out = [];
for (const rawId of Object.keys(S.styles)) {
  const s = await figma.getStyleByIdAsync(rawId);   // needs the raw id, suffix and all
  if (!s || s.type !== "TEXT") continue;
  const id = rawId.split(",")[0];                   // report it as typography.json keys it
  if (seen.has(id)) continue;                       // two files' raw ids, one style
  seen.add(id);
  out.push({ id, name: s.name });
}
return out;
```

Every id the walk collected should resolve here. One that does not means a component uses a style this snapshot cannot name; record it in `manifest.notes.unmapped` with reason `text style used by a component could not be resolved` and leave the link out.

## Building dependencies.json

Save each step's result to a file — the whole result, envelope and all; the builder unwraps it. When the bridge auto-saves a large result, that saved file *is* the input, so nothing large needs to pass through context. Then run:

```bash
node scripts/build-dependencies.mjs ds-snapshots/<YYYY-MM-DD> <capture-file...>
```

Pass every capture file in any order. It writes `dependencies.json`, fills in the manifest's dependency block, and prints anything for `manifest.notes.unmapped`.

Do the mapping this way rather than by hand. The script reads the mapping out of the snapshot itself — every token in `tokens.json` records its `figmaName`, every typography token its `figmaStyleId`, and `components.json` records each component's name and path — so it cannot drift from the sanitising rules the inventory already applied. Hand-mapping a few thousand bindings through context is slow and gets a handful wrong invisibly.

The table below is what the script implements. Read it to understand the output or to debug a mismatch, not to do the work yourself.

## The mapping

The capture speaks Figma's names. `dependencies.json` speaks the snapshot's ids, so nothing in it can dangle.

| Captured | Becomes | How |
|---|---|---|
| `bindings[][0]`, a `"<collection>/<name>"` label | `bindings[].token`, a token path | Sanitise the `<name>` part per `references/figma-mapping.md` and join its segments with `.`, exactly as `tokens.json` is keyed. **The collection is dropped**, because `tokens.json` merges collections at the top level and does not carry a collection group |
| `figmaName` of a walked component | the entry's `id` | The same slug rule `components.json` uses |
| `instances` key | `nests[].id` | Slug of that component's full Figma name, when it is in `components.json` |
| `instances` key with no inventory entry | `nestsUncaptured[].name` | Kept verbatim — it is a real dependency on something this snapshot does not hold |
| `textStyles` id | `typography[]`, a typography path | Match `id.split(",")[0]`, which is `S:<key>`, against each typography token's `figmaStyleId` — recorded in the same form. The `,<localNodeId>` a using file appends is dropped on both sides, so a raw capture still maps. A style with no match is named via step 4 for the note |
| `aliases[]` from step 3 | `aliases[]` | Both ends sanitised to token paths |

The collection dropping is the one place this is easy to get wrong. Two variables in different collections whose names sanitise to the same path already collide inside `tokens.json`; `references/figma-mapping.md` covers that as a name collision, and the same resolution applies here — the binding points at the token that survived, and the loser's binding goes in `unresolvedBindings`.

Two rules that matter:

- **A binding whose label maps to no token in `tokens.json` goes in `unresolvedBindings`**, keeping the raw Figma name. Do not drop it and do not invent a token path for it. It usually means a variable from a library the snapshot did not export, which is exactly the kind of gap worth seeing.
- **A nested component that was not walked goes in `nestsUncaptured`**, not `nests`. That is how "an icon from a file we did not open" stays visible instead of looking like it has no dependencies.

The validator checks every `token`, `nests[].id`, and `typography` entry resolves, and that `aliases` agrees with the references already in the per-mode token files. Those checks are what make the layer trustworthy, so do not work around a failure by deleting the entry.
