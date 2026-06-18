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

function bytesFromString(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

const JPEG_PREFIX = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_PREFIX = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
function webpBytes(): Uint8Array {
  // RIFF....WEBP
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
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

  it("registerImageHashAsDataUri resolves to a data:image/<mime>;base64,… URI (1.2 image-fill src)", async () => {
    const figma = createMockFigma();
    figma.__registerImage({ hash: "f1", bytes: pngBytes(7), mimeType: "image/png" });

    const reg = createAssetRegistry({ api: figma });
    const placeholder = reg.registerImageHashAsDataUri("f1");
    expect(placeholder).toBe("__asset-data:f1");
    // Deduped per hash.
    expect(reg.registerImageHashAsDataUri("f1")).toBe(placeholder);

    await reg.finalize();
    const rewrites = reg.rewrites();
    const dataUri = rewrites["__asset-data:f1"];
    expect(dataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });

  it("keeps the local `assets/` path and the data: URI for the same hash distinct", async () => {
    const figma = createMockFigma();
    figma.__registerImage({ hash: "shared", bytes: pngBytes(3), mimeType: "image/png" });

    const reg = createAssetRegistry({ api: figma });
    const localPath = reg.registerImageHash("shared"); // image PRIMITIVE
    const dataPlaceholder = reg.registerImageHashAsDataUri("shared"); // image-FILL
    expect(localPath).toBe("assets/shared");
    expect(dataPlaceholder).toBe("__asset-data:shared");

    await reg.finalize();
    const rewrites = reg.rewrites();
    expect(rewrites["assets/shared"]).toBe("assets/shared.png");
    expect(rewrites["__asset-data:shared"]).toMatch(/^data:image\/png;base64,/);
  });

  // --- Bastion VETO: data: URI MIME bound to the raster allowlist (ADR 002 #H) ---

  it("omits any data: URI for an SVG payload (no data:image/svg+xml emitted)", async () => {
    const figma = createMockFigma();
    figma.__registerImage({
      hash: "svg1",
      bytes: bytesFromString('<?xml version="1.0"?><svg onload="alert(1)"></svg>'),
      mimeType: "image/svg+xml",
    });
    const diagnostics: { code: string; message: string }[] = [];
    const reg = createAssetRegistry({
      api: figma,
      onDiagnostic: (code, message) => diagnostics.push({ code, message }),
    });
    const placeholder = reg.registerImageHashAsDataUri("svg1");

    await reg.finalize();
    const rewrites = reg.rewrites();
    // No resolution at all → placeholder is NOT rewritten.
    expect(rewrites[placeholder]).toBeUndefined();
    expect(JSON.stringify(rewrites)).not.toContain("data:image/svg+xml");
    expect(JSON.stringify(rewrites)).not.toContain("svg");
    // Omit-on-miss diagnostic surfaced.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("asset-data-uri-omitted");
  });

  it("omits any data: URI for unknown/binary bytes (no data:application/octet-stream emitted)", async () => {
    const figma = createMockFigma();
    figma.__registerImage({
      hash: "bin1",
      bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
      mimeType: "application/octet-stream",
    });
    const diagnostics: { code: string; message: string }[] = [];
    const reg = createAssetRegistry({
      api: figma,
      onDiagnostic: (code, message) => diagnostics.push({ code, message }),
    });
    const placeholder = reg.registerImageHashAsDataUri("bin1");

    await reg.finalize();
    const rewrites = reg.rewrites();
    expect(rewrites[placeholder]).toBeUndefined();
    expect(JSON.stringify(rewrites)).not.toContain("data:application/octet-stream");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("asset-data-uri-omitted");
  });

  it("emits a raster data: URI for png/jpeg/gif/webp (legitimate case non-regression)", async () => {
    const figma = createMockFigma();
    figma.__registerImage({ hash: "p", bytes: pngBytes(1), mimeType: "image/png" });
    figma.__registerImage({ hash: "j", bytes: JPEG_PREFIX, mimeType: "image/jpeg" });
    figma.__registerImage({ hash: "g", bytes: GIF_PREFIX, mimeType: "image/gif" });
    figma.__registerImage({ hash: "w", bytes: webpBytes(), mimeType: "image/webp" });

    const reg = createAssetRegistry({ api: figma });
    reg.registerImageHashAsDataUri("p");
    reg.registerImageHashAsDataUri("j");
    reg.registerImageHashAsDataUri("g");
    reg.registerImageHashAsDataUri("w");

    await reg.finalize();
    const rewrites = reg.rewrites();
    expect(rewrites["__asset-data:p"]).toMatch(/^data:image\/png;base64,/);
    expect(rewrites["__asset-data:j"]).toMatch(/^data:image\/jpeg;base64,/);
    expect(rewrites["__asset-data:g"]).toMatch(/^data:image\/gif;base64,/);
    expect(rewrites["__asset-data:w"]).toMatch(/^data:image\/webp;base64,/);
  });

  it("drops the referencing fill/mask and leaks no __asset-data: placeholder when an asset is rejected", async () => {
    const figma = createMockFigma();
    figma.__registerImage({
      hash: "ok",
      bytes: pngBytes(2),
      mimeType: "image/png",
    });
    figma.__registerImage({
      hash: "evil",
      bytes: bytesFromString('<svg onload="alert(1)"/>'),
      mimeType: "image/svg+xml",
    });
    const reg = createAssetRegistry({ api: figma });
    const okSrc = reg.registerImageHashAsDataUri("ok");
    const evilSrc = reg.registerImageHashAsDataUri("evil");

    await reg.finalize();
    const rewrites = reg.rewrites();

    // A representative LSML subtree: a frame with two image fills, plus a
    // masked node whose mask.source references the rejected asset.
    const tree = {
      kind: "frame",
      backgrounds: [
        { kind: "image", src: okSrc, objectFit: "cover" },
        { kind: "image", src: evilSrc, objectFit: "cover" },
      ],
      children: [
        {
          kind: "shape",
          mask: { source: { kind: "image", src: evilSrc } },
        },
      ],
    };
    applyAssetPathRewrites(tree, rewrites);

    const serialized = JSON.stringify(tree);
    // No placeholder leaks anywhere in the emitted bundle.
    expect(serialized).not.toContain("__asset-data:");
    // The legitimate raster fill survives, rewritten to its data: URI.
    expect(tree.backgrounds).toHaveLength(1);
    expect(tree.backgrounds[0]?.src).toMatch(/^data:image\/png;base64,/);
    // The rejected mask source is dropped, not left dangling.
    expect(serialized).not.toContain("svg");
    expect((tree.children[0] as { mask?: unknown }).mask).toBeUndefined();
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
