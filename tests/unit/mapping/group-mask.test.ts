// Group/frame-source masks + stable ids (ADR 002 §3.2 Amendment 4 / A4.3 #O).
//
// A Figma GROUP/FRAME whose first child is `isMask:true` and which is itself a
// container (no usable image fill) lowers to a typed group-source mask on each
// masked sibling : `mask:{source:{kind:"group", ref:<id>}}`. The referenced
// CONTAINER gains a STABLE deterministic `id` (`fig-<safeIdRef(figmaNodeId)>`)
// and is KEPT in the tree (the runtime composites its visible children). This
// is the mapper half of #O end-to-end (extends #K to the container case) :
//
//   - the masked sibling carries a `group`-kind mask source ;
//   - the ref equals the referenced container's emitted `id` ;
//   - the id is stable + emitted ONLY on the container (no inflation on kids) ;
//   - the container is KEPT in the tree ;
//   - non-regression : a single shape mask still lowers to a `shape` source.

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

/** An outer GROUP : [ GROUP mask (container of ellipses), masked sibling ].
 *  The mask node is a GROUP → it lowers to `kind:"frame"`, exercising the #O
 *  group-source channel (not the single-shape #K channel). */
function groupMaskGroup() {
  return {
    type: "GROUP",
    id: "900:1",
    name: "Outer group",
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    children: [
      {
        // A GROUP marked as a mask — a multi-ellipse container (817:2011-like).
        type: "GROUP",
        id: "817:2011",
        name: "Mask group",
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        isMask: true,
        maskType: "ALPHA",
        children: [
          {
            type: "ELLIPSE",
            id: "817:2014",
            name: "Ellipse visible",
            width: 80,
            height: 80,
            x: 0,
            y: 0,
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
          },
          {
            type: "ELLIPSE",
            id: "817:2015",
            name: "Ellipse hidden",
            width: 80,
            height: 80,
            x: 50,
            y: 50,
            visible: false,
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
          },
        ],
      },
      {
        type: "RECTANGLE",
        id: "817:2016",
        name: "Masked content",
        width: 200,
        height: 200,
        x: 0,
        y: 0,
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

describe("group/frame-source mask lowering (#O)", () => {
  it("emits a group-source mask on the masked sibling, ref = the container's id", () => {
    const kids = children(groupMaskGroup());
    // Both survive : the masked content AND the mask container (kept so the
    // runtime composites its visible children).
    expect(kids.length).toBe(2);

    const maskContainer = kids.find((n) => n.id === "fig-817:2011");
    expect(maskContainer).toBeDefined();
    expect(maskContainer?.kind).toBe("frame");

    const masked = kids.find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { kind: string; ref: string }; type: string; op: string };
    };
    expect(masked).toBeDefined();
    expect(masked.mask).toMatchObject({
      source: { kind: "group", ref: "fig-817:2011" },
      type: "alpha",
      op: "intersect",
    });
  });

  it("the ref equals the referenced container's emitted id (the wire holds)", () => {
    const kids = children(groupMaskGroup());
    const masked = kids.find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    const target = kids.find((n) => n.id === masked.mask.source.ref);
    expect(target).toBeDefined();
    expect(target?.kind).toBe("frame");
  });

  it("emits an id ONLY on the container, never on its children (no inflation)", () => {
    const kids = children(groupMaskGroup());
    const container = kids.find((n) => n.id === "fig-817:2011") as {
      children?: { id?: string }[];
    };
    // The container carries the id ; none of its children do.
    expect((container.children ?? []).some((c) => typeof c.id === "string")).toBe(false);
  });

  it("the mask container is KEPT in the tree (not consumed)", () => {
    const kids = children(groupMaskGroup());
    expect(kids.some((n) => n.id === "fig-817:2011" && n.kind === "frame")).toBe(true);
  });

  it("is deterministic across runs", () => {
    const a = children(groupMaskGroup()).find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    const b = children(groupMaskGroup()).find((n) => (n as { mask?: unknown }).mask) as {
      mask: { source: { ref: string } };
    };
    expect(a.mask.source.ref).toBe(b.mask.source.ref);
    expect(a.mask.source.ref).toBe("fig-817:2011");
  });
});
