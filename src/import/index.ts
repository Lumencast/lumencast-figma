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
import type { PendingGroupConversion } from "./builders/types";

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
  const groupConversions: PendingGroupConversion[] = [];
  // `built` is incremented by every successful builder dispatch in walk.ts
  // — saves a second full walk over the tree at the end of the import to
  // count primitives. `expected` would otherwise be `countPrimitives` (a
  // recursive scan) ; we now derive it from `built + buildFailures`.
  const counter = { built: 0, expected: 0 };
  const frameResizeQueue: { node: ImportBaseNode; w: number; h: number }[] = [];
  const clipsContentRestoreQueue: { node: ImportBaseNode; clipsContent: boolean }[] = [];
  const ctx = {
    defaults: bundle.defaults ?? {},
    assetMap,
    warn(code: string, message: string) {
      warnings.push({ code, message });
    },
    trace,
    groupConversions,
    counter,
    frameResizeQueue,
    clipsContentRestoreQueue,
  };
  const rootNode = buildPrimitive(bundle.layout, opts.api, ctx);

  // Post-pass : convert placeholder Frames marked
  // `metadata.figma.sourceType=GROUP` back into real Figma GroupNodes,
  // BEFORE mounting to currentPage. Running while the tree is still
  // orphan side-steps a dynamic-page-mode bug where figma.group() on
  // mounted nodes silently corrupts children. Reverse iteration =
  // deepest first.
  if (groupConversions.length > 0) {
    for (let i = groupConversions.length - 1; i >= 0; i--) {
      const entry = groupConversions[i]!;
      try {
        convertFrameToGroup(entry, opts.api, (code, message) => {
          warnings.push({ code, message });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          code: "GROUP_CONVERSION_FAILED",
          message: `Could not convert placeholder frame to real GroupNode : ${msg}`,
        });
      }
    }
  }

  // Re-resize Frames AFTER all group conversions. The figma.group()
  // calls in the post-pass insert new Group nodes whose bboxes can
  // propagate up the ancestor chain and trigger Figma's auto-grow on
  // every Frame ancestor. Walk the queue (built in walk.ts at the
  // moment each Frame's children loop completed) and re-clamp each
  // Frame to its declared `prim.size`. The first resize during walk
  // was correct WHEN it ran — we just need to re-assert after the
  // group conversions disturbed everything.
  for (const entry of frameResizeQueue) {
    try {
      (entry.node as unknown as { resize(w: number, h: number): void }).resize(
        entry.w,
        entry.h,
      );
    } catch {
      // Tolerate — nodes that reject resize stay at whatever size Figma
      // settled on after the group conversions.
    }
  }

  // Restore `clipsContent=false` on Frames whose source had it false.
  // We forced `true` during build to prevent auto-grow on Frames with
  // children extending past their bbox ; flipping back to false now
  // (bbox is locked in) preserves the source's overflow-visible
  // semantics without re-triggering auto-grow.
  for (const entry of clipsContentRestoreQueue) {
    try {
      (entry.node as unknown as { clipsContent?: boolean }).clipsContent =
        entry.clipsContent;
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

type GroupConversionParent = ImportBaseNode & {
  children?: ImportBaseNode[];
  appendChild(child: ImportBaseNode): void;
};

type GroupConversionFrame = ImportBaseNode & {
  name: string;
  children?: ImportBaseNode[];
  parent?: GroupConversionParent;
  remove?(): void;
};

function convertFrameToGroup(
  entry: PendingGroupConversion,
  api: ImportFigmaApi,
  warn: (code: string, message: string) => void,
): void {
  const frame = entry.frame;
  const f = frame as unknown as GroupConversionFrame;
  const parent = f.parent;
  if (!parent || !parent.children) {
    throw new Error("placeholder frame has no parent — cannot convert to GroupNode");
  }
  // Read CURRENT children at conversion time (live, not the build-time
  // snapshot). Inner conversions in reverse-iteration order replace
  // child Frame placeholders with new GroupNodes ; the snapshot would
  // be stale for outer groups.
  const liveChildren = f.children ? [...f.children] : [];
  const children = liveChildren.length > 0 ? liveChildren : entry.children;
  if (children.length === 0) return;

  const index = parent.children.indexOf(frame);
  const expectedChildCount = children.length;
  const group = api.group(children, parent, index >= 0 ? index : undefined);
  (group as unknown as { name: string }).name = f.name;

  // `figma.group()` returns a fresh GroupNode whose properties are all
  // defaults — the placeholder Frame's `applyFigmaExtras`-applied state
  // (isMask, blendMode, opacity, effects, constraints, …) is silently
  // dropped. Without this transfer, a Group source whose first child
  // was a mask comes back as an unmasked group : `bg-texture` stops
  // clipping its texture/Group240 siblings and Figma reports its bbox
  // as the children-union (~2200×850) instead of the masked region
  // (1637×345). Mirror the keys `applyFigmaExtras` writes — anything
  // the host GroupNode rejects is swallowed by the per-key try/catch.
  // `relativeTransform` is intentionally NOT transferred : we drop it
  // from the placeholder for GROUP sourceType in `buildFrame` (would
  // propagate to children at build time), and the new Group's own
  // transform is set by figma.group() to fit the children-bbox.
  transferGroupishProperties(frame, group);

  const groupChildrenAfter =
    (group as unknown as { children?: ImportBaseNode[] }).children?.length ?? 0;
  if (groupChildrenAfter < expectedChildCount) {
    const groupAppender = group as unknown as {
      appendChild?: (child: ImportBaseNode) => void;
    };
    if (typeof groupAppender.appendChild === "function") {
      for (const child of children) {
        try {
          groupAppender.appendChild(child);
        } catch {
          // Tolerate.
        }
      }
    }
    const recoveredCount =
      (group as unknown as { children?: ImportBaseNode[] }).children?.length ?? 0;
    if (recoveredCount < expectedChildCount) {
      warn(
        "GROUP_CONVERSION_LOST_CHILDREN",
        `figma.group() returned a GroupNode with ${recoveredCount}/${expectedChildCount} children for "${f.name}".`,
      );
    }
  }

  if (typeof f.remove === "function") {
    f.remove();
  } else if (parent.children) {
    const i = parent.children.indexOf(frame);
    if (i >= 0) parent.children.splice(i, 1);
  }
}

/** Keys that `applyFigmaExtras` (and `applyUniversal`) write onto a
 *  Frame placeholder during build, and that should survive the
 *  `figma.group()` conversion onto the resulting GroupNode. Excluded
 *  on purpose : `name` (transferred above), `relativeTransform` /
 *  `x` / `y` (figma.group() owns the new Group's position), `width`
 *  / `height` (Group sizing is auto, derived from children + mask),
 *  `clipsContent` (Groups don't clip), `fills` / `strokes` (Groups
 *  don't paint). */
const GROUPISH_PROPERTY_KEYS = [
  "isMask",
  "maskType",
  "blendMode",
  "opacity",
  "visible",
  "effects",
  "constraints",
  "layoutAlign",
  "layoutGrow",
  "layoutPositioning",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
] as const;

function transferGroupishProperties(from: ImportBaseNode, to: ImportBaseNode): void {
  const src = from as unknown as Record<string, unknown>;
  const dst = to as unknown as Record<string, unknown>;
  for (const key of GROUPISH_PROPERTY_KEYS) {
    const value = src[key];
    if (value === undefined) continue;
    try {
      dst[key] = value;
    } catch {
      // Real Figma rejects properties that aren't valid for GroupNode
      // (e.g. layoutSizingHorizontal on a Group inside a non-auto-layout
      // parent). Silently skip — visual fidelity for that one key is
      // forfeited but the rest of the transfer succeeds.
    }
  }
}

export { parseBundle } from "./parse";
export { embedAssets } from "./assets";
export { buildPrimitive } from "./walk";
