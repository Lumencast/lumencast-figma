// Live one-shot: pull the REAL cover 817:3 over the Figma REST API and write
// the genuine LSML 1.2 bundle to a local (git-ignored) artefact.
//
// SKIPPED unless FIGMA_REST_TOKEN is set — so CI stays mock-only (ADR ZabCanvas
// 002 D3: the fidelity run is local/live, never gated in CI). Run it with the
// étage-1 secret sourced:
//
//   set -a; source /d/Documents/Lumencast/.env.figma-rest; set +a
//   pnpm test import-rest-live
//
// The output bundle + assets land in `.local-exports/` (git-ignored). They are
// LARGE (≥190 tiles + bitmaps) and MUST NOT be committed.

import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { importFigmaFrame } from "../../src/import-rest";

const FILE_KEY = "gtCekQzHW0eBqx4ATVRAAw";
const NODE_ID = "817:3";

const hasToken =
  typeof process.env.FIGMA_REST_TOKEN === "string" && process.env.FIGMA_REST_TOKEN !== "";

describe.skipIf(!hasToken)("import-rest LIVE — real cover 817:3", () => {
  it("pulls the real frame and writes a genuine bundle to .local-exports/", async () => {
    const { canonical, assets, bundle, adaptedRoot } = await importFigmaFrame(FILE_KEY, NODE_ID, {
      sceneId: "cover-817-3",
    });

    expect(bundle.lsml).toBe("1.2");
    expect(adaptedRoot.id).toBe(NODE_ID);
    // The real frame is 1920×1080 — the structural anchor.
    expect({ w: adaptedRoot.width, h: adaptedRoot.height }).toEqual({ w: 1920, h: 1080 });
    // Real assets resolved (not a single toy swatch).
    expect(assets.length).toBeGreaterThan(0);

    const outDir = resolve(process.cwd(), ".local-exports");
    await mkdir(resolve(outDir, "assets"), { recursive: true });
    await writeFile(resolve(outDir, "cover-817-3.lsml.json"), canonical, "utf8");
    for (const a of assets) {
      await writeFile(resolve(outDir, a.name), a.bytes);
    }
    console.log(`Wrote bundle + ${assets.length} assets to ${outDir}`);
  }, 120_000);
});
