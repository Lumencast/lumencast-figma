// End-to-end zero-loss proof for the cover `817:3` losses (ADR 002 §1.2 / #H).
//
// The Wellplayed cover stress-tests the four families that 1.1 dropped /
// degraded. This fixture reproduces each loss with the real Figma node shape
// (per `D:\Documents\.audit-lsml\figma-context.md`) and proves the mapper now
// TRANSCRIBES instead of dropping :
//   - blend hard-light          (817:84 Ruby20 / 817:1994 wavy)  → `blendMode`
//   - mask alpha intersect      (817:1991 Mask group, image mask) → `mask`
//   - image-fill object-cover   (817:1992/1994 image-in-shape)    → fills[image]
//   - WP gradient transform     (non-trivial affine matrix)        → fill.transform
// plus : every image `src` resolves to a host-less `data:image/*` URI, so the
// emitted `assets.allowedHosts` ([]) is coherent (Bastion T6), the bundle
// upgrades to `lsml: "1.2"`, and it validates against the canonical schema.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { runExport } from "../../src/export";
import { createMockFigma, type MockSceneNode } from "../fixtures/figma/mock";

const SCHEMA_PATH = resolve(__dirname, "../fixtures/lsml-schema.json");
const ADAPTER_NAMES = ["http_poll", "websocket_subscribe", "pg_listen", "webhook_receive", "cron"];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let validate: (b: unknown) => boolean;
let ajvErrors: () => string;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const name of ADAPTER_NAMES) {
    ajv.addSchema(
      JSON.parse(readFileSync(resolve(__dirname, `../fixtures/adapters/${name}.json`), "utf-8")),
    );
  }
  const v = ajv.compile(schema);
  validate = (b) => v(b) as boolean;
  ajvErrors = () => JSON.stringify(v.errors, null, 2);
});

/** A frame reproducing the four `817:3` losses. */
function buildCoverFixture(): MockSceneNode {
  return {
    type: "FRAME",
    id: "817:3",
    name: "Cover",
    width: 1920,
    height: 1080,
    children: [
      // 817:84 Ruby20 — image-in-rounded-rect with mix-blend-hard-light.
      // Routes to the image PRIMITIVE (RECTANGLE) ; the node-level blend is
      // promoted to a core `blendMode`.
      {
        type: "RECTANGLE",
        id: "817:84",
        name: "Ruby20",
        width: 400,
        height: 400,
        cornerRadius: 24,
        blendMode: "HARD_LIGHT",
        fills: [{ type: "IMAGE", imageHash: "ruby20", scaleMode: "FILL" }],
      } as MockSceneNode,
      // 817:1992 — a 3d render image INSIDE A VECTOR shape (object-cover).
      // This is the case 1.1 dropped at shape.ts:65 — now a 1.2 image-fill.
      {
        type: "VECTOR",
        id: "817:1992",
        name: "3d render",
        width: 300,
        height: 300,
        x: 500,
        y: 0,
        vectorPaths: [{ data: "M0 0 H300 V300 H0 Z", windingRule: "NONZERO" }],
        fills: [{ type: "IMAGE", imageHash: "render3d", scaleMode: "FILL" }],
      } as MockSceneNode,
      // WP Gradient — a brand gradient with a non-trivial affine matrix
      // (90° rotation + translation). 1.1 degraded this to angle_deg ; 1.2
      // emits the full `transform`.
      {
        type: "RECTANGLE",
        id: "817:200",
        name: "WP Gradient panel",
        width: 800,
        height: 200,
        x: 0,
        y: 500,
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradientStops: [
              { position: 0, color: { r: 1, g: 0.2, b: 0.4, a: 1 } },
              { position: 1, color: { r: 0.1, g: 0.1, b: 0.5, a: 1 } },
            ],
            gradientTransform: [
              [0, 1, 0],
              [-1, 0, 1],
            ],
          },
        ],
      } as MockSceneNode,
      // 817:1991 "Mask group" : an ellipse IMAGE mask (alpha, intersect)
      // followed by the content it masks. The mask node is consumed ; the
      // masked sibling gains a typed `mask`.
      {
        type: "GROUP",
        id: "817:1991",
        name: "Mask group",
        width: 500,
        height: 500,
        x: 1000,
        y: 0,
        children: [
          {
            type: "ELLIPSE",
            id: "817:1991:mask",
            name: "Ellipse mask",
            width: 500,
            height: 500,
            isMask: true,
            maskType: "ALPHA",
            fills: [{ type: "IMAGE", imageHash: "ellipse", scaleMode: "FILL" }],
          } as MockSceneNode,
          {
            type: "RECTANGLE",
            id: "817:1994",
            name: "Wavy shape",
            width: 500,
            height: 500,
            blendMode: "HARD_LIGHT",
            fills: [{ type: "IMAGE", imageHash: "wavy", scaleMode: "FILL" }],
          } as MockSceneNode,
        ],
      } as MockSceneNode,
    ],
  } as MockSceneNode;
}

async function exportCover() {
  const figma = createMockFigma();
  for (const hash of ["ruby20", "render3d", "ellipse", "wavy"]) {
    figma.__registerImage({ hash, bytes: PNG, mimeType: "image/png" });
  }
  return runExport({ api: figma, root: buildCoverFixture() as never, sceneId: "cover-817" });
}

