// Public API of the import pipeline (LSML bundle → Figma node tree).
//
// Caller (typically `src/main/index.ts` on a `request-import` message) :
//   1. Reads the .lsml bytes + an optional bag of `assets/<sha256>.<ext>` bytes
//      via the UI's file picker.
//   2. Calls `importBundle({ api, lsmlBytes, assets })` here.
//   3. Surfaces the resulting ImportResult (root node id, primitives created,
//      warnings) in the UI.

import type { ImportResult, PluginWarning } from "../main/messages";
import { parseBundle } from "./parse";
import { embedAssets, type AssetByteSource } from "./assets";
import { buildPrimitive } from "./walk";
import { reconcileAppend } from "./reconcile";
import { collectFonts, preloadFonts } from "./fonts";
import { createImportTrace } from "./trace";
import type { ImportBaseNode, ImportFigmaApi } from "./figma-api";

export interface ImportBundleOptions {
  api: ImportFigmaApi;
  /** Raw `.lsml` bundle bytes (or text). */
  lsmlBytes: string | Uint8Array;
  /** Per-asset bytes — keyed by the bundle-side path (`assets/<sha256>.<ext>`). */
  assets?: AssetByteSource[];
  /** Capture per-node trace + emit `debugArtefacts.importTrace` JSON in the
   *  result. Off by default : on a 8000-primitive bundle the trace push +
   *  pretty-print add 5-15s of pure overhead and ~10MB of heap. Flip on
   *  when the user explicitly opts in via the UI (Diagnostics toggle). */
  captureDebugArtefacts?: boolean;
}

export async function importBundle(opts: ImportBundleOptions): Promise<ImportResult> {
  const warnings: PluginWarning[] = [];

  const bundle = await parseBundle(opts.lsmlBytes);

  const fonts = collectFonts(bundle.layout);
  await preloadFonts(opts.api, fonts, (code, message) => {
    warnings.push({ code, message });
  });

  const { assetMap } = embedAssets(opts.api, opts.assets ?? []);

  // Trace is ALWAYS created : the per-node push is trivially cheap and
  // the trace is the only persistent record of warnings + diagnostics
  // (e.g. VECTOR_PATHS_REJECTED). The user wants every event in the
  // archive — `_debug/import-trace.json` is that archive. We don't gate
  // on `captureDebugArtefacts` anymore : the heavy bit was the per-node
  // console.warn (already removed) + the snapshot (export side, still
  // opt-in for raw-figma.json).
  const trace = createImportTrace();
  // `built` is incremented by every successful builder dispatch in walk.ts
  // — saves a second full walk over the tree at the end of the import to
  // count primitives. `expected` would otherwise be `countPrimitives` (a
  // recursive scan) ; we now derive it from `built + buildFailures`.
  const counter = { built: 0, expected: 0 };
  const clipsContentRestoreQueue: { node: ImportBaseNode; clipsContent: boolean }[] = [];
  const ctx = {
    defaults: bundle.defaults ?? {},
    assetMap,
    warn(code: string, message: string) {
      warnings.push({ code, message });
    },
    trace,
    counter,
    clipsContentRestoreQueue,
  };
  const rootNode = buildPrimitive(bundle.layout, opts.api, ctx);

  // Restore `clipsContent=false` on Frames whose source had it false.
  // We force `true` during build to prevent auto-grow on Frames with
  // children extending past their bbox (inline figma.group() calls in
  // the build can also propagate bboxes up the ancestor chain). Once
  // the build is complete, flipping back to false preserves the
  // source's overflow-visible semantics without re-triggering auto-grow.
  for (const entry of clipsContentRestoreQueue) {
    try {
      (entry.node as unknown as { clipsContent?: boolean }).clipsContent = entry.clipsContent;
    } catch {
      // Tolerate.
    }
  }

  reconcileAppend(opts.api, rootNode);

  const buildFailures = warnings.filter(
    (w) => w.code === "IMPORT_BUILD_FAILED" || w.code === "IMPORT_APPEND_FAILED",
  ).length;
  const vectorPathFailures = warnings.filter((w) => w.code === "VECTOR_PATHS_REJECTED").length;
  const built = counter.built;
  const expected = built + buildFailures;

  const result: ImportResult = {
    rootNodeId: rootNode.id,
    primitivesCreated: built,
    warnings,
    debugArtefacts: {
      importTrace: JSON.stringify(
        {
          summary: {
            expected,
            built,
            failed: buildFailures,
            vectorPathRejected: vectorPathFailures,
          },
          warnings,
          entries: trace.entries,
        },
        null,
        2,
      ),
    },
  };
  return result;
}

export { parseBundle } from "./parse";
export { embedAssets } from "./assets";
export { buildPrimitive } from "./walk";
