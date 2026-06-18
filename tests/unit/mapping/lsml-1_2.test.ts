// LSML 1.2 transcription : the four zero-loss families (ADR 002 §3.2 / #H).
//
// Pure-helper coverage + per-mapper emission for blend / mask / image-fill /
// gradient-transform, plus the conditional `lsml: "1.2"` version gate.

import { describe, it, expect } from "vitest";
import {
  layoutUsesLsml12,
  mapBlendMode,
  mapMaskType,
  mapScaleModeToObjectFit,
  matrixToGradientTransform,
  imagePaintToFill,
  safeIdRef,
  stableShapeId,
} from "../../../src/mapping/lsml-1_2";
import { mapShape } from "../../../src/mapping/shape";
import { captureFigmaExtras } from "../../../src/mapping/figma-extras";
import { paintToFill } from "../../../src/mapping/color";
import type { MappingContext } from "../../../src/mapping/types";

/** A mapping context exposing only the data-URI registry (records calls). */
function dataUriCtx(): MappingContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    warn: () => undefined,
    registerImageHashAsDataUri: (hash: string) => {
      calls.push(hash);
      return `__asset-data:${hash}`;
    },
  };
}

describe("mapBlendMode (Figma → CSS mix-blend-mode, T4)", () => {
  it("maps HARD_LIGHT → hard-light", () => {
    expect(mapBlendMode("HARD_LIGHT")).toBe("hard-light");
  });
  it("maps the full Figma enum to a closed CSS set", () => {
    expect(mapBlendMode("MULTIPLY")).toBe("multiply");
    expect(mapBlendMode("SCREEN")).toBe("screen");
    expect(mapBlendMode("OVERLAY")).toBe("overlay");
    expect(mapBlendMode("LUMINOSITY")).toBe("luminosity");
  });
  it("folds Figma-only LINEAR_BURN / LINEAR_DODGE to nearest CSS keyword", () => {
    expect(mapBlendMode("LINEAR_BURN")).toBe("color-burn");
    expect(mapBlendMode("LINEAR_DODGE")).toBe("color-dodge");
  });
  it("omits PASS_THROUGH / NORMAL / unknown (no passthrough)", () => {
    expect(mapBlendMode("PASS_THROUGH")).toBeNull();
    expect(mapBlendMode("NORMAL")).toBeNull();
    expect(mapBlendMode("WAT")).toBeNull();
    expect(mapBlendMode(undefined)).toBeNull();
    expect(mapBlendMode(42)).toBeNull();
  });
});

describe("mapMaskType (Figma → alpha|luminance)", () => {
  it("maps LUMINANCE → luminance, everything else → alpha", () => {
    expect(mapMaskType("LUMINANCE")).toBe("luminance");
    expect(mapMaskType("ALPHA")).toBe("alpha");
    expect(mapMaskType("VECTOR")).toBe("alpha");
    expect(mapMaskType(undefined)).toBe("alpha");
  });
});

describe("safeIdRef / stableShapeId (#K — deterministic stable shape ids)", () => {
  it("preserves a Figma id (incl. its `:`) within the safe token class", () => {
    expect(safeIdRef("817:1991")).toBe("817:1991");
    expect(safeIdRef("A_b-2:3")).toBe("A_b-2:3");
  });

  it("rejects a token carrying markup / unsafe characters", () => {
    expect(safeIdRef('"><script>')).toBeNull();
    expect(safeIdRef("a b")).toBeNull();
    expect(safeIdRef("a#b")).toBeNull();
    expect(safeIdRef("")).toBeNull();
  });

  it("stableShapeId prefixes `fig-` and is deterministic + unique", () => {
    // Determinism : same input → same id every call.
    expect(stableShapeId("817:1991")).toBe("fig-817:1991");
    expect(stableShapeId("817:1991")).toBe("fig-817:1991");
    // Uniqueness : distinct Figma ids → distinct ids.
    expect(stableShapeId("817:1992")).toBe("fig-817:1992");
    expect(stableShapeId("817:1991")).not.toBe(stableShapeId("817:1992"));
  });

  it("returns null when the source id is not a safe token (no broken ref)", () => {
    expect(stableShapeId('a"b')).toBeNull();
  });
});

describe("mapScaleModeToObjectFit (Figma scaleMode → object-fit, T4)", () => {
  it("maps FILL → cover, FIT → contain, CROP → cover", () => {
    expect(mapScaleModeToObjectFit("FILL")).toBe("cover");
    expect(mapScaleModeToObjectFit("FIT")).toBe("contain");
    expect(mapScaleModeToObjectFit("CROP")).toBe("cover");
  });
  it("omits TILE / unknown (no object-fit equivalent)", () => {
    expect(mapScaleModeToObjectFit("TILE")).toBeNull();
    expect(mapScaleModeToObjectFit("WAT")).toBeNull();
    expect(mapScaleModeToObjectFit(undefined)).toBeNull();
  });
});

