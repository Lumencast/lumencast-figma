import { describe, it, expect } from "vitest";
import { mapStack } from "../../../src/mapping/stack";

describe("mapStack", () => {
  it("maps horizontal auto-layout with gap and padding", () => {
    const r = mapStack(
      {
        type: "FRAME",
        id: "s:1",
        name: "Header",
        width: 800,
        height: 60,
        layoutMode: "HORIZONTAL",
        itemSpacing: 12,
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "CENTER",
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 8,
        paddingBottom: 8,
      },
      [],
    );
    expect(r.node).toMatchObject({
      kind: "stack",
      direction: "horizontal",
      gap: 12,
      justify: "space-between",
      align: "center",
      padding: [8, 16, 8, 16],
    });
  });

  it("collapses uniform padding to a number", () => {
    const r = mapStack(
      {
        type: "FRAME",
        id: "s:2",
        name: "Box",
        width: 100,
        height: 100,
        layoutMode: "VERTICAL",
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 8,
        paddingBottom: 8,
      },
      [],
    );
    expect((r.node as { padding?: unknown }).padding).toBe(8);
  });

  it("emits wrap + crossGap on 1.1+ wrap layouts", () => {
    const r = mapStack(
      {
        type: "FRAME",
        id: "s:3",
        name: "Tags",
        width: 200,
        height: 80,
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
        itemSpacing: 4,
        counterAxisSpacing: 8,
      },
      [],
    );
    expect(r.node).toMatchObject({ wrap: true, gap: 4, crossGap: 8 });
  });
});
