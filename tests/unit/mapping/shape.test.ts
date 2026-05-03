import { describe, it, expect } from "vitest";
import { mapShape } from "../../../src/mapping/shape";

describe("mapShape", () => {
  it("maps RECTANGLE with one solid fill to legacy `fill` field", () => {
    const r = mapShape({
      type: "RECTANGLE",
      id: "2:1",
      name: "Box",
      width: 100,
      height: 50,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });
    expect(r.node).toMatchObject({
      kind: "shape",
      geometry: "rect",
      size: { w: 100, h: 50 },
      fill: "#ff0000",
    });
    expect((r.node as { fills?: unknown[] }).fills).toBeUndefined();
  });

  it("maps a multi-fill shape to LSML 1.1 `fills[]`", () => {
    const r = mapShape({
      type: "RECTANGLE",
      id: "2:2",
      name: "Box",
      width: 200,
      height: 50,
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientTransform: [
            [0, 1, 0],
            [-1, 0, 1],
          ],
        },
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.2 },
      ],
    });
    const fills = (r.node as { fills: { kind: string }[] }).fills;
    expect(fills).toHaveLength(2);
    expect(fills[0]?.kind).toBe("linear-gradient");
    expect(fills[1]).toMatchObject({ kind: "solid", color: "#000000", opacity: 0.2 });
  });

  it("maps ELLIPSE → geometry=circle", () => {
    const r = mapShape({
      type: "ELLIPSE",
      id: "2:3",
      name: "Dot",
      width: 24,
      height: 24,
      fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }],
    });
    expect((r.node as { geometry: string }).geometry).toBe("circle");
  });

  it("maps VECTOR with vectorPaths → geometry=path", () => {
    const r = mapShape({
      type: "VECTOR",
      id: "2:4",
      name: "Glyph",
      width: 40,
      height: 40,
      vectorPaths: [{ data: "M0 0 L40 0 L40 40 Z", windingRule: "NONZERO" }],
    });
    expect(r.node).toMatchObject({
      geometry: "path",
      pathData: "M0 0 L40 0 L40 40 Z",
    });
  });

  it("maps cornerRadius on rect", () => {
    const r = mapShape({
      type: "RECTANGLE",
      id: "2:5",
      name: "Card",
      width: 200,
      height: 100,
      cornerRadius: 12,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    });
    expect((r.node as { cornerRadius?: number }).cornerRadius).toBe(12);
  });

  it("maps a single stroke → `stroke`, multiple → `strokes[]`", () => {
    const single = mapShape({
      type: "RECTANGLE",
      id: "s:1",
      name: "x",
      width: 10,
      height: 10,
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
    });
    expect((single.node as { stroke?: { color: string; width: number } }).stroke).toEqual({
      color: "#000000",
      width: 2,
    });

    const multi = mapShape({
      type: "RECTANGLE",
      id: "s:2",
      name: "x",
      width: 10,
      height: 10,
      strokes: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 } },
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
      ],
      strokeWeight: 1,
    });
    expect((multi.node as { strokes: unknown[] }).strokes).toHaveLength(2);
  });
});
