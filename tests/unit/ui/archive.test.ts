// Unit tests for the .lsmlz archive packer / unpacker.
//
// Vitest config routes anything under tests/unit/ui/ to happy-dom because
// the archive module imports nothing DOM-specific itself, but it's a UI
// concern (lives in src/ui/) and may pull in DOM-adjacent helpers in the
// future.

import { describe, it, expect } from "vitest";
import { packArchive, unpackArchive, isArchive } from "../../../src/ui/archive";

const SAMPLE_LSML = JSON.stringify({
  $schema: "https://lumencast.dev/schema/lsml/1.1/schema.json",
  lsml: "1.1",
  scene_id: "demo",
  scene_version: "sha256:" + "a".repeat(64),
  layout: { kind: "frame", size: { w: 100, h: 100 }, children: [] },
});

const PNG_BYTES_1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const PNG_BYTES_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03, 0x04]);

describe("packArchive", () => {
  it("produces a valid ZIP Blob with the .lsml at the root and assets/ inside", async () => {
    const blob = packArchive({
      sceneId: "demo",
      canonical: SAMPLE_LSML,
      assets: [
        { name: "assets/aaaa.png", mimeType: "image/png", bytes: PNG_BYTES_1 },
        { name: "assets/bbbb.png", mimeType: "image/png", bytes: PNG_BYTES_2 },
      ],
    });

    expect(blob.type).toBe("application/lsml+zip");
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(isArchive(buf)).toBe(true);

    const unpacked = unpackArchive(buf);
    expect(unpacked.lsmlBytes).toBe(SAMPLE_LSML);
    expect(unpacked.assets).toHaveLength(2);
    expect(unpacked.assets.map((a) => a.path).sort()).toEqual([
      "assets/aaaa.png",
      "assets/bbbb.png",
    ]);
    const a = unpacked.assets.find((a) => a.path === "assets/aaaa.png")!;
    expect(Array.from(a.bytes)).toEqual(Array.from(PNG_BYTES_1));
  });

  it("emits a single-file archive when there are no assets", async () => {
    const blob = packArchive({ sceneId: "demo", canonical: SAMPLE_LSML, assets: [] });
    const unpacked = unpackArchive(new Uint8Array(await blob.arrayBuffer()));
    expect(unpacked.lsmlBytes).toBe(SAMPLE_LSML);
    expect(unpacked.assets).toHaveLength(0);
  });
});

describe("unpackArchive", () => {
  it("rejects an archive with no .lsml entry", async () => {
    // Use fflate directly to build a malformed archive (assets/ only).
    const { zipSync } = await import("fflate");
    const zipped = zipSync({
      "assets/x.png": PNG_BYTES_1,
    });
    expect(() => unpackArchive(zipped)).toThrow(/does not contain an .lsml entry/);
  });

  it("accepts a hand-crafted archive with the .lsml extension at any name", async () => {
    const { zipSync } = await import("fflate");
    const { strToU8 } = await import("fflate");
    const zipped = zipSync({
      "totally-different-name.lsml": strToU8(SAMPLE_LSML),
      "assets/img.png": PNG_BYTES_1,
    });
    const unpacked = unpackArchive(zipped);
    expect(unpacked.lsmlBytes).toBe(SAMPLE_LSML);
    expect(unpacked.assets).toHaveLength(1);
  });

  it("does not pick up assets inside the assets/ tree as the lsml file", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    // assets/anything.json should NOT be treated as the bundle even though
    // it ends in .json.
    const zipped = zipSync({
      "scene.lsml": strToU8(SAMPLE_LSML),
      "assets/manifest.json": strToU8('{"unrelated":true}'),
    });
    const unpacked = unpackArchive(zipped);
    expect(unpacked.lsmlBytes).toBe(SAMPLE_LSML);
  });
});

describe("isArchive", () => {
  it("returns true for the ZIP magic bytes", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]);
    expect(isArchive(zip)).toBe(true);
  });

  it("returns false for plain JSON", () => {
    expect(isArchive(new TextEncoder().encode("{"))).toBe(false);
  });

  it("returns false for short input", () => {
    expect(isArchive(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});
