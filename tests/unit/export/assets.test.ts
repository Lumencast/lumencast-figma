import { describe, it, expect } from "vitest";
import { applyAssetPathRewrites, createAssetRegistry } from "../../../src/export/assets";
import { createMockFigma } from "../../fixtures/figma/mock";

const PNG_PREFIX = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBytes(seed: number): Uint8Array {
  const arr = new Uint8Array(8 + 4);
  arr.set(PNG_PREFIX, 0);
  arr[8] = seed;
  arr[9] = seed + 1;
  arr[10] = seed + 2;
  arr[11] = seed + 3;
  return arr;
}

describe("createAssetRegistry", () => {
  it("returns a deterministic placeholder path on register", () => {
    const figma = createMockFigma();
    const reg = createAssetRegistry({ api: figma });
    expect(reg.registerImageHash("abc123")).toBe("assets/abc123");
    expect(reg.registerImageHash("abc123")).toBe("assets/abc123");
  });

  it("finalize uses Figma's content-addressed imageHash + sniffed extension as the asset filename", async () => {
    const figma = createMockFigma();
    const bytes1 = pngBytes(10);
    const bytes2 = pngBytes(20);
    figma.__registerImage({ hash: "h1", bytes: bytes1, mimeType: "image/png" });
    figma.__registerImage({ hash: "h2", bytes: bytes2, mimeType: "image/png" });

    const reg = createAssetRegistry({ api: figma });
    reg.registerImageHash("h1");
    reg.registerImageHash("h2");

    const assets = await reg.finalize();
    expect(assets).toHaveLength(2);
    // Filename is `assets/<figma-imageHash>.<ext>` — no per-byte rehashing.
    expect(assets.map((a) => a.name).sort()).toEqual(["assets/h1.png", "assets/h2.png"]);
    expect(assets[0]?.mimeType).toBe("image/png");

    const rewrites = reg.rewrites();
    expect(rewrites["assets/h1"]).toBe("assets/h1.png");
    expect(rewrites["assets/h2"]).toBe("assets/h2.png");
  });

  it("dedupes registrations by figma hash", async () => {
    const figma = createMockFigma();
    figma.__registerImage({ hash: "h1", bytes: pngBytes(10), mimeType: "image/png" });

    const reg = createAssetRegistry({ api: figma });
    reg.registerImageHash("h1");
    reg.registerImageHash("h1");
    const assets = await reg.finalize();
    expect(assets).toHaveLength(1);
  });

  it("applyAssetPathRewrites rewrites placeholder paths in nested LSML trees", () => {
    const tree = {
      kind: "frame",
      children: [
        { kind: "image", src: "assets/h1", alt: "x", size: { w: 10, h: 10 } },
        {
          kind: "stack",
          direction: "horizontal",
          children: [{ kind: "image", src: "assets/h2", alt: "y", size: { w: 10, h: 10 } }],
        },
      ],
    };
    applyAssetPathRewrites(tree, {
      "assets/h1": "assets/aaaa.png",
      "assets/h2": "assets/bbbb.png",
    });
    expect(JSON.stringify(tree)).toContain("assets/aaaa.png");
    expect(JSON.stringify(tree)).toContain("assets/bbbb.png");
    expect(JSON.stringify(tree)).not.toContain("assets/h1");
    expect(JSON.stringify(tree)).not.toContain("assets/h2");
  });
});
