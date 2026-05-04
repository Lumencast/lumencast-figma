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
import { createImportTrace } from "./trace";
import type { ImportBaseNode, ImportFigmaApi } from "./figma-api";
import type { PendingGroupConversion } from "./builders/types";

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
  const trace = createImportTrace();
  const groupConversions: PendingGroupConversion[] = [];
  const ctx = {
    defaults: bundle.defaults ?? {},
    assetMap,
    warn(code: string, message: string) {
      warnings.push({ code, message });
    },
    trace,
    groupConversions,
  };
  const rootNode = buildPrimitive(bundle.layout, opts.api, ctx);
  reconcileAppend(opts.api, rootNode);

  // Post-pass : convert frames marked `metadata.figma.sourceType=GROUP`
  // back into real Figma GroupNodes. Walk in REVERSE of build order so
  // the deepest nested groups convert first — by the time we process an
  // outer group, its inner groups already exist as GroupNodes within it.
  if (groupConversions.length > 0) {
    console.warn(
      `[lumencast] import — converting ${groupConversions.length} placeholder frame(s) → real Figma groups`,
    );
    for (let i = groupConversions.length - 1; i >= 0; i--) {
      const entry = groupConversions[i]!;
      try {
        convertFrameToGroup(entry.frame, opts.api);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[lumencast] group conversion failed: ${msg}`);
        warnings.push({
          code: "GROUP_CONVERSION_FAILED",
          message: `Could not convert placeholder frame to real GroupNode : ${msg}`,
        });
      }
    }
  }

  const expected = countPrimitives(bundle.layout);
  const buildFailures = warnings.filter(
    (w) => w.code === "IMPORT_BUILD_FAILED" || w.code === "IMPORT_APPEND_FAILED",
  ).length;
  const built = expected - buildFailures;
  console.warn(
    `[lumencast] import step 4/4 done — root id: ${rootNode.id} ; built ${built}/${expected} primitives, ${buildFailures} failed`,
  );

  const result: ImportResult = {
    rootNodeId: rootNode.id,
    primitivesCreated: built,
    warnings,
    debugArtefacts: {
      importTrace: JSON.stringify(
        {
          summary: { expected, built, failed: buildFailures },
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

function countPrimitives(node: PrimitiveNode): number {
  let n = 1;
  if ("children" in node && Array.isArray(node.children)) {
    for (const c of node.children) n += countPrimitives(c);
  }
  return n;
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

/** Replace a placeholder FrameNode with a real Figma GroupNode wrapping the
 *  same children. We rely on `figma.group(children, parent, index)` which
 *  MOVES the children into a fresh group inserted at `index` of `parent`.
 *  Figma's API auto-translates relative coords when nodes change parent,
 *  so the visual result matches the source's group rendering. */
function convertFrameToGroup(frame: ImportBaseNode, api: ImportFigmaApi): void {
  const f = frame as unknown as GroupConversionFrame;
  const parent = f.parent;
  if (!parent || !parent.children) {
    throw new Error("placeholder frame has no parent — cannot convert to GroupNode");
  }
  const children = f.children ? [...f.children] : [];
  if (children.length === 0) {
    // Empty group — leave the frame as-is. (Figma rejects creating an
    // empty group and a 0-child placeholder is rare in practice.)
    return;
  }
  const index = parent.children.indexOf(frame);
  const group = api.group(children, parent, index >= 0 ? index : undefined);
  // Restore the source layer name — figma.group() defaults to "Group" + n.
  (group as unknown as { name: string }).name = f.name;
  // Remove the now-empty placeholder.
  if (typeof f.remove === "function") {
    f.remove();
  } else if (parent.children) {
    const i = parent.children.indexOf(frame);
    if (i >= 0) parent.children.splice(i, 1);
  }
}

export { parseBundle } from "./parse";
export { embedAssets } from "./assets";
export { buildPrimitive } from "./walk";
