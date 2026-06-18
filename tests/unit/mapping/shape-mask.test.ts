// Shape-source masks + stable ids (ADR 002 §3.2 Amendment 2 / A2.1 #K).
//
// A Figma GROUP whose first child is `isMask:true` with NO image fill (a
// vector / ellipse mask) lowers to a typed shape-source mask on each masked
// sibling : `mask:{source:{kind:"shape", ref:<id>}}`. The referenced shape
// gains a STABLE deterministic `id` (`fig-<safeIdRef(figmaNodeId)>`) and is
// KEPT in the tree (the runtime resolves the ref against its `id → shape`
// index). This proves the mapper half of #K end-to-end :
//
//   - the masked sibling carries a `shape`-kind mask source ;
//   - the ref equals the referenced shape's emitted `id` (the wire) ;
//   - the id is stable + deterministic from the Figma node id ;
//   - id is emitted ONLY on the referenced shape (no inflation) ;
//   - the mask shape is NOT consumed (unlike an image mask) — it stays in the
//     tree so the index can key it.

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

/** A GROUP : [ shape mask (no image fill), masked sibling ]. */
function shapeMaskGroup() {
  return {
    type: "GROUP",
    id: "900:1",
    name: "Shape mask group",
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    children: [
      {
        type: "ELLIPSE",
        id: "817:1991",
        name: "Ellipse mask",
        width: 200,
        height: 200,
        isMask: true,
        maskType: "ALPHA",
        // No IMAGE paint → this is a SHAPE mask, not an image mask.
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      },
      {
        type: "RECTANGLE",
        id: "817:2000",
        name: "Masked content",
        width: 200,
        height: 200,
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      },
    ],
  };
}

function children(group: unknown): PrimitiveNode[] {
  const result = walk(group as never, ctx(), { isRoot: false });
  const node = result?.node as { children?: PrimitiveNode[] };
  return node?.children ?? [];
}

describe("shape-source mask lowering (#K)", () => {
  it("emits a shape-source mask on the masked sibling, ref = the mask shape's id", () => {
    const kids = children(shapeMaskGroup());
    // Both nodes survive : the masked content AND the mask shape (kept so the
    // runtime index can resolve the ref).
    expect(kids.length).toBe(2);

    const maskShape = kids.find((n) => n.id === "fig-817:1991");
    expect(maskShape).toBeDefined();
    expect(maskShape?.kind).toBe("shape");

    // The masked sibling references the mask shape by its stable id.
    const masked = kids.find((n) => n.id === undefined && (n as { mask?: unknown }).mask);
    expect(masked).toBeDefined();
    expect(
      (masked as { mask: { source: { kind: string; ref: string }; type: string; op: string } })
        .mask,
    ).toMatchObject({
      source: { kind: "shape", ref: "fig-817:1991" },
      type: "alpha",
      op: "intersect",
    });
  });

  it("the ref equals the referenced shape's emitted id (the wire holds)", () => {
    const kids = children(shapeMaskGroup());
    const masked = kids.find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    const ref = masked.mask.source.ref;
    const target = kids.find((n) => n.id === ref);
    expect(target).toBeDefined();
    expect(target?.kind).toBe("shape");
  });

  it("emits an id ONLY on the referenced shape (no id inflation)", () => {
    const kids = children(shapeMaskGroup());
    const withIds = kids.filter((n) => n.id !== undefined);
    expect(withIds.length).toBe(1);
    expect(withIds[0]?.id).toBe("fig-817:1991");
  });

  it("the mask shape is KEPT in the tree (unlike an image mask, not consumed)", () => {
    const kids = children(shapeMaskGroup());
    expect(kids.some((n) => n.id === "fig-817:1991")).toBe(true);
  });

  it("is deterministic : two runs of the same group yield the same id", () => {
    const a = children(shapeMaskGroup()).find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    const b = children(shapeMaskGroup()).find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    expect(a.mask.source.ref).toBe(b.mask.source.ref);
    expect(a.mask.source.ref).toBe("fig-817:1991");
  });
});
