import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "./.tmp/ds-snapshots/2026-08-03";
mkdirSync(join(root, "tokens"), { recursive: true });
const S = "https://www.designtokens.org/schemas/2025.10/format.json";
const w = (p, o) => writeFileSync(join(root, p), JSON.stringify(o, null, 2) + "\n");
const ext = (figmaCollection, figmaName, figmaType, figmaVariableId) => ({
  "io.github.tiagopedras-twinkl.ds-snapshot": { figmaCollection, figmaName, figmaType, figmaVariableId },
});

const colour = (components, hex, figmaName, id) => ({
  $value: { colorSpace: "srgb", components, alpha: 1, hex },
  $extensions: ext("Primitives", figmaName, "COLOR", id),
});

// Three collections, chosen to exercise the cases contract 2.0.0 exists for:
//   - "Primitives" and "Semantic" both hold a variable called space/md, which Figma
//     allows and a collection-free path cannot represent
//   - the Semantic one aliases the Primitives one, which without collections in the
//     path is indistinguishable from a token pointing at itself
//   - "Primitives/Spacing" has a "/" in its own name, so its collection opens two
//     groups and its capture label cannot be split on the first separator
const primitives = {
  $schema: S,
  Primitives: {
    colour: {
      $type: "color",
      blue: {
        "500": colour([0, 0.4, 0.8], "#0066cc", "colour/blue/500", "VariableID:1:1"),
        "700": colour([0, 0.2667, 0.6], "#004499", "colour/blue/700", "VariableID:1:2"),
      },
    },
    space: {
      $type: "dimension",
      md: { $value: { value: 16, unit: "px" }, $extensions: ext("Primitives", "space/md", "FLOAT", "VariableID:1:3") },
      sm: { $value: { value: 8, unit: "px" }, $extensions: ext("Primitives", "space/sm", "FLOAT", "VariableID:1:4") },
    },
  },
};

const primitivesSpacing = {
  $schema: S,
  Primitives: {
    Spacing: {
      gutter: {
        $type: "dimension",
        $value: { value: 24, unit: "px" },
        $extensions: ext("Primitives/Spacing", "gutter", "FLOAT", "VariableID:2:1"),
      },
    },
  },
};

const semanticLight = {
  $schema: S,
  Semantic: {
    action: {
      $type: "color",
      primary: {
        $value: "{Primitives.colour.blue.500}",
        $extensions: ext("Semantic", "action/primary", "COLOR", "VariableID:3:1"),
      },
    },
    layout: {
      gutter: {
        $type: "dimension",
        $value: { value: 16, unit: "px" },
        $extensions: ext("Semantic", "layout/gutter", "FLOAT", "VariableID:3:2"),
      },
    },
    space: {
      $type: "dimension",
      md: { $value: "{Primitives.space.md}", $extensions: ext("Semantic", "space/md", "FLOAT", "VariableID:3:3") },
    },
  },
};

const semanticDark = {
  $schema: S,
  Semantic: {
    action: {
      $type: "color",
      primary: {
        $value: "{Primitives.colour.blue.700}",
        $extensions: ext("Semantic", "action/primary", "COLOR", "VariableID:3:1"),
      },
    },
    layout: semanticLight.Semantic.layout,
    space: semanticLight.Semantic.space,
  },
};

// tokens.json = default modes of every collection merged, in case-insensitive
// collection-name order. "Primitives" and "Primitives/Spacing" share a root group;
// no path collides, because each collection's own segments keep them apart.
const merged = {
  $schema: S,
  Primitives: {
    colour: primitives.Primitives.colour,
    space: primitives.Primitives.space,
    Spacing: primitivesSpacing.Primitives.Spacing,
  },
  Semantic: semanticLight.Semantic,
};

// Contract 2.1.0 also repeats every mode's value on the token itself, under
// $extensions.modes, so tokens.json alone answers a question about themes. The
// per-mode files stay as they are — each is a standalone DTCG document — and the
// validator compares the two, so this copy cannot drift from them.
//
// Derived here rather than written by hand, for the same reason the exporter derives
// it: a hand-kept second copy is exactly the thing that goes stale.
const MODE_DOCS = {
  Primitives: { Value: primitives },
  "Primitives/Spacing": { "Mode 1": primitivesSpacing },
  Semantic: { Dark: semanticDark, Light: semanticLight },
};
const NS = "io.github.tiagopedras-twinkl.ds-snapshot";
function* eachToken(node, path = []) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("$") || typeof v !== "object" || v === null) continue;
    if ("$value" in v) yield [[...path, k].join("."), v];
    else yield* eachToken(v, [...path, k]);
  }
}
const valueAt = (doc, path) => path.split(".").reduce((n, s) => n?.[s], doc)?.$value;
function withModes(doc) {
  for (const [path, token] of eachToken(doc)) {
    const payload = token.$extensions[NS];
    const docs = MODE_DOCS[payload.figmaCollection] ?? {};
    payload.modes = Object.fromEntries(
      Object.keys(docs)
        .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
        .map((mode) => [mode, valueAt(docs[mode], path)])
    );
  }
  return doc;
}

