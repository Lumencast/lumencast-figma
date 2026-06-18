// Unit: REST → mapper-surface adapter. Pins the field-by-field normalization
// the structural-diff=0 invariant depends on (ADR ZabCanvas 002 RC2).

import { describe, it, expect } from "vitest";
import { adaptNode, createRestImageSurface } from "../../../src/import-rest/adapter";
import type { FigmaRestClient } from "../../../src/import-rest/client";
import type { RestNode } from "../../../src/import-rest/types";

describe("adaptNode — structural normalization", () => {
  it("hoists absoluteBoundingBox into x/y/width/height verbatim", () => {
    const node: RestNode = {
      id: "1:1",
      name: "Box",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: -46, y: -30.5, width: 2542, height: 1424 },
    };
    const out = adaptNode(node);
    expect({ x: out.x, y: out.y, width: out.width, height: out.height }).toEqual({
      x: -46,
      y: -30.5,
      width: 2542,
      height: 1424,
    });
  });

  it("preserves hierarchy and order exactly", () => {
    const node: RestNode = {
      id: "f",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      children: [
        { id: "a", name: "A", type: "RECTANGLE" },
        {
          id: "b",
          name: "B",
          type: "GROUP",
          children: [{ id: "c", name: "C", type: "RECTANGLE" }],
        },
      ],
    };
    const out = adaptNode(node);
    expect(out.children!.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out.children![1]!.children!.map((c) => c.id)).toEqual(["c"]);
  });

  it("carries visible:false through, omits visible when absent (defaults true)", () => {
    const hidden = adaptNode({ id: "h", name: "H", type: "RECTANGLE", visible: false });
    expect(hidden.visible).toBe(false);
    const shown = adaptNode({ id: "s", name: "S", type: "RECTANGLE" });
    expect(shown.visible).toBeUndefined();
  });

  it("rewrites imageRef → imageHash so the gated registry path fires", () => {
    const out = adaptNode({
      id: "i",
      name: "Img",
      type: "RECTANGLE",
      fills: [{ type: "IMAGE", imageRef: "abc123", scaleMode: "FILL" }],
    });
    expect(out.fills![0]!.imageHash).toBe("abc123");
    expect(out.fills![0]!.scaleMode).toBe("FILL");
  });

  it("converts gradient handle positions to a 2×3 affine matrix", () => {
    const out = adaptNode({
      id: "g",
      name: "G",
      type: "RECTANGLE",
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientHandlePositions: [
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 }, // main axis: +0.5 x
            { x: 0.25, y: 1.0 }, // cross axis: +0.5 y
          ],
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        },
      ],
    });
    // column0 = P1−P0 = (0.5, 0), column1 = P2−P0 = (0, 0.5), translate = P0.
    // Row-major [[a,c,e],[b,d,f]].
    expect(out.fills![0]!.gradientTransform).toEqual([
      [0.5, 0, 0.25],
      [0, 0.5, 0.5],
    ]);
  });

  it("renames fillGeometry path → data (mapper field)", () => {
    const out = adaptNode({
      id: "v",
      name: "V",
      type: "VECTOR",
      fillGeometry: [{ path: "M0 0 H10 Z", windingRule: "NONZERO" }],
    });
    expect(out.fillGeometry![0]).toEqual({ data: "M0 0 H10 Z", windingRule: "NONZERO" });
  });

  it("supplies a no-op getSharedPluginData (REST carries no plugin data)", () => {
    const out = adaptNode({ id: "x", name: "X", type: "RECTANGLE" });
    expect(out.getSharedPluginData!("lumencast", "anything")).toBe("");
  });
});

describe("createRestImageSurface", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  function client(): FigmaRestClient {
    let calls = 0;
    return {
      getNode: async () => ({ id: "x", name: "x", type: "FRAME" }),
      getImageFills: async () => ({}),
      getImageBytes: async () => {
        calls++;
        // expose the count through the bytes length sentinel isn't needed —
        // we assert caching via identity of the returned promise below.
        return new Uint8Array([calls]);
      },
    };
  }

  it("returns null for a hash absent from the image map (fill omitted downstream)", () => {
    const surface = createRestImageSurface(client(), {});
    expect(surface.getImageByHash("missing")).toBeNull();
  });

  it("resolves bytes via the client for a mapped hash", async () => {
    const c: FigmaRestClient = {
      getNode: async () => ({ id: "x", name: "x", type: "FRAME" }),
      getImageFills: async () => ({}),
      getImageBytes: async () => bytes,
    };
    const surface = createRestImageSurface(c, {
      h1: "https://s3-alpha-sig.figma.com/img/a.png",
    });
    const handle = surface.getImageByHash("h1")!;
    expect(handle.hash).toBe("h1");
    expect(await handle.getBytesAsync()).toEqual(bytes);
  });

  it("caches the download per hash (one fetch for repeated references)", async () => {
    let calls = 0;
    const c: FigmaRestClient = {
      getNode: async () => ({ id: "x", name: "x", type: "FRAME" }),
      getImageFills: async () => ({}),
      getImageBytes: async () => {
        calls++;
        return bytes;
      },
    };
    const surface = createRestImageSurface(c, {
      h1: "https://s3-alpha-sig.figma.com/img/a.png",
    });
    await surface.getImageByHash("h1")!.getBytesAsync();
    await surface.getImageByHash("h1")!.getBytesAsync();
    expect(calls).toBe(1);
  });
});
