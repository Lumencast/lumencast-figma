import { describe, it, expect } from "vitest";
import { mapText } from "../../../src/mapping/text";

const black = { r: 0, g: 0, b: 0 };

describe("mapText", () => {
  it("emits a static literal under defaults when no [bind:...] is set", () => {
    const r = mapText({
      type: "TEXT",
      id: "1:2",
      name: "Hello",
      characters: "Hello world",
      width: 100,
      height: 20,
    });
    expect(r.node.kind).toBe("text");
    const path = (r.node as { bind?: { value?: string } }).bind?.value;
    expect(path).toBeDefined();
    expect(r.defaults?.[path as string]).toBe("Hello world");
  });

  it("uses the layer-name bind when present", () => {
    const r = mapText({
      type: "TEXT",
      id: "1:3",
      name: "[bind:show.title] Title",
      characters: "Default",
      width: 100,
      height: 20,
    });
    expect((r.node as { bind?: { value?: string } }).bind?.value).toBe("show.title");
    expect(r.defaults).toBeUndefined();
  });

  it("captures style from font + fill + alignment", () => {
    const r = mapText({
      type: "TEXT",
      id: "1:4",
      name: "Title",
      characters: "x",
      fontSize: 48,
      fontWeight: 700,
      fontName: { family: "Inter", style: "Bold" },
      fills: [{ type: "SOLID", color: black }],
      textAlignHorizontal: "CENTER",
      width: 100,
      height: 20,
    });
    const style = (r.node as { style?: Record<string, unknown> }).style;
    expect(style).toMatchObject({
      fontSize: 48,
      fontWeight: 700,
      fontFamily: "Inter",
      color: "#000000",
      textAlign: "center",
    });
  });

  it("translates lineHeight PERCENT to a unitless multiplier", () => {
    const r = mapText({
      type: "TEXT",
      id: "1:5",
      name: "x",
      characters: "y",
      lineHeight: { unit: "PERCENT", value: 130 },
      fontSize: 16,
      width: 10,
      height: 10,
    });
    expect((r.node as { style?: { lineHeight?: number } }).style?.lineHeight).toBe(1.3);
  });
});
