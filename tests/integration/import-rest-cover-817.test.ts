// REST import → genuine LSML 1.2 bundle for the cover `817:3` (mock-only).
//
// Proves the import-rest pipeline (ADR ZabCanvas 002 §3.3, RC1/RC2) WITHOUT a
// live Figma call: a stub `FigmaRestClient` serves the representative REST
// response + real bytes, and `importFigmaFrame` runs the unchanged export
// pipeline. We assert:
//   - the absolute structure (positions x/y, sizes w/h, hierarchy) is preserved
//     — the core of the structural-diff=0 invariant (RC2),
//   - a hidden node lowers to visible:false (present, not dropped),
//   - the promoted families (blend / image-fill / gradient / vector path) land
//     in their 1.2 constructions,
//   - the real image bytes are resolved through the gated asset path (the
//     emitted image-fill `src` is a data: URI built from the served bytes).

import { describe, it, expect } from "vitest";
import { importFigmaFrame } from "../../src/import-rest";
import type { FigmaRestClient } from "../../src/import-rest/client";
import {
  FAKE_PNG,
  FILE_KEY,
  NODE_ID,
  coverRestRoot,
  imagesResponse,
} from "../fixtures/import-rest/cover-817-rest";

function stubClient(): FigmaRestClient {
  const images = imagesResponse().meta!.images;
  return {
    getNode: async () => coverRestRoot,
    getImageFills: async () => images,
    getImageBytes: async () => FAKE_PNG,
  };
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  const obj = node as Record<string, unknown>;
  yield obj;
  for (const v of Object.values(obj)) if (v && typeof v === "object") yield* walk(v);
}

/** Find the first emitted primitive whose original Figma layer name matches.
 *  The mapper stamps the source name in `metadata.figma.layerName`. */
function findByLayerName(layout: unknown, name: string): Record<string, unknown> | undefined {
  for (const node of walk(layout)) {
    const meta = node["metadata"] as Record<string, unknown> | undefined;
    const figma = meta?.["figma"] as Record<string, unknown> | undefined;
    if (figma?.["layerName"] === name || node["name"] === name) return node;
  }
  return undefined;
}

describe("import-rest cover 817:3 — genuine bundle (mock-only)", () => {
  it("produces an LSML 1.2 bundle with the absolute structure preserved (RC2)", async () => {
    const { bundle, adaptedRoot } = await importFigmaFrame(FILE_KEY, NODE_ID, {
      client: stubClient(),
    });

    expect(bundle.lsml).toBe("1.2");

    // The adapter preserves absolute positions/sizes verbatim from the REST
    // absoluteBoundingBox — this IS the structural-diff=0 source of truth.
    expect({
      x: adaptedRoot.x,
      y: adaptedRoot.y,
      width: adaptedRoot.width,
      height: adaptedRoot.height,
    }).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });

    const ruby = adaptedRoot.children!.find((c) => c.id === "817:84")!;
    expect({ x: ruby.x, y: ruby.y, width: ruby.width, height: ruby.height }).toEqual({
      x: -46,
      y: -30,
      width: 2542,
      height: 1424,
    });

    // Hierarchy depth is preserved: the mask group keeps its two children.
    const group = adaptedRoot.children!.find((c) => c.id === "817:1991")!;
    expect(group.children!.map((c) => c.id)).toEqual(["817:1993", "817:1994"]);
  });

  it("lowers a hidden REST node to visible:false (present, not dropped)", async () => {
    const { bundle, adaptedRoot } = await importFigmaFrame(FILE_KEY, NODE_ID, {
      client: stubClient(),
    });
    const hidden = adaptedRoot.children!.find((c) => c.id === "817:85")!;
    expect(hidden.visible).toBe(false);

    // It survives into the emitted bundle as a non-visible primitive.
    const emitted = findByLayerName(bundle.layout, "Ruby20-06 1");
    expect(emitted).toBeDefined();
    expect(emitted!["visible"]).toBe(false);
    // And no other node accidentally inherited visible:false.
    let hiddenCount = 0;
    for (const node of walk(bundle.layout)) if (node["visible"] === false) hiddenCount++;
    expect(hiddenCount).toBe(1);
  });

  it("transcribes the promoted families (blend / image-fill / gradient / path)", async () => {
    const { bundle } = await importFigmaFrame(FILE_KEY, NODE_ID, { client: stubClient() });
    let blend = 0;
    let imageFill = 0;
    let gradientFill = 0;
    let vectorPath = 0;
    for (const node of walk(bundle.layout)) {
      if (typeof node["blendMode"] === "string") blend++;
      const fills = node["fills"];
      if (Array.isArray(fills)) {
        for (const f of fills as Record<string, unknown>[]) {
          if (f["kind"] === "image") imageFill++;
          if (String(f["kind"]).endsWith("-gradient")) gradientFill++;
        }
      }
      if (node["kind"] === "shape" && node["geometry"] === "path") vectorPath++;
    }
    expect(blend).toBeGreaterThanOrEqual(2); // Ruby20 + Wavy
    expect(imageFill).toBeGreaterThanOrEqual(1);
    expect(gradientFill).toBe(1);
    expect(vectorPath).toBeGreaterThanOrEqual(1);
  });

  it("resolves real image bytes through the gated asset path (data: URI src)", async () => {
    const { bundle } = await importFigmaFrame(FILE_KEY, NODE_ID, { client: stubClient() });
    let dataUriFills = 0;
    for (const node of walk(bundle.layout)) {
      const fills = node["fills"];
      if (!Array.isArray(fills)) continue;
      for (const f of fills as Record<string, unknown>[]) {
        if (f["kind"] === "image" && typeof f["src"] === "string") {
          // The src is the data: URI the registry's finalize() built from the
          // bytes the stub served — i.e. the real-bytes path, raster-gated.
          expect(String(f["src"])).toMatch(/^data:image\/png;base64,/);
          dataUriFills++;
        }
      }
    }
    expect(dataUriFills).toBeGreaterThanOrEqual(1);
  });
});
