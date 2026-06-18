// Live structural-diff run for the real cover 817:3 (ADR ZabCanvas 002 RC2).
//
// SKIPPED unless FIGMA_REST_TOKEN is set — CI stays mock-only (D3: the fidelity
// run is local/live, never gated in CI). Run with the étage-1 secret sourced:
//
//   set -a; source /d/Documents/Lumencast/.env.figma-rest; set +a
//   pnpm test structural-diff-817.live
//
// It pulls the REAL REST tree, builds the bundle, runs `structuralDiff`, writes
// the divergence list to `.local-exports/structural-diff-817.json` (git-ignored)
// and FAILS while any divergence remains. RC2 is met when the list is empty.

import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { importFigmaFrame } from "../../src/import-rest";
import { createFigmaRestClient } from "../../src/import-rest/client";
import {
  structuralDiff,
  summarizeDiff,
  type LsmlNode,
} from "../../src/import-rest/structural-diff";

const FILE_KEY = "gtCekQzHW0eBqx4ATVRAAw";
const NODE_ID = "817:3";
const hasToken =
  typeof process.env.FIGMA_REST_TOKEN === "string" && process.env.FIGMA_REST_TOKEN !== "";

describe.skipIf(!hasToken)("structural-diff LIVE — real cover 817:3 (RC2)", () => {
  it("REST tree and LSML bundle are structurally identical (diff = 0)", async () => {
    const client = createFigmaRestClient();
    const restRoot = await client.getNode(FILE_KEY, NODE_ID);
    const { bundle } = await importFigmaFrame(FILE_KEY, NODE_ID, {
      client,
      sceneId: "cover-817-3",
    });

    const defaults = bundle.defaults as Record<string, unknown> | undefined;
    const divs = structuralDiff(
      restRoot,
      bundle.layout as unknown as LsmlNode,
      defaults ? { defaults } : {},
    );

    const outDir = resolve(process.cwd(), ".local-exports");
    await mkdir(outDir, { recursive: true });
    await writeFile(
      resolve(outDir, "structural-diff-817.json"),
      JSON.stringify(
        { summary: summarizeDiff(divs), total: divs.length, divergences: divs },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`structural-diff: ${divs.length} divergence(s)`, summarizeDiff(divs));
    if (divs.length > 0) {
      for (const d of divs.slice(0, 40)) {
        console.log(`  [${d.kind}] ${d.figmaId} "${d.name}" @${d.path}`, {
          expected: d.expected,
          actual: d.actual,
        });
      }
    }

    expect(
      divs,
      `structural-diff must be empty for RC2 — see .local-exports/structural-diff-817.json`,
    ).toEqual([]);
  }, 120_000);
});
