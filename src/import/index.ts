// Public API of the import pipeline (LSML bundle → Figma node tree).
//
// Caller (typically `src/main/index.ts` on a `request-import` message) :
//   1. Reads the .lsml bytes + an optional bag of `assets/<sha256>.<ext>` bytes
//      via the UI's file picker.
//   2. Calls `importBundle({ api, lsmlBytes, assets })` here.
//   3. Surfaces the resulting ImportResult (root node id, primitives created,
//      warnings) in the UI.

import type { PrimitiveNode } from "~shared/lsml-types";
import type { ImportResult, PluginWarning } from "../main/messages";
import { parseBundle } from "./parse";
import { embedAssets, type AssetByteSource } from "./assets";
import { buildPrimitive } from "./walk";
import { reconcileAppend } from "./reconcile";
import { collectFonts, preloadFonts } from "./fonts";
import type { ImportFigmaApi } from "./figma-api";

export interface ImportBundleOptions {
  api: ImportFigmaApi;
  /** Raw `.lsml` bundle bytes (or text). */
  lsmlBytes: string | Uint8Array;
  /** Per-asset bytes — keyed by the bundle-side path (`assets/<sha256>.<ext>`). */
  assets?: AssetByteSource[];
}

export async function importBundle(opts: ImportBundleOptions): Promise<ImportResult> {
  const warnings: PluginWarning[] = [];

  console.warn("[lumencast] import step 1/4 — parseBundle");
  const bundle = await parseBundle(opts.lsmlBytes);
  console.warn("[lumencast] import step 1/4 done — scene_id:", bundle.scene_id);

  console.warn("[lumencast] import step 2/4 — preload fonts");
  const fonts = collectFonts(bundle.layout);
  console.warn(
    "[lumencast] import step 2/4 — fonts to load:",
    fonts.map((f) => `${f.family}/${f.style}`).join(", "),
  );
  await preloadFonts(opts.api, fonts, (code, message) => {
    warnings.push({ code, message });
  });
  console.warn("[lumencast] import step 2/4 done");

  console.warn("[lumencast] import step 3/4 — embed assets:", opts.assets?.length ?? 0);
  const { assetMap } = embedAssets(opts.api, opts.assets ?? []);
  console.warn("[lumencast] import step 3/4 done");

  console.warn("[lumencast] import step 4/4 — build primitive tree");
  const ctx = {
    defaults: bundle.defaults ?? {},
    assetMap,
    warn(code: string, message: string) {
      warnings.push({ code, message });
    },
  };
  const rootNode = buildPrimitive(bundle.layout, opts.api, ctx);
  reconcileAppend(opts.api, rootNode);

  const expected = countPrimitives(bundle.layout);
  const buildFailures = warnings.filter(
    (w) => w.code === "IMPORT_BUILD_FAILED" || w.code === "IMPORT_APPEND_FAILED",
  ).length;
  const built = expected - buildFailures;
  console.warn(
    `[lumencast] import step 4/4 done — root id: ${rootNode.id} ; built ${built}/${expected} primitives, ${buildFailures} failed`,
  );

  return {
    rootNodeId: rootNode.id,
    primitivesCreated: built,
    warnings,
  };
}

function countPrimitives(node: PrimitiveNode): number {
  let n = 1;
  if ("children" in node && Array.isArray(node.children)) {
    for (const c of node.children) n += countPrimitives(c);
  }
  return n;
}

export { parseBundle } from "./parse";
export { embedAssets } from "./assets";
export { buildPrimitive } from "./walk";