w("tokens.json", withModes(JSON.parse(JSON.stringify(merged))));
w("tokens/primitives.value.json", primitives);
w("tokens/primitives-spacing.mode-1.json", primitivesSpacing);
w("tokens/semantic.light.json", semanticLight);
w("tokens/semantic.dark.json", semanticDark);

w("typography.json", {
  $schema: S,
  body: {
    $type: "typography",
    base: {
      $value: {
        fontFamily: "Inter",
        fontSize: { value: 16, unit: "px" },
        fontWeight: 400,
        letterSpacing: { value: 0, unit: "px" },
        lineHeight: 1.5,
      },
      $extensions: {
        "io.github.tiagopedras-twinkl.ds-snapshot": {
          figmaName: "Body/Base",
          figmaStyleId: "S:body",
          figmaLineHeight: { unit: "PERCENT", value: 150 },
        },
      },
    },
  },
  heading: {
    $type: "typography",
    "level-1": {
      $value: {
        fontFamily: "Inter",
        fontSize: { value: 42, unit: "px" },
        fontWeight: 700,
      },
      $extensions: {
        "io.github.tiagopedras-twinkl.ds-snapshot": {
          figmaName: "Heading/Level 1",
          figmaStyleId: "S:h1",
          figmaLineHeight: { unit: "AUTO" },
        },
      },
    },
  },
});

w("components.json", {
  schemaVersion: "2.1.0",
  components: [
    {
      id: "actions/button",
      name: "Button",
      path: ["Actions"],
      kind: "componentSet",
      source: "Design System Library",
      variants: { size: ["lg", "md", "sm"], type: ["primary", "secondary"] },
      variantCombinations: 6,
      description: "Primary interactive control.",
      deprecated: false,
      figma: { nodeId: "1203:45", key: "" },
    },
    {
      id: "actions/legacy-button",
      name: "Legacy Button [Deprecated]",
      path: ["Actions"],
      kind: "component",
      source: "Design System Library",
      variants: {},
      variantCombinations: 1,
      description: "",
      deprecated: true,
      figma: { nodeId: "1203:99", key: "" },
    },
    {
      id: "layout/card",
      name: "Card",
      path: ["Layout"],
      kind: "componentSet",
      source: "Product Components",
      variants: { elevation: ["flat", "raised"] },
      variantCombinations: 2,
      description: "",
      deprecated: false,
      figma: { nodeId: "1204:10", key: "" },
    },
  ],
});

// The optional dependency layer. Exercises every branch the validator has: a
// resolved binding, a binding into a collection whose name contains "/", a
// cross-collection alias between two same-named variables, a typography link, a nest
// inside the inventory, a nest that was never walked, and a binding to a variable the
// snapshot does not hold.
w("dependencies.json", {
  schemaVersion: "2.1.0",
  aliases: [
    { from: "Semantic.action.primary", to: "Primitives.colour.blue.700", mode: "Dark" },
    { from: "Semantic.action.primary", to: "Primitives.colour.blue.500", mode: "Light" },
    { from: "Semantic.space.md", to: "Primitives.space.md", mode: "Dark" },
    { from: "Semantic.space.md", to: "Primitives.space.md", mode: "Light" },
  ],
  components: [
    {
      id: "actions/button",
      bindings: [
        { token: "Primitives.space.sm", properties: ["itemSpacing", "paddingLeft"] },
        { token: "Semantic.action.primary", properties: ["fills"] },
      ],
      typography: ["body.base"],
      nests: [],
      nestsUncaptured: [{ name: "ArrowRight", count: 6 }],
      unresolvedBindings: [{ figmaName: "Legacy/icon-tint", properties: ["fills"] }],
    },
    {
      id: "layout/card",
      bindings: [
        { token: "Primitives.Spacing.gutter", properties: ["paddingTop"] },
        { token: "Semantic.layout.gutter", properties: ["itemSpacing"] },
      ],
      typography: ["heading.level-1"],
      nests: [{ id: "actions/button", count: 2 }],
      nestsUncaptured: [],
      unresolvedBindings: [],
    },
  ],
});

