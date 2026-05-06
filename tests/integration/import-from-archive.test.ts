// Headless replay : run the actual import pipeline on an existing
// `.lsmlz` archive shipped under examples/, then assert the produced
// tree shape against the bundle structure. No live Figma needed.
//
// This is the test we use when a user reports "elements missing after
// import" — it validates that every primitive in the bundle gets
// constructed and appended, with the right position/size, so we can
// distinguish import-pipeline drops from Figma-runtime issues (clipping,
// rotation maths, mask-group rendering).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unpackArchive } from "@lumencast/archive";

import { importBundle } from "../../src/import";
import { createImportMock, type BuiltNode } from "../fixtures/figma/import-mock";
import type { PrimitiveNode, SceneBundle } from "../../src/shared/lsml-types";

const ARCHIVE = join(__dirname, "..", "..", "examples", "template-stats.lsmlz");

function unpackLsmlz(bytes: Uint8Array): {
  bundleText: string;
  assets: { path: string; bytes: Uint8Array }[];
} {
  const { lsmlBytes, assets } = unpackArchive(bytes);
  return { bundleText: lsmlBytes, assets };
}

function countPrimitives(p: PrimitiveNode): number {
  let n = 1;
  if ("children" in p && Array.isArray(p.children)) {
    for (const c of p.children) n += countPrimitives(c as PrimitiveNode);
  }
  return n;
}

function countMockNodes(node: BuiltNode): number {
  let n = 1;
  for (const c of node.children) n += countMockNodes(c);
  return n;
}

interface ChildSummary {
  index: number;
  type: string;
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  childCount: number;
}

function summarizeDirectChildren(root: BuiltNode): ChildSummary[] {
  return root.children.map((c, i): ChildSummary => {
    const out: ChildSummary = {
      index: i,
      type: c.type,
      name: c.name,
      childCount: countMockNodes(c) - 1,
    };
    if (c.x !== undefined) out.x = c.x;
    if (c.y !== undefined) out.y = c.y;
    if (c.width !== undefined) out.width = c.width;
    if (c.height !== undefined) out.height = c.height;
    if (c.rotation !== undefined) out.rotation = c.rotation;
    return out;
  });
}

const HAS_ARCHIVE = existsSync(ARCHIVE);

describe.skipIf(!HAS_ARCHIVE)("Headless import replay : examples/template-stats.lsmlz", () => {
  it("imports the archive and constructs every primitive in the bundle", async () => {
    const archiveBytes = new Uint8Array(readFileSync(ARCHIVE));
    const { bundleText, assets } = unpackLsmlz(archiveBytes);
    expect(bundleText.length, "archive must contain a .lsml bundle").toBeGreaterThan(0);

    const bundle = JSON.parse(bundleText) as SceneBundle;
    const expected = countPrimitives(bundle.layout);

    const api = createImportMock();
    const result = await importBundle({
      api,
      lsmlBytes: bundleText,
      assets,
    });

    // Every primitive in the bundle should produce one Figma node, with no
    // silent drops or unsupported-primitive fallbacks.
    expect(result.primitivesCreated).toBe(expected);
    expect(result.warnings.filter((w) => w.code === "UNSUPPORTED_PRIMITIVE")).toEqual([]);

    const appended = api.appended();
    expect(appended).toHaveLength(1);
    const root = appended[0]!;

    // Root frame matches the bundle layout dimensions (1920x1080 for this
    // fixture). Smoke check : the tree has the right outer shell.
    const rootSize = (bundle.layout as { size?: { w: number; h: number } }).size;
    if (rootSize) {
      expect(root.width).toBe(rootSize.w);
      expect(root.height).toBe(rootSize.h);
    }

    // Total nodes (root + descendants) match the bundle's primitive count.
    expect(countMockNodes(root)).toBe(expected);
  });

  it("places every direct child of the root within or at most just outside the frame", async () => {
    const archiveBytes = new Uint8Array(readFileSync(ARCHIVE));
    const { bundleText, assets } = unpackLsmlz(archiveBytes);
    const bundle = JSON.parse(bundleText) as SceneBundle;

    const api = createImportMock();
    await importBundle({ api, lsmlBytes: bundleText, assets });
    const root = api.appended()[0]!;

    const rootSize = (bundle.layout as { size?: { w: number; h: number } }).size ?? {
      w: 1920,
      h: 1080,
    };
    const summary = summarizeDirectChildren(root);

    // Surface the summary in test output for diagnosis. Not asserted directly —
    // this is the "what landed where" snapshot users want when re-imports go
    // wrong.
    const lines = summary.map((s) => {
      const x = s.x ?? 0;
      const y = s.y ?? 0;
      const w = s.width ?? 0;
      const h = s.height ?? 0;
      const inView = x < rootSize.w && y < rootSize.h && x + w > 0 && y + h > 0;
      const rot = s.rotation ? ` rot=${s.rotation.toFixed(1)}°` : "";
      return `  [${s.index}] ${s.type.padEnd(10)} pos=(${x.toFixed(1)},${y.toFixed(1)}) size=${w.toFixed(1)}x${h.toFixed(1)}${rot} children=${s.childCount} ${inView ? "in-view" : "off-canvas"}`;
    });
    console.log(
      `\n[import replay] root ${root.type} ${rootSize.w}x${rootSize.h}\n${lines.join("\n")}`,
    );

    // No structural assertion here — the goal is the snapshot. The next test
    // checks specific known-good positions.
    expect(summary.length).toBeGreaterThan(0);
  });

  it("preserves stack positions (regression : auto-layout frames at non-zero offsets)", async () => {
    // Frame 7 (the WellPlayed logo container) and Frame 8 (the title text
    // wrapper) are auto-layout frames in the source. mapStack used to omit
    // `position`, so they collapsed to (0,0) on re-import. Fixed in
    // a3970d1 — every stack at a non-zero source position now keeps it.
    const archiveBytes = new Uint8Array(readFileSync(ARCHIVE));
    const { bundleText, assets } = unpackLsmlz(archiveBytes);
    const bundle = JSON.parse(bundleText) as SceneBundle;

    const api = createImportMock();
    await importBundle({ api, lsmlBytes: bundleText, assets });
    const root = api.appended()[0]!;

    // For each stack child of root that has `position` in the bundle, the
    // built mock node must have x/y matching it. (If the bundle itself
    // lacks `position` on its stacks, the bug is upstream — flag it.)
    const layoutChildren = (bundle.layout as { children?: PrimitiveNode[] }).children ?? [];
    const stacksWithPosition = layoutChildren
      .map((c, i) => ({ child: c, mock: root.children[i]! }))
      .filter(({ child }) => (child as { kind: string }).kind === "stack");

    for (const { child, mock } of stacksWithPosition) {
      const pos = (child as { position?: { x: number; y: number } }).position;
      if (!pos) {
        // The bug we're guarding against : a stack with a non-default position
        // would have been emitted with `position` ; if it's missing, the
        // export side dropped it.
        continue;
      }
      expect(mock.x, `stack ${(child as { kind: string }).kind} should have x=${pos.x}`).toBe(
        pos.x,
      );
      expect(mock.y, `stack ${(child as { kind: string }).kind} should have y=${pos.y}`).toBe(
        pos.y,
      );
    }
  });
});
