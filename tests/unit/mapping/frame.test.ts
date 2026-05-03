import { describe, it, expect } from "vitest";
import { mapFrame } from "../../../src/mapping/frame";

describe("mapFrame", () => {
  it("emits size + skips position for the root", () => {
    const r = mapFrame(
      {
        type: "FRAME",
        id: "f:0",
        name: "Root",
        width: 1920,
        height: 1080,
      },
      { isRoot: true },
      [],
    );
    expect(r.node).toMatchObject({
      kind: "frame",
      size: { w: 1920, h: 1080 },
      children: [],
    });
    expect((r.node as { position?: unknown }).position).toBeUndefined();
  });

  it("emits position for nested frames relative to parent", () => {
    const r = mapFrame(
      {
        type: "FRAME",
        id: "f:1",
        name: "Card",
        width: 200,
        height: 100,
        x: 50,
        y: 30,
      },
      { isRoot: false, parentX: 10, parentY: 5 },
      [],
    );
    expect(r.node).toMatchObject({
      size: { w: 200, h: 100 },
      position: { x: 40, y: 25 },
    });
  });

  it("uses single solid `background` and 1.1+ `backgrounds[]` for multi-fill", () => {
    const single = mapFrame(
      {
        type: "FRAME",
        id: "f:2",
        name: "Solid",
        width: 100,
        height: 50,
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      },
      { isRoot: true },
      [],
    );
    expect((single.node as { background?: string }).background).toBe("#000000");

    const multi = mapFrame(
      {
        type: "FRAME",
        id: "f:3",
        name: "Multi",
        width: 100,
        height: 50,
        fills: [
          { type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 0.5 },
          { type: "SOLID", color: { r: 0, g: 0, b: 1 } },
        ],
      },
      { isRoot: true },
      [],
    );
    expect((multi.node as { backgrounds?: unknown[] }).backgrounds).toHaveLength(2);
  });
});
