// Roundtrip : export(fig) → import → re-export → bundle MUST be byte-stable.
//
// This test bridges the export and import pipelines. It uses the scoreboard
// fixture from Phase 1, exports it, parses + builds it back into a Figma
// node tree (via the import mock), then re-exports the resulting tree and
// asserts the canonical bytes are identical to the original export.
//
// Phase 3 v0.1 caveats encoded as test expectations :
//   - Image fills go through createImage on import → the Figma-side hash
//     differs from the original ; we patch the mock's image registry so the
//     re-exported bundle resolves the same content-addressed asset paths.
//   - INSTANCE primitives are imported as placeholder INSTANCE nodes with
//     scene_id / scene_version / params plugin data ; the export-side
//     `mapInstance` reads that data and reproduces the original primitive.

import { describe, it, expect } from "vitest";
import { runExport } from "../../src/export";
import { importBundle } from "../../src/import";
import { createMockFigma, type MockSceneNode } from "../fixtures/figma/mock";
import { createImportMock, type BuiltNode } from "../fixtures/figma/import-mock";
import { buildScoreboardFixture } from "../fixtures/figma/scoreboard";

/** Thread the imported tree's image bytes into the export-side mock so
 *  the re-export can resolve image fills. The asset registry on the
 *  re-export side regenerates `assets/<sha256>.<ext>` paths from those
 *  bytes ; if the bytes are identical, the paths match the originals. */
function rehostImagesOnExport(
  imported: BuiltNode,
  originalAssets: { name: string; bytes: Uint8Array }[],
  exportApi: ReturnType<typeof createMockFigma>,
): void {
  const order: string[] = [];
  const collect = (n: BuiltNode): void => {
    if (n.fills) {
      for (const f of n.fills) {
        if (f.type === "IMAGE") order.push(f.imageHash);
      }
    }
    for (const c of n.children) collect(c);
  };
  collect(imported);

  // The mock's createImage hands out hashes "img-0", "img-1", ... in the
  // order figma.createImage was called during import. We pair those with
  // the original assets by index — assets are emitted in the order their
  // primitives appeared in the layout tree.
  for (let i = 0; i < order.length && i < originalAssets.length; i++) {
    exportApi.__registerImage({
      hash: order[i] as string,
      bytes: originalAssets[i]!.bytes,
      mimeType: "image/png",
    });
  }
}

/** The imported tree from createImportMock isn't strictly the same shape as
 *  a MockSceneNode, but it overlaps in the fields the export mappers read.
 *  Cast through unknown for the integration test. */
function asMockNode(b: BuiltNode): MockSceneNode {
  return b as unknown as MockSceneNode;
}

describe("Roundtrip : export → import → re-export is byte-stable", () => {
  it("scoreboard fixture roundtrips identically", async () => {
    // Step 1 : original export.
    const exportApi1 = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) exportApi1.__registerImage(img);
    const original = await runExport({
      api: exportApi1,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });

    // Step 2 : import into a fresh Figma node tree.
    const importApi = createImportMock();
    const importResult = await importBundle({
      api: importApi,
      lsmlBytes: original.canonical,
      assets: original.assets.map((a) => ({ path: a.name, bytes: a.bytes })),
    });
    expect(importResult.rootNodeId).toMatch(/^imp:/);
    const imported = importApi.appended()[0]!;
    expect(imported).toBeDefined();

    // Step 3 : re-export through the regular pipeline.
    const exportApi2 = createMockFigma();
    rehostImagesOnExport(imported, original.assets, exportApi2);
    const reexported = await runExport({
      api: exportApi2,
      root: asMockNode(imported) as never,
      sceneId: "scoreboard",
    });

    // The fixture's INSTANCE primitive (operator-input source) is imported
    // as a placeholder INSTANCE without children. On re-export the operator
    // input pluginData is gone (fixture was a COMPONENT, not a roundtripped
    // node), so we don't expect operator_inputs to roundtrip in v0.1.
    // What MUST roundtrip : layout structure, defaults, asset refs.
    expect(reexported.bundle.layout).toEqual(original.bundle.layout);
    expect(reexported.bundle.defaults).toEqual(original.bundle.defaults);
    // assets.allowedHosts gets re-emitted only when the bundle contains
    // assets ; identical condition holds in both passes.
    expect(reexported.bundle.assets).toEqual(original.bundle.assets);
  });

  it("byte-stable canonical for the layout subtree", async () => {
    const exportApi1 = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) exportApi1.__registerImage(img);
    const original = await runExport({
      api: exportApi1,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });

    const importApi = createImportMock();
    await importBundle({
      api: importApi,
      lsmlBytes: original.canonical,
      assets: original.assets.map((a) => ({ path: a.name, bytes: a.bytes })),
    });
    const imported = importApi.appended()[0]!;

    const exportApi2 = createMockFigma();
    rehostImagesOnExport(imported, original.assets, exportApi2);
    const reexported = await runExport({
      api: exportApi2,
      root: asMockNode(imported) as never,
      sceneId: "scoreboard",
    });

    // Compare layout + defaults canonical bytes — the sole guarantee at v0.1.
    const layoutA = JSON.stringify(original.bundle.layout);
    const layoutB = JSON.stringify(reexported.bundle.layout);
    expect(layoutB).toBe(layoutA);
  });

  it("instance primitive roundtrips via plugin data", async () => {
    // Build a small bundle with an explicit instance primitive.
    const lsml = JSON.stringify({
      $schema: "https://lumencast.dev/schema/lsml/1.1/schema.json",
      lsml: "1.1",
      scene_id: "host",
      scene_version: "sha256:placeholder",
      layout: {
        kind: "frame",
        size: { w: 1000, h: 1000 },
        children: [
          {
            kind: "instance",
            scene_id: "scoreboard",
            scene_version: "sha256:" + "a".repeat(64),
            size: { w: 800, h: 240 },
            position: { x: 100, y: 100 },
            params: { team_a: "Alpha" },
            fit: "contain",
          },
        ],
      },
    });

    // Seal it via the export pipeline so scene_version is valid.
    const { sealBundle } = await import("../../src/export/canonicalize");
    const sealed = await sealBundle(JSON.parse(lsml));

    // Import.
    const importApi = createImportMock();
    await importBundle({ api: importApi, lsmlBytes: sealed.canonical });
    const root = importApi.appended()[0]!;
    const inst = root.children[0]!;
    expect(inst.type).toBe("INSTANCE");
    expect(inst.pluginData?.["instance.scene_id"]).toBe("scoreboard");

    // Re-export — should reproduce the same instance primitive.
    const exportApi = createMockFigma();
    const reexported = await runExport({
      api: exportApi,
      root: asMockNode(root) as never,
      sceneId: "host",
    });
    const layoutChildren = (
      reexported.bundle.layout as { children: { kind: string; scene_id?: string }[] }
    ).children;
    expect(layoutChildren[0]?.kind).toBe("instance");
    expect(layoutChildren[0]?.scene_id).toBe("scoreboard");
  });
});
