// Dashboard scene fixture — exercises the full Phase 2 surface :
//   - instance primitive (LSML §4.9, 1.1+) via plugin data
//   - Figma color variable bound on a shape fill → tokens.* binding
//   - Figma color variable bound on the root frame background
//   - Multi-fill gradient on a shape (LSML §4.6 + §4.12, 1.1+)
//   - Auto-layout stack with wrap + crossGap (LSML §4.1, 1.1+)
//   - Universal props (visible / opacity / rotation, §5.4)

import { equipTree, type MockSceneNode } from "./mock";
import type { VariableResolverApi, FigmaVariable } from "../../../src/mapping/variables";

const VALID_VERSION = `sha256:${"f".repeat(64)}`;

export interface DashboardFixture {
  root: MockSceneNode;
  variables: VariableResolverApi;
}

export function buildDashboardFixture(): DashboardFixture {
  const variables: Record<string, FigmaVariable> = {
    "v:bg": {
      id: "v:bg",
      name: "Background",
      variableCollectionId: "c:theme",
      resolvedType: "COLOR",
    },
    "v:accent": {
      id: "v:accent",
      name: "Accent",
      variableCollectionId: "c:theme",
      resolvedType: "COLOR",
    },
  };
  const collections = { "c:theme": { id: "c:theme", name: "Theme" } };
  const values: Record<string, string | number> = {
    "v:bg": "#0d0d1a",
    "v:accent": "#3366ff",
  };

  const resolver: VariableResolverApi = {
    getVariableById: (id) => variables[id] ?? null,
    getVariableCollectionById: (id) =>
      (collections as Record<string, { id: string; name: string }>)[id] ?? null,
    resolveValue: (v) => values[v.id] ?? null,
  };

  const root = equipTree({
    type: "FRAME",
    id: "1:1",
    name: "Dashboard",
    width: 1920,
    height: 1080,
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], // overridden by var
    fillBoundVariables: [{ color: { id: "v:bg" } }],
    children: [
      // Auto-layout stack with wrap (1.1+ feature) + crossGap.
      {
        type: "FRAME",
        id: "2:1",
        name: "Tags",
        width: 800,
        height: 200,
        x: 0,
        y: 0,
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
        itemSpacing: 8,
        counterAxisSpacing: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "CENTER",
        children: [
          {
            type: "RECTANGLE",
            id: "3:1",
            name: "Pill",
            width: 80,
            height: 32,
            cornerRadius: 16,
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            fillBoundVariables: [{ color: { id: "v:accent" } }],
            opacity: 0.9,
          },
          {
            type: "RECTANGLE",
            id: "3:2",
            name: "Pill",
            width: 80,
            height: 32,
            cornerRadius: 16,
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            fillBoundVariables: [{ color: { id: "v:accent" } }],
          },
        ],
      } as MockSceneNode,
      // Multi-fill gradient shape with universal `rotation` (§5.4).
      {
        type: "RECTANGLE",
        id: "2:2",
        name: "Hero",
        width: 1600,
        height: 600,
        x: 160,
        y: 240,
        cornerRadius: 32,
        rotation: 2,
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientStops: [
              { position: 0, color: { r: 0.2, g: 0.3, b: 1, a: 1 } },
              { position: 1, color: { r: 1, g: 0.2, b: 0.5, a: 1 } },
            ],
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
          { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.1 },
        ],
      } as MockSceneNode,
      // Instance primitive — pulls in a separate scoreboard scene.
      {
        type: "INSTANCE",
        id: "2:3",
        name: "Scoreboard slot",
        width: 800,
        height: 240,
        x: 560,
        y: 880,
        children: [],
        mainComponent: {
          type: "COMPONENT",
          id: "main",
          name: "Card",
          width: 800,
          height: 240,
          children: [],
        },
        pluginData: {
          "instance.scene_id": "scoreboard-template",
          "instance.scene_version": VALID_VERSION,
          "instance.params": '{"team_a":"Alpha","team_b":"Beta","score_a":14,"score_b":12}',
          "instance.fit": "contain",
        },
      } as MockSceneNode,
    ],
  } as MockSceneNode);

  return { root, variables: resolver };
}