describe("E2E : cover 817:3 — zero-loss transcription of the four 1.2 families", () => {
  it("upgrades to lsml 1.2 and validates against the canonical schema", async () => {
    const result = await exportCover();
    expect(result.bundle.lsml).toBe("1.2");
    expect(result.bundle.$schema).toBe("https://lumencast.dev/schema/lsml/1.2/schema.json");
    const ok = validate(result.bundle);
    if (!ok) throw new Error(`Bundle failed schema validation : ${ajvErrors()}`);
    expect(ok).toBe(true);
  });

  it("transcribes blend hard-light to a core `blendMode` (817:84 Ruby20)", async () => {
    const result = await exportCover();
    const json = JSON.stringify(result.bundle.layout);
    expect(json).toContain('"blendMode":"hard-light"');
    // No promoted family leaks back into metadata.figma.blendMode.
    expect(json).not.toContain('"figma":{"blendMode"');
  });

  it("transcribes the image-in-shape as a 1.2 image-fill, not a drop (817:1992)", async () => {
    const result = await exportCover();
    const layout = result.bundle.layout as { children: { id?: string; name?: string }[] };
    const vec = findByName(layout, "3d render") as { fills?: { kind: string }[] } | undefined;
    expect(vec?.fills?.[0]?.kind).toBe("image");
  });

  it("transcribes the WP gradient affine matrix to a core `transform`", async () => {
    const result = await exportCover();
    const panel = findByName(result.bundle.layout, "WP Gradient panel") as
      | { fills?: { kind: string; transform?: number[]; angle_deg?: number }[] }
      | undefined;
    const grad = panel?.fills?.[0];
    expect(grad?.kind).toBe("linear-gradient");
    expect(grad?.transform).toEqual([0, -1, 1, 0, 0, 1]);
    expect(grad?.angle_deg).toBeUndefined();
  });

  it("transcribes the image mask to a typed `mask` on the masked sibling (817:1991)", async () => {
    const result = await exportCover();
    const wavy = findByName(result.bundle.layout, "Wavy shape") as
      | { mask?: { source: { kind: string; src?: string }; type: string; op: string } }
      | undefined;
    expect(wavy?.mask).toMatchObject({
      source: { kind: "image" },
      type: "alpha",
      op: "intersect",
    });
    // The mask node itself was consumed (not painted as content).
    expect(findByName(result.bundle.layout, "Ellipse mask")).toBeUndefined();
  });

  it("emits host-less data:image src for every image-fill / mask source → allowedHosts [] is coherent (T6)", async () => {
    const result = await exportCover();
    expect(result.bundle.assets?.allowedHosts).toEqual([]);
    const json = JSON.stringify(result.bundle);
    // No image-fill / mask `src` references a remote host (every one is a
    // data: URI) ; no placeholder leaked unresolved.
    expect(json).not.toContain("__asset-data:");
    // Every emitted image-fill / mask src is a data:image/* URI.
    const srcs = collectFillAndMaskSrcs(result.bundle.layout);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps no promoted family stranded in metadata.figma.* (817:3 → 0 drop)", async () => {
    const result = await exportCover();
    const json = JSON.stringify(result.bundle.layout);
    // imageBackgrounds is the old drop channel for frame image fills — the
    // cover frame's image fills now live in core fills / image primitives,
    // so no imageBackgrounds entry is needed for the promoted nodes.
    expect(json).not.toContain('"isMask"');
  });
});

describe("Non-regression : a 1.1 design (no 1.2 family) is unchanged", () => {
  async function exportPlain() {
    const figma = createMockFigma();
    const root = {
      type: "FRAME",
      id: "f1",
      name: "Plain",
      width: 400,
      height: 200,
      children: [
        {
          type: "RECTANGLE",
          id: "f1:1",
          name: "Box",
          width: 100,
          height: 50,
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
        } as MockSceneNode,
        {
          type: "TEXT",
          id: "f1:2",
          name: "Label",
          characters: "Hi",
          width: 80,
          height: 24,
          x: 0,
          y: 60,
          fontSize: 16,
          fontName: { family: "Inter", style: "Regular" },
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
        } as MockSceneNode,
      ],
    } as MockSceneNode;
    return runExport({ api: figma, root: root as never, sceneId: "plain" });
  }

  it("stays lsml 1.1 with the 1.1 $schema and no 1.2 fields", async () => {
    const result = await exportPlain();
    expect(result.bundle.lsml).toBe("1.1");
    expect(result.bundle.$schema).toBe("https://lumencast.dev/schema/lsml/1.1/schema.json");
    expect(validate(result.bundle)).toBe(true);
    const json = JSON.stringify(result.bundle);
    expect(json).not.toContain('"blendMode"');
    expect(json).not.toContain('"mask"');
    expect(json).not.toContain('"transform"');
    expect(json).not.toContain('"kind":"image"');
    // No assets / image sources → no assets block forced.
    expect(result.bundle.assets).toBeUndefined();
  });
});

// ---- helpers ----

function findByName(node: unknown, name: string): unknown {
  if (node === null || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["name"] === name || obj["ariaLabel"] === name || obj["alt"] === name) return obj;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const child of v) {
        const found = findByName(child, name);
        if (found) return found;
      }
    } else if (v && typeof v === "object") {
      const found = findByName(v, name);
      if (found) return found;
    }
  }
  return undefined;
}

function collectFillAndMaskSrcs(node: unknown, acc: string[] = []): string[] {
  if (node === null || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const n of node) collectFillAndMaskSrcs(n, acc);
    return acc;
  }
  const obj = node as Record<string, unknown>;
  if (obj["kind"] === "image" && typeof obj["src"] === "string") acc.push(obj["src"]);
  const mask = obj["mask"] as { source?: { src?: unknown } } | undefined;
  if (mask?.source && typeof mask.source.src === "string") acc.push(mask.source.src);
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") collectFillAndMaskSrcs(v, acc);
  }
  return acc;
}