w("manifest.json", {
  schemaVersion: "2.1.0",
  generator: { skill: "ds-snapshot", skillVersion: "2.1.0" },
  exportedAt: "2026-08-03T09:14:22Z",
  spec: { designTokens: "2025.10" },
  source: {
    figmaFileName: "Design System Library",
    figmaFileKey: "",
    figmaLastModified: "",
    transport: "desktop-bridge",
  },
  collections: [
    { id: "primitives", name: "Primitives", defaultMode: "Value", modes: ["Value"], variableCount: 4 },
    {
      id: "primitives-spacing",
      name: "Primitives/Spacing",
      defaultMode: "Mode 1",
      modes: ["Mode 1"],
      variableCount: 1,
    },
    { id: "semantic", name: "Semantic", defaultMode: "Light", modes: ["Dark", "Light"], variableCount: 3 },
  ],
  files: [
    { path: "components.json", kind: "components" },
    { path: "dependencies.json", kind: "dependencies" },
    { path: "tokens.json", kind: "tokens-default" },
    {
      path: "tokens/primitives-spacing.mode-1.json",
      kind: "tokens-mode",
      collection: "Primitives/Spacing",
      mode: "Mode 1",
    },
    { path: "tokens/primitives.value.json", kind: "tokens-mode", collection: "Primitives", mode: "Value" },
    { path: "tokens/semantic.dark.json", kind: "tokens-mode", collection: "Semantic", mode: "Dark" },
    { path: "tokens/semantic.light.json", kind: "tokens-mode", collection: "Semantic", mode: "Light" },
    { path: "typography.json", kind: "typography" },
  ],
  counts: { variables: 8, typographyStyles: 2, components: 1, componentSets: 2 },
  dependencies: {
    captured: true,
    sources: [
      { figmaFileName: "Design System Library", figmaFileKey: "", componentsWalked: 2 },
      { figmaFileName: "Product Components", figmaFileKey: "", componentsWalked: 1 },
    ],
    counts: {
      bindings: 4,
      aliases: 4,
      nests: 1,
      nestsUncaptured: 1,
      typographyLinks: 2,
      unresolvedBindings: 1,
    },
  },
  notes: {
    nonStandardTypes: [],
    // A per-mode file cannot hold the other collection's tokens, so every
    // cross-collection reference in one is unresolvable there by definition. One
    // entry per mode file, never one per reference.
    unmapped: [
      {
        kind: "alias",
        name: "tokens/semantic.dark.json (2 references)",
        reason: "cross-collection alias unresolvable in mode file",
      },
      {
        kind: "alias",
        name: "tokens/semantic.light.json (2 references)",
        reason: "cross-collection alias unresolvable in mode file",
      },
    ],
  },
});

// The raw dependency captures that build-dependencies.mjs must turn into exactly the
// dependencies.json above. Written beside the snapshot, not inside it — the contract
// has no place for them, and they are an input, not an artifact.
const captures = join(root, "..", "captures");
mkdirSync(captures, { recursive: true });
const c = (p, o) => writeFileSync(join(captures, p), JSON.stringify(o, null, 2) + "\n");

// Step 2, wrapped in a bridge envelope, as a large result comes back.
c("walk-library.json", {
  ok: true,
  result: {
    fileName: "Design System Library",
    components: [
      {
        figmaName: "Actions/Button",
        page: "Buttons",
        type: "COMPONENT_SET",
        bindings: [
          ["Semantic/action/primary", ["fills"]],
          ["Primitives/space/sm", ["itemSpacing", "paddingLeft"]],
          ["Legacy/icon-tint", ["fills"]],
        ],
        instances: { ArrowRight: 6 },
        textStyles: ["S:body"],
      },
      {
        // No links at all, so it must be left out of dependencies.json.
        figmaName: "Actions/Legacy Button [Deprecated]",
        page: "Buttons",
        type: "COMPONENT",
        bindings: [],
        instances: {},
        textStyles: [],
      },
    ],
  },
});

// Step 2 again, for a second Figma file, unwrapped. The Primitives/Spacing binding is
// the one that cannot be recovered by splitting the label on its first "/".
c("walk-product.json", {
  fileName: "Product Components",
  components: [
    {
      figmaName: "Layout/Card",
      page: "Cards",
      type: "COMPONENT_SET",
      bindings: [
        ["Semantic/layout/gutter", ["itemSpacing"]],
        ["Primitives/Spacing/gutter", ["paddingTop"]],
      ],
      instances: { "Actions/Button": 2 },
      // Raw, as a using file reports it: "S:<key>,<localNodeId>". It must still map to
      // heading.level-1, whose figmaStyleId is the bare key.
      textStyles: ["S:h1,1204:10"],
    },
  ],
});

c("aliases.json", {
  result: {
    passes: 2,
    aliases: [
      { from: "Semantic/action/primary", to: "Primitives/colour/blue/500", mode: "Light" },
      { from: "Semantic/action/primary", to: "Primitives/colour/blue/700", mode: "Dark" },
      // Same variable name in two collections, one aliasing the other. Before 2.0.0
      // both ends resolved to one path and the edge vanished without a trace.
      { from: "Semantic/space/md", to: "Primitives/space/md", mode: "Light" },
      { from: "Semantic/space/md", to: "Primitives/space/md", mode: "Dark" },
    ],
  },
});

// Step 4. The second id is the raw owning-file form, "S:<key>," — the builder cuts both
// these and the walk's ids back to the key before comparing anything.
c("styles.json", [
  { id: "S:body", name: "Body/Base" },
  { id: "S:h1,", name: "Heading/Level 1" },
]);

console.log("fixture written to", root);
