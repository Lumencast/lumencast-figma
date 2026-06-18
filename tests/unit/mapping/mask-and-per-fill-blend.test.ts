// Integration #K × #L — a Figma node that is BOTH masked by a shape sibling
// (#K, shape-source mask → `mask:{source:{kind:"shape",ref}}`) AND carries
// stacked `fills[]` with per-paint blend modes (#L, per-fill `blendMode`).
//
// The two mappers are distinct (mask lowering in `traverse.ts`/`lsml-1_2.ts`,
// per-fill blend in `color.ts`/`shape.ts`) ; this test proves they emit TOGETHER
// onto the same LSML node, without one clobbering the other :
//
//   1. the masked node keeps its shape-source `mask` (ref = the mask shape's
//      stable `fig-<id>`) — #K untouched by the per-fill blend ;
//   2. each fill on that SAME node carries its own revalidated `blendMode` —
//      #L untouched by the mask ;
//   3. the mask shape sibling is preserved with its stable `id` so the runtime
//      index resolves the ref ;
//   4. the mask carries NO per-fill blend of its own — a mask is a coverage
//      shape, the blend lives only on the painted node's fills.

import { describe, it, expect } from "vitest";
import { walk } from "../../../src/mapping/traverse";
import type { MappingContext } from "../../../src/mapping/types";
import type { PrimitiveNode } from "../../../src/shared/lsml-types";

function ctx(): MappingContext {
  return {
    warn: () => undefined,
    registerImageHashAsDataUri: (hash: string) => `__asset-data:${hash}`,
  };
}

/** A GROUP : [ shape mask (ellipse), masked sibling with per-fill blends ]. */
function maskedAndBlendedGroup() {
  return {
    type: "GROUP",
    id: "900:2",
    name: "Masked + per-fill-blend group",
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    children: [
      {
        type: "ELLIPSE",
        id: "817:3001",
        name: "Ellipse mask",
        width: 200,
        height: 200,
        isMask: true,
        maskType: "LUMINANCE",
        // Plain coverage shape — no per-fill blend here.
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      },
      {
        type: "RECTANGLE",
        id: "817:3002",
        name: "Masked content with stacked blended fills",
        width: 200,
        height: 200,
        fills: [
          { type: "SOLID", color: { r: 1, g: 0, b: 0 }, blendMode: "MULTIPLY" },
          { type: "SOLID", color: { r: 0, g: 0, b: 1 }, blendMode: "SCREEN" },
        ],
      },
    ],
  };
}

function children(group: unknown): PrimitiveNode[] {
  const result = walk(group as never, ctx(), { isRoot: false });
  const node = result?.node as { children?: PrimitiveNode[] };
  return node?.children ?? [];
}

describe("integration #K mask × #L per-fill blend — emit together on one node", () => {
  const kids = children(maskedAndBlendedGroup());

  it("both the mask shape and the masked-and-blended content survive", () => {
    expect(kids.length).toBe(2);
  });

  it("the masked node carries BOTH a shape-source mask (#K) AND per-fill blends (#L)", () => {
    const masked = kids.find((n) => (n as { mask?: unknown }).mask) as
      | (PrimitiveNode & {
          mask: { source: { kind: string; ref: string }; type: string };
          fills: { blendMode?: string }[];
        })
      | undefined;
    expect(masked).toBeDefined();

    // #K — the shape-source mask references the mask shape's stable id.
    expect(masked!.mask).toMatchObject({
      source: { kind: "shape", ref: "fig-817:3001" },
      type: "luminance",
    });

    // #L — each stacked fill keeps its own revalidated per-fill blend.
    expect(masked!.fills.map((f) => f.blendMode)).toEqual(["multiply", "screen"]);
  });

  it("the mask shape sibling keeps its stable id and carries no per-fill blend", () => {
    const maskShape = kids.find((n) => n.id === "fig-817:3001") as
      | (PrimitiveNode & { fills?: { blendMode?: string }[] })
      | undefined;
    expect(maskShape).toBeDefined();
    expect(maskShape!.kind).toBe("shape");
    // The mask coverage shape carries no blend of its own.
    for (const f of maskShape!.fills ?? []) {
      expect(f.blendMode).toBeUndefined();
    }
  });
});
