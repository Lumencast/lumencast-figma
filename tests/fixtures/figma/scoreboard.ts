// Scoreboard scene fixture — exercises text bindings, OperatorInput
// extraction, image fill assets, multi-fill shape, auto-layout stacks, and a
// nested static frame.

import { equipTree, type MockSceneNode } from "./mock";

export interface ScoreboardFixture {
  root: MockSceneNode;
  /** Pre-registered image bytes to expose via figma.getImageByHash. */
  images: { hash: string; bytes: Uint8Array; mimeType: string }[];
}

const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // header
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52, // tiny IHDR
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0a,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0d,
  0x0a,
  0x2d,
  0xb4,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e,
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
]);

export function buildScoreboardFixture(): ScoreboardFixture {
  const root = equipTree({
    type: "FRAME",
    id: "1:1",
    name: "Scoreboard",
    width: 1920,
    height: 1080,
    fills: [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.1 } }],
    children: [
      // Header strip — auto-layout horizontal between team logos and score.
      {
        type: "FRAME",
        id: "2:1",
        name: "Header",
        width: 1920,
        height: 200,
        x: 0,
        y: 0,
        layoutMode: "HORIZONTAL",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "CENTER",
        itemSpacing: 24,
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 16,
        paddingBottom: 16,
        children: [
          // Team A logo (image fill).
          {
            type: "RECTANGLE",
            id: "3:1",
            name: "Team A logo",
            width: 120,
            height: 120,
            fills: [{ type: "IMAGE", imageHash: "team-a", scaleMode: "FIT" }],
          } as MockSceneNode,
          // Score (text, bound to leaf).
          {
            type: "TEXT",
            id: "3:2",
            name: "[bind:match.score] Score",
            characters: "0 - 0",
            width: 240,
            height: 80,
            fontSize: 64,
            fontWeight: 700,
            fontName: { family: "Inter", style: "Bold" },
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            textAlignHorizontal: "CENTER",
          } as MockSceneNode,
          // Team B logo (image fill).
          {
            type: "RECTANGLE",
            id: "3:3",
            name: "Team B logo",
            width: 120,
            height: 120,
            fills: [{ type: "IMAGE", imageHash: "team-b", scaleMode: "FIT" }],
          } as MockSceneNode,
        ],
      } as MockSceneNode,
      // Title — static text (no bind), so the mapper plants a literal under
      // defaults.__lit.text.<id>.
      {
        type: "TEXT",
        id: "2:2",
        name: "Match title",
        characters: "Friendly match",
        width: 1920,
        height: 80,
        x: 0,
        y: 220,
        fontSize: 36,
        fontWeight: 400,
        fontName: { family: "Inter", style: "Regular" },
        fills: [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } }],
        textAlignHorizontal: "CENTER",
      } as MockSceneNode,
      // Decorative card with multi-fill — exercises 1.1+ fills[].
      {
        type: "RECTANGLE",
        id: "2:3",
        name: "Stat panel",
        width: 800,
        height: 400,
        x: 560,
        y: 320,
        cornerRadius: 24,
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientStops: [
              { position: 0, color: { r: 1, g: 0.5, b: 0, a: 1 } },
              { position: 1, color: { r: 1, g: 0.1, b: 0.3, a: 1 } },
            ],
            gradientTransform: [
              [0, 1, 0],
              [-1, 0, 1],
            ],
          },
          { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.15 },
        ],
      } as MockSceneNode,
      // OperatorInput component — declares an editable show title leaf.
      {
        type: "COMPONENT",
        id: "2:4",
        name: "OperatorInput",
        width: 0,
        height: 0,
        x: -1000,
        y: -1000,
        children: [],
        pluginData: {
          "operator_input.path": "__inputs.show_title",
          "operator_input.type": "string",
          "operator_input.label": "Show title",
          "operator_input.constraints": '{"maxLength":80}',
        },
      } as MockSceneNode,
    ],
  } as MockSceneNode);

  return {
    root,
    images: [
      { hash: "team-a", bytes: PNG_BYTES, mimeType: "image/png" },
      { hash: "team-b", bytes: PNG_BYTES.slice().fill(0xab, 8, 12), mimeType: "image/png" },
    ],
  };
}