describe("matrixToGradientTransform (Figma 2×3 → 6-float SVG form, T4)", () => {
  it("flattens a Figma row-major matrix to [a,b,c,d,e,f] (column-major SVG)", () => {
    // Figma [[a,c,e],[b,d,f]] = [[0,1,0],[-1,0,1]] → 90° rotation + ty=1.
    expect(
      matrixToGradientTransform([
        [0, 1, 0],
        [-1, 0, 1],
      ]),
    ).toEqual([0, -1, 1, 0, 0, 1]);
  });
  it("returns null for the identity (no transform to carry)", () => {
    expect(
      matrixToGradientTransform([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ).toBeNull();
  });
  it("drops a malformed / non-finite matrix (never a free value)", () => {
    expect(matrixToGradientTransform(null)).toBeNull();
    expect(matrixToGradientTransform(undefined)).toBeNull();
    expect(matrixToGradientTransform([[1, 0, 0]])).toBeNull();
    expect(
      matrixToGradientTransform([
        [Number.NaN, 0, 0],
        [0, 1, 0],
      ]),
    ).toBeNull();
    expect(
      matrixToGradientTransform([
        [Number.POSITIVE_INFINITY, 0, 0],
        [0, 1, 0],
      ]),
    ).toBeNull();
  });
});

describe("imagePaintToFill (Figma ImagePaint → 1.2 image-fill)", () => {
  it("builds { kind:image, src, objectFit } from a FILL image paint", () => {
    const calls: string[] = [];
    const fill = imagePaintToFill(
      { type: "IMAGE", imageHash: "abc", scaleMode: "FILL", opacity: 0.8 },
      (h) => {
        calls.push(h);
        return `__asset-data:${h}`;
      },
    );
    expect(fill).toEqual({
      kind: "image",
      src: "__asset-data:abc",
      objectFit: "cover",
      opacity: 0.8,
    });
    expect(calls).toEqual(["abc"]);
  });
  it("returns null for an invisible paint / missing hash / non-image", () => {
    const noop = (h: string) => `__asset-data:${h}`;
    expect(imagePaintToFill({ type: "IMAGE", imageHash: "x", visible: false }, noop)).toBeNull();
    expect(imagePaintToFill({ type: "IMAGE", imageHash: "" }, noop)).toBeNull();
    expect(imagePaintToFill({ type: "SOLID" }, noop)).toBeNull();
  });
});

describe("gradient transform — color.ts emits core `transform`, supersedes angle_deg", () => {
  it("non-trivial matrix → `transform`, no `angle_deg`", () => {
    const fill = paintToFill({
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [0, 1, 0],
        [-1, 0, 1],
      ],
    });
    expect(fill).toMatchObject({ kind: "linear-gradient", transform: [0, -1, 1, 0, 0, 1] });
    expect((fill as { angle_deg?: number }).angle_deg).toBeUndefined();
  });
  it("identity matrix → no `transform`, keeps 1.1 `angle_deg` form", () => {
    const fill = paintToFill({
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    expect((fill as { transform?: unknown }).transform).toBeUndefined();
  });
});

describe("shape image-fill — shape.ts no longer drops IMAGE paints (shape.ts:65 gone)", () => {
  it("an ELLIPSE with an image fill emits a 1.2 image-fill in fills[]", () => {
    const ctx = dataUriCtx();
    const r = mapShape(
      {
        type: "ELLIPSE",
        id: "9:1",
        name: "Sunshine",
        width: 100,
        height: 100,
        fills: [{ type: "IMAGE", imageHash: "sun", scaleMode: "FILL" }],
      } as never,
      ctx,
    );
    const fills = (r.node as { fills?: unknown[] }).fills;
    expect(fills).toEqual([{ kind: "image", src: "__asset-data:sun", objectFit: "cover" }]);
    expect(r.assetRefs).toEqual(["sun"]);
    expect(ctx.calls).toEqual(["sun"]);
  });

  it("interleaves an image fill with a solid in source order", () => {
    const ctx = dataUriCtx();
    const r = mapShape(
      {
        type: "VECTOR",
        id: "9:2",
        name: "Wavy",
        width: 50,
        height: 50,
        fills: [
          { type: "IMAGE", imageHash: "tex", scaleMode: "CROP" },
          { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.3 },
        ],
      } as never,
      ctx,
    );
    const fills = (r.node as { fills: { kind: string }[] }).fills;
    expect(fills.map((f) => f.kind)).toEqual(["image", "solid"]);
  });
});

describe("blendMode core emission — figma-extras.ts promotes node.blendMode", () => {
  it("a node with HARD_LIGHT gets core `blendMode`, not metadata", () => {
    const prim: { kind: string; metadata?: Record<string, unknown>; blendMode?: string } = {
      kind: "shape",
    };
    captureFigmaExtras({ blendMode: "HARD_LIGHT" }, prim);
    expect(prim.blendMode).toBe("hard-light");
    const figma = prim.metadata?.["figma"] as { blendMode?: unknown } | undefined;
    expect(figma?.blendMode).toBeUndefined();
  });
  it("a node with NORMAL blend gets neither core nor metadata blend", () => {
    const prim: { kind: string; metadata?: Record<string, unknown>; blendMode?: string } = {
      kind: "shape",
    };
    captureFigmaExtras({ blendMode: "NORMAL" }, prim);
    expect(prim.blendMode).toBeUndefined();
  });
});

describe("layoutUsesLsml12 — version gate", () => {
  it("true when a primitive carries blendMode / mask / image-fill / gradient transform", () => {
    expect(layoutUsesLsml12({ kind: "shape", blendMode: "hard-light" })).toBe(true);
    expect(layoutUsesLsml12({ kind: "shape", mask: { source: { kind: "image", src: "x" } } })).toBe(
      true,
    );
    expect(layoutUsesLsml12({ kind: "shape", fills: [{ kind: "image", src: "x" }] })).toBe(true);
    expect(
      layoutUsesLsml12({
        kind: "frame",
        backgrounds: [{ kind: "linear-gradient", transform: [1, 0, 0, 1, 0, 0], stops: [] }],
      }),
    ).toBe(true);
  });
  it("recurses into children", () => {
    expect(
      layoutUsesLsml12({ kind: "frame", children: [{ kind: "shape", blendMode: "multiply" }] }),
    ).toBe(true);
  });
  it("false for a pure 1.1 layout (no 1.2 family) — and ignores metadata.figma.*", () => {
    expect(
      layoutUsesLsml12({
        kind: "frame",
        children: [
          { kind: "shape", fill: "#fff", fills: [{ kind: "solid", color: "#fff" }] },
          { kind: "text", metadata: { figma: { blendMode: "HARD_LIGHT" } } },
        ],
      }),
    ).toBe(false);
  });
});

describe("per-fill blendMode (#L) — paint-level blend lowered onto the Fill (§4.3)", () => {
  it("a solid paint with a per-paint blend emits a per-fill blendMode", () => {
    const fill = paintToFill({
      type: "SOLID",
      color: { r: 1, g: 0, b: 0 },
      blendMode: "MULTIPLY",
    });
    expect(fill).toEqual({ kind: "solid", color: "#ff0000", blendMode: "multiply" });
  });

  it("a gradient paint carries its own per-fill blend", () => {
    const fill = paintToFill({
      type: "GRADIENT_LINEAR",
      blendMode: "SCREEN",
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    });
    expect((fill as { blendMode?: string }).blendMode).toBe("screen");
  });

  it("an image paint carries its own per-fill blend", () => {
    const fill = imagePaintToFill(
      { type: "IMAGE", imageHash: "h", scaleMode: "FILL", blendMode: "LUMINOSITY" },
      (h) => `__asset-data:${h}`,
    );
    expect(fill).toMatchObject({ kind: "image", blendMode: "luminosity" });
  });

  it("a no-op / unknown paint blend omits the field (T4 — retro-compat normal)", () => {
    expect(
      (
        paintToFill({ type: "SOLID", color: { r: 0, g: 0, b: 0 }, blendMode: "PASS_THROUGH" }) as {
          blendMode?: string;
        }
      ).blendMode,
    ).toBeUndefined();
    expect(
      (
        paintToFill({ type: "SOLID", color: { r: 0, g: 0, b: 0 }, blendMode: "WAT" }) as {
          blendMode?: string;
        }
      ).blendMode,
    ).toBeUndefined();
    // no blend field at all → no blendMode (unchanged 1.1/1.2 pre-#L output)
    expect(
      "blendMode" in (paintToFill({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }) as object),
    ).toBe(false);
  });

  it("stacked paints each emit their own blend on shape.fills[]", () => {
    const r = mapShape({
      type: "RECTANGLE",
      id: "1:1",
      name: "Stacked",
      width: 10,
      height: 10,
      fills: [
        { type: "SOLID", color: { r: 1, g: 0, b: 0 }, blendMode: "MULTIPLY" },
        { type: "SOLID", color: { r: 0, g: 0, b: 1 }, blendMode: "SCREEN" },
      ],
    } as never);
    const fills = (r.node as { fills: { blendMode?: string }[] }).fills;
    expect(fills.map((f) => f.blendMode)).toEqual(["multiply", "screen"]);
  });

  it("a single solid with a per-fill blend keeps the fills[] form (no legacy collapse)", () => {
    const r = mapShape({
      type: "RECTANGLE",
      id: "1:2",
      name: "Blended",
      width: 10,
      height: 10,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, blendMode: "OVERLAY" }],
    } as never);
    const node = r.node as { fill?: string; fills?: { blendMode?: string }[] };
    expect(node.fill).toBeUndefined();
    expect(node.fills).toEqual([{ kind: "solid", color: "#ffffff", blendMode: "overlay" }]);
  });
});
