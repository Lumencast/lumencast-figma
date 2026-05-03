import { describe, it, expect } from "vitest";
import { mapImage } from "../../../src/mapping/image";
import type { MappingContext } from "../../../src/mapping/types";

function ctx(): MappingContext & { warns: string[]; registered: string[] } {
  const warns: string[] = [];
  const registered: string[] = [];
  return {
    warns,
    registered,
    warn(code) {
      warns.push(code);
    },
    registerImageHash(hash) {
      registered.push(hash);
      return `assets/${hash}.png`;
    },
  };
}

describe("mapImage", () => {
  it("returns null when the rectangle has no image fill", () => {
    const r = mapImage(
      {
        type: "RECTANGLE",
        id: "i:0",
        name: "x",
        width: 10,
        height: 10,
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      },
      ctx(),
    );
    expect(r).toBeNull();
  });

  it("registers the image hash and routes the asset path through bind.src + defaults", () => {
    const c = ctx();
    const r = mapImage(
      {
        type: "RECTANGLE",
        id: "i:1",
        name: "Logo",
        width: 100,
        height: 100,
        fills: [{ type: "IMAGE", imageHash: "abc123", scaleMode: "FIT" }],
      },
      c,
    )!;
    const bind = (r.node as { bind: { src: string } }).bind;
    expect(bind.src).toMatch(/^__lit\.image\./);
    expect(r.defaults?.[bind.src]).toBe("assets/abc123.png");
    expect((r.node as { fit?: string }).fit).toBe("contain");
    expect((r.node as { alt: string }).alt).toBe("Logo");
    expect(c.registered).toEqual(["abc123"]);
    expect(r.assetRefs).toEqual(["abc123"]);
  });

  it("prefers [bind:src=...] over registered hash", () => {
    const c = ctx();
    const r = mapImage(
      {
        type: "RECTANGLE",
        id: "i:2",
        name: "[bind:src=team.logo.url] Team logo",
        width: 100,
        height: 100,
        fills: [{ type: "IMAGE", imageHash: "abc123" }],
      },
      c,
    )!;
    expect((r.node as { bind: { src: string } }).bind.src).toBe("team.logo.url");
    expect(r.defaults).toBeUndefined();
    expect((r.node as { alt: string }).alt).toBe("Team logo");
  });
});
