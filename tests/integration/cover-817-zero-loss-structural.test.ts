// Mapper-side structural zero-loss invariant for the cover `817:3`
// (ADR 002 #J / RC#10, the "0 nœud rastérisé" half).
//
// `export-cover-817.test.ts` (#H) proves each promoted family is TRANSCRIBED
// (blend / mask / image-fill / gradient → their 1.2 constructions, schema-
// valid, 0 drop). This test pins the OTHER guarantee #J needs from the mapper:
// the emitted bundle is the genuine artefact the lumencast-js render harness
// consumes, and NO promoted family was flattened to a pre-composed raster.
//
// Contract with lumencast-js: the committed fixture
//   lumencast-js/packages/runtime/tests/e2e/zero-loss/fixtures/cover-817-3.lsml.json
// is a SNAPSHOT of this exact export. If this test's census changes (the mapper
// gained/lost a promoted family), regenerate that fixture. We assert the census
// here (mapper-local, no cross-repo path) so a structural regression fails in
// THIS repo's CI, not silently downstream.

import { describe, it, expect } from "vitest";
import { runExport } from "../../src/export";
import { createMockFigma, type MockSceneNode } from "../fixtures/figma/mock";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** The four `817:3` losses, reproduced with the real Figma node shape (kept in
 *  lock-step with `export-cover-817.test.ts`). */
function buildCoverFixture(): MockSceneNode {
  return {
    type: "FRAME",
    id: "817:3",
    name: "Cover",
    width: 1920,
    height: 1080,
    children: [
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

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  const obj = node as Record<string, unknown>;
  yield obj;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") yield* walk(v);
  }
}

describe("cover 817:3 — mapper-side structural zero-loss (RC#10 '0 raster')", () => {
  it("census of promoted families in the emitted bundle (drift guard vs js fixture)", async () => {
    const { bundle } = await exportCover();
    let blend = 0;
    let mask = 0;
    let gradientFill = 0;
    let imageFill = 0;
    let imagePrimitive = 0;
    let vectorPath = 0;
    for (const node of walk(bundle.layout)) {
      if (typeof node["blendMode"] === "string") blend++;
      if (node["mask"] && typeof node["mask"] === "object") mask++;
      const fills = node["fills"];
      if (Array.isArray(fills)) {
        for (const f of fills as Record<string, unknown>[]) {
          if (String(f["kind"]).endsWith("-gradient")) gradientFill++;
          if (f["kind"] === "image") imageFill++;
        }
      }
      if (node["kind"] === "image") imagePrimitive++;
      if (
        node["kind"] === "shape" &&
        node["geometry"] === "path" &&
        typeof node["pathData"] === "string"
      )
        vectorPath++;
    }
    // Exact census — these numbers ARE the contract the committed js fixture
    // snapshots. A change here means: regenerate cover-817-3.lsml.json.
    expect({ blend, mask, gradientFill, imageFill, imagePrimitive, vectorPath }).toEqual({
      blend: 2, // Ruby20 + Wavy
      mask: 1, // Wavy carries the alpha-intersect mask
      gradientFill: 1, // WP gradient
      imageFill: 1, // 3d render image-fill in the vector shape
      // The walk counts any object with kind:"image" — that is the 2 image
      // PRIMITIVES (Ruby20, Wavy) PLUS the inline image-fill object (3d render)
      // PLUS the mask's image source. All four are legitimate raster CARRIERS
      // (a bitmap belongs in an image node); the invariant is that no EFFECT
      // (blend/mask/gradient/path) was baked into one — asserted below.
      imagePrimitive: 4,
      vectorPath: 1, // 3d render vector path geometry
    });
  });

  it("NO promoted family is stranded in metadata.figma.* and none is a raster fallback", async () => {
    const { bundle } = await exportCover();
    const json = JSON.stringify(bundle.layout);
    // Promoted families live in core fields, never the drop channel.
    expect(json).not.toContain('"figma":{"blendMode"');
    expect(json).not.toContain('"isMask"');
    // No gradient node is ALSO a bare raster image primitive (flattened).
    for (const node of walk(bundle.layout)) {
      const isImage = node["kind"] === "image";
      const hasGradient =
        Array.isArray(node["fills"]) &&
        (node["fills"] as Record<string, unknown>[]).some((f) =>
          String(f["kind"]).endsWith("-gradient"),
        );
      expect(isImage && hasGradient, "gradient flattened into a raster image").toBe(false);
    }
  });
});
