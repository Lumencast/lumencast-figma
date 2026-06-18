// Unit: structural-diff checker (ADR ZabCanvas 002 RC2). Mock-only — no Figma
// call. Pins each divergence kind and proves a faithful tree reports clean.

import { describe, it, expect } from "vitest";
import {
  structuralDiff,
  summarizeDiff,
  type LsmlNode,
} from "../../../src/import-rest/structural-diff";
import type { RestNode } from "../../../src/import-rest/types";

function box(x: number, y: number, w: number, h: number) {
  return { x, y, width: w, height: h };
}

describe("structuralDiff", () => {
  it("reports zero divergences for a faithful tree (absolute children)", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        { id: "0:2", name: "A", type: "RECTANGLE", absoluteBoundingBox: box(10, 20, 30, 40) },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 100, h: 100 },
      children: [{ kind: "shape", size: { w: 30, h: 40 }, position: { x: 10, y: 20 } }],
    };
    expect(structuralDiff(rest, lsml)).toEqual([]);
  });

  it("flags a position mismatch beyond tolerance", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [{ id: "0:2", name: "A", type: "RECTANGLE", absoluteBoundingBox: box(5, 5, 2, 2) }],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 2, h: 2 }, position: { x: 9, y: 5 } }],
    };
    const divs = structuralDiff(rest, lsml);
    expect(divs.map((d) => d.kind)).toContain("position");
  });

  it("accumulates the origin through a GROUP (relative children), not a FRAME", () => {
    // The GROUP's child stores a parent-relative position in LSML; the checker
    // must add the group origin back to compare against the REST absolute box.
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 200),
      children: [
        {
          id: "0:2",
          name: "G",
          type: "GROUP",
          absoluteBoundingBox: box(50, 50, 100, 100),
          children: [
            { id: "0:3", name: "C", type: "RECTANGLE", absoluteBoundingBox: box(60, 70, 10, 10) },
          ],
        },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 200, h: 200 },
      children: [
        {
          kind: "frame",
          size: { w: 100, h: 100 },
          position: { x: 50, y: 50 },
          // Child is RELATIVE to the group origin (60-50, 70-50).
          children: [{ kind: "shape", size: { w: 10, h: 10 }, position: { x: 10, y: 20 } }],
        },
      ],
    };
    expect(structuralDiff(rest, lsml)).toEqual([]);
  });

  it("flags a hidden REST node whose LSML counterpart is visible", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "A",
          type: "RECTANGLE",
          visible: false,
          absoluteBoundingBox: box(0, 0, 5, 5),
        },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 5, h: 5 } }],
    };
    expect(structuralDiff(rest, lsml).map((d) => d.kind)).toContain("visibility");
  });

  it("flags a consumed image-mask whose `mask` is missing on the follower", () => {
    // isMask + IMAGE fill → consumed (no LSML slot). The follower must carry a
    // mask. Here it doesn't → one `mask` divergence, no index cascade.
    const rest: RestNode = {
      id: "0:1",
      name: "G",
      type: "GROUP",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "Mask",
          type: "RECTANGLE",
          isMask: true,
          fills: [{ type: "IMAGE", imageRef: "h" }],
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
        { id: "0:3", name: "Subject", type: "RECTANGLE", absoluteBoundingBox: box(0, 0, 10, 10) },
      ],
    };
    // Consumed: only ONE LSML child (the subject), no mask attached.
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 10, h: 10 } }],
    };
    const divs = structuralDiff(rest, lsml);
    expect(summarizeDiff(divs)).toEqual({ mask: 1 });
    expect(divs[0]!.figmaId).toBe("0:3");
  });

  it("passes a consumed image-mask whose follower DOES carry the mask", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "G",
      type: "GROUP",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "Mask",
          type: "RECTANGLE",
          isMask: true,
          fills: [{ type: "IMAGE", imageRef: "h" }],
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
        { id: "0:3", name: "Subject", type: "RECTANGLE", absoluteBoundingBox: box(0, 0, 10, 10) },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 10, h: 10 }, mask: { source: { kind: "image" } } }],
    };
    expect(structuralDiff(rest, lsml)).toEqual([]);
  });

  it("flags a dropped image fill (REST IMAGE paint → non-image LSML)", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "Img",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "h" }],
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 10, h: 10 }, fills: [{ kind: "solid" }] }],
    };
    expect(structuralDiff(rest, lsml).map((d) => d.kind)).toContain("image-fill");
  });

  it("accepts an IMAGE paint represented as an `image` primitive (not a defect)", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "Img",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "h" }],
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "image", size: { w: 10, h: 10 } }],
    };
    expect(structuralDiff(rest, lsml)).toEqual([]);
  });

  it("resolves text via the bundle defaults map", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        {
          id: "0:2",
          name: "T",
          type: "TEXT",
          characters: "HELLO",
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const lsml: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "text", size: { w: 10, h: 10 }, bind: { value: "__lit.t" } }],
    };
    expect(structuralDiff(rest, lsml, { defaults: { "__lit.t": "HELLO" } })).toEqual([]);
    expect(
      structuralDiff(rest, lsml, { defaults: { "__lit.t": "WRONG" } }).map((d) => d.kind),
    ).toContain("text");
  });

  it("flags a missing node and an extra node", () => {
    const rest: RestNode = {
      id: "0:1",
      name: "F",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 10, 10),
      children: [
        { id: "0:2", name: "A", type: "RECTANGLE", absoluteBoundingBox: box(0, 0, 5, 5) },
        { id: "0:3", name: "B", type: "RECTANGLE", absoluteBoundingBox: box(5, 5, 5, 5) },
      ],
    };
    const missing: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [{ kind: "shape", size: { w: 5, h: 5 } }],
    };
    expect(structuralDiff(rest, missing).map((d) => d.kind)).toContain("missing");

    const extra: LsmlNode = {
      kind: "frame",
      size: { w: 10, h: 10 },
      children: [
        { kind: "shape", size: { w: 5, h: 5 } },
        { kind: "shape", size: { w: 5, h: 5 }, position: { x: 5, y: 5 } },
        { kind: "shape", size: { w: 1, h: 1 }, position: { x: 9, y: 9 } },
      ],
    };
    expect(structuralDiff(rest, extra).map((d) => d.kind)).toContain("extra");
  });
});
