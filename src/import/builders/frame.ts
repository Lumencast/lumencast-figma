// LSML frame → Figma FRAME (no auto-layout). Children are appended by the
// orchestrator after each builder has produced its node ; this builder owns
// only the frame itself.

import type { FramePrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportFrameNode, ImportPaint } from "../figma-api";
import { cssToRgb } from "../color";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import { fillToPaint } from "../fill-to-paint";
import { applyImageBackgrounds } from "../image-backgrounds";
import type { BuildContext } from "./types";

export function buildFrame(
  prim: FramePrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportFrameNode {
  const node = api.createFrame();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? "Frame";

  // GROUP / BOOLEAN_OPERATION sources are queued by walk.ts AFTER its
  // children loop runs — that's when we can snapshot the children
  // references that will be passed to `figma.group()` in the post-pass.
  // Pushing here (before children exist) loses the snapshot; pushing
  // here AND in walk.ts duplicates the conversion. We push from one
  // place only : walk.ts.
  node.layoutMode = "NONE";

  // Apply size early : a fresh `figma.createFrame()` is 100×100, and we
  // want the source's dimensions on the node BEFORE any background /
  // child setters run, in case some of them depend on the bbox. Belt
  // -and-braces : we resize again at the end after applyFigmaExtras to
  // catch any intermediate setter that might have reset dimensions
  // (e.g. layoutSizingHorizontal/Vertical setters on root frames have
  // been observed to silently reset width to default 100).
  if (prim.size) {
    try {
      node.resize(prim.size.w, prim.size.h);
    } catch {
      // Tolerate — late resize below will retry.
    }
  }

  // `figma.createFrame()` returns a node with default white solid fill
  // and a black 1px stroke. The LSML model assumes transparent unless
  // a fill is declared, so we clear those defaults before re-applying
  // anything from the bundle. Without this every imported frame whose
  // source was transparent ends up with a visible white background +
  // black border that the legacy doesn't have.
  (node as unknown as { fills?: ImportPaint[] }).fills = [];
  (node as unknown as { strokes?: unknown[] }).strokes = [];

  // `clipsContent` : ALWAYS set to true during build, regardless of what
  // the bundle says. Children that extend beyond the placeholder's bbox
  // trigger Figma's auto-grow when clipsContent=false — bg-texture
  // (declared 1637x345 with Group 240 children spanning 857x1602)
  // ends up at ~2205x858 = the children-union bbox. Setting
  // clipsContent=true here PREVENTS the auto-grow entirely. We restore
  // the bundle's intended clipsContent value in the post-pass, after
  // all children + figma.group conversions have settled.
  const intendedClipsContent = prim.clipsContent ?? figmaMeta.clipsContent ?? true;
  (node as unknown as { clipsContent?: boolean }).clipsContent = true;
  if (intendedClipsContent !== true && ctx.clipsContentRestoreQueue) {
    ctx.clipsContentRestoreQueue.push({ node, clipsContent: intendedClipsContent });
  }

  // Position : universal prop (LSML 1.1 §5.4). v0.1 bundles stashed it
  // in `metadata.figma.position` ; we still read that as a fallback.
  const pos = prim.position ?? figmaMeta.position;
  if (pos) {
    node.x = pos.x;
    node.y = pos.y;
  }

  // Backgrounds. When the source captured raw gradient matrices in
  // `metadata.figma.gradientTransforms[]` (v0.2+), use those instead of
  // reconstructing from `angle_deg`.
  const transforms = figmaMeta.gradientTransforms ?? [];
  if (prim.backgrounds && prim.backgrounds.length > 0) {
    node.fills = prim.backgrounds
      .map((f, i) => fillToPaint(f, transforms[i] ?? null))
      .filter((p): p is ImportPaint => p !== null);
  } else if (prim.background !== undefined) {
    const rgb = cssToRgb(prim.background);
    if (rgb) {
      const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
      if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
      node.fills = [fill];
    }
  }

  // IMAGE backgrounds (avatar circles, hero banners, card images). Frames
  // can carry IMAGE fills that LSML's Fill type doesn't model — the
  // mapping side stashes them under `metadata.figma.imageBackgrounds[]`
  // with the asset path. Re-apply them as IMAGE paints, looked up via
  // ctx.assetMap. Stacked AFTER the LSML solid/gradient backgrounds so
  // the image paint sits on top (matches Figma's fills array semantics).
  applyImageBackgrounds(
    node as unknown as { fills?: ImportPaint[] },
    figmaMeta.imageBackgrounds,
    ctx.assetMap,
  );

  applyUniversal(node, prim);
  applyFigmaExtras(node, figmaMeta);

  // Apply size LAST. Some setters in applyFigmaExtras (notably the new
  // layoutSizingHorizontal / Vertical setters captured for fidelity)
  // confuse Figma's sizing system on non-auto-layout frames and reset
  // width/height to the createFrame default 100×100. Re-applying the
  // declared size at the very end guarantees the imported frame ends up
  // at source dimensions regardless of intermediate setter side-effects.
  if (prim.size) {
    try {
      node.resize(prim.size.w, prim.size.h);
    } catch {
      // Some node types or constraints reject resize ; tolerate so the
      // rest of the import succeeds.
    }
  }

  return node;
}

