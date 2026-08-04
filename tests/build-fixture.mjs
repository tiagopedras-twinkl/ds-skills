import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "./.tmp/ds-snapshots/2026-08-03";
mkdirSync(join(root, "tokens"), { recursive: true });
const S = "https://www.designtokens.org/schemas/2025.10/format.json";
const w = (p, o) => writeFileSync(join(root, p), JSON.stringify(o, null, 2) + "\n");
const ext = (figmaName, figmaType) => ({ "io.github.tiagopedras-twinkl.ds-snapshot": { figmaName, figmaType } });

const colour = (components, hex, figmaName) => ({
  $value: { colorSpace: "srgb", components, alpha: 1, hex },
  $extensions: ext(figmaName, "COLOR"),
});

const primitives = {
  $schema: S,
  colour: {
    $type: "color",
    blue: {
      "500": colour([0, 0.4, 0.8], "#0066cc", "colour/blue/500"),
      "700": colour([0, 0.2667, 0.6], "#004499", "colour/blue/700"),
    },
  },
  space: {
    $type: "dimension",
    md: { $value: { value: 16, unit: "px" }, $extensions: ext("space/md", "FLOAT") },
    sm: { $value: { value: 8, unit: "px" }, $extensions: ext("space/sm", "FLOAT") },
  },
};

const semantic = {
  $schema: S,
  action: {
    $type: "color",
    primary: { $value: "{colour.blue.500}", $extensions: ext("action/primary", "COLOR") },
  },
  layout: {
    gutter: { $type: "dimension", $value: { value: 16, unit: "px" }, $extensions: ext("layout/gutter", "FLOAT") },
  },
};

// tokens.json = default modes of both collections merged
const merged = {
  $schema: S,
  action: semantic.action,
  colour: primitives.colour,
  layout: semantic.layout,
  space: primitives.space,
};

w("tokens.json", merged);
w("tokens/primitives.value.json", primitives);
w("tokens/semantic.light.json", semantic);
w("tokens/semantic.dark.json", {
  $schema: S,
  action: {
    $type: "color",
    primary: { $value: "{colour.blue.700}", $extensions: ext("action/primary", "COLOR") },
  },
  layout: semantic.layout,
});

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
  schemaVersion: "1.1.0",
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
// resolved binding, a typography link, a nest inside the inventory, a nest that
// was never walked, and a binding to a variable the snapshot does not hold.
w("dependencies.json", {
  schemaVersion: "1.1.0",
  aliases: [
    { from: "action.primary", to: "colour.blue.700", mode: "Dark" },
    { from: "action.primary", to: "colour.blue.500", mode: "Light" },
  ],
  components: [
    {
      id: "actions/button",
      bindings: [
        { token: "action.primary", properties: ["fills"] },
        { token: "space.sm", properties: ["itemSpacing", "paddingLeft"] },
      ],
      typography: ["body.base"],
      nests: [],
      nestsUncaptured: [{ name: "ArrowRight", count: 6 }],
      unresolvedBindings: [{ figmaName: "Legacy/icon-tint", properties: ["fills"] }],
    },
    {
      id: "layout/card",
      bindings: [{ token: "layout.gutter", properties: ["itemSpacing"] }],
      typography: ["heading.level-1"],
      nests: [{ id: "actions/button", count: 2 }],
      nestsUncaptured: [],
      unresolvedBindings: [],
    },
  ],
});

w("manifest.json", {
  schemaVersion: "1.1.0",
  generator: { skill: "ds-snapshot", skillVersion: "1.1.0" },
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
    { id: "semantic", name: "Semantic", defaultMode: "Light", modes: ["Dark", "Light"], variableCount: 2 },
  ],
  files: [
    { path: "components.json", kind: "components" },
    { path: "dependencies.json", kind: "dependencies" },
    { path: "tokens.json", kind: "tokens-default" },
    { path: "tokens/primitives.value.json", kind: "tokens-mode", collection: "Primitives", mode: "Value" },
    { path: "tokens/semantic.dark.json", kind: "tokens-mode", collection: "Semantic", mode: "Dark" },
    { path: "tokens/semantic.light.json", kind: "tokens-mode", collection: "Semantic", mode: "Light" },
    { path: "typography.json", kind: "typography" },
  ],
  counts: { variables: 6, typographyStyles: 2, components: 1, componentSets: 2 },
  dependencies: {
    captured: true,
    sources: [
      { figmaFileName: "Design System Library", figmaFileKey: "", componentsWalked: 2 },
      { figmaFileName: "Product Components", figmaFileKey: "", componentsWalked: 1 },
    ],
    counts: {
      bindings: 3,
      aliases: 2,
      nests: 1,
      nestsUncaptured: 1,
      typographyLinks: 2,
      unresolvedBindings: 1,
    },
  },
  notes: { nonStandardTypes: [], unmapped: [] },
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

// Step 2 again, for a second Figma file, unwrapped.
c("walk-product.json", {
  fileName: "Product Components",
  components: [
    {
      figmaName: "Layout/Card",
      page: "Cards",
      type: "COMPONENT_SET",
      bindings: [["Semantic/layout/gutter", ["itemSpacing"]]],
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
