// LSML stack → Figma FRAME with auto-layout.

import type { Fill, StackPrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportFrameNode, ImportPaint } from "../figma-api";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import { fillToPaint } from "../fill-to-paint";
import { applyImageBackgrounds } from "../image-backgrounds";
import type { BuildContext } from "./types";

const JUSTIFY_MAP: Record<string, ImportFrameNode["primaryAxisAlignItems"]> = {
  start: "MIN",
  center: "CENTER",
  end: "MAX",
  "space-between": "SPACE_BETWEEN",
  "space-around": "SPACE_BETWEEN", // Figma has no SPACE_AROUND ; closest fit.
};

const ALIGN_MAP: Record<string, ImportFrameNode["counterAxisAlignItems"]> = {
  start: "MIN",
  center: "CENTER",
  end: "MAX",
  stretch: "MIN", // Figma uses sizing FILL on children rather than a counter alignment.
};

export function buildStack(
  prim: StackPrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportFrameNode {
  const node = api.createFrame();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? "Stack";
  node.layoutMode = prim.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL";

  // Resize as soon as auto-layout is set + BEFORE any sizing-mode setter
  // runs. Figma's `node.resize(w, h)` on an auto-layout frame behaves
  // atomically : if either axis is HUG (the default counter-axis sizing
  // for many auto-layout frames), the call may be rejected entirely and
  // BOTH dimensions stay at the createFrame default (100×100). The fix
  // is to force both axes to FIXED first (so resize succeeds), then let
  // `applyFigmaExtras` restore the source's actual sizing modes — HUG
  // axes will re-derive their dim from content once children are
  // appended. Without this, a stack captured as 1440×2187 (FIXED width
  // + HUG height) re-imports as 100×<auto-grown> and the entire layout
  // collapses horizontally.
  if (figmaMeta.size) {
    try {
      (node as unknown as { layoutSizingHorizontal?: string }).layoutSizingHorizontal = "FIXED";
    } catch {
      // Tolerate.
    }
    try {
      (node as unknown as { layoutSizingVertical?: string }).layoutSizingVertical = "FIXED";
    } catch {
      // Tolerate.
    }
    try {
      node.resize(figmaMeta.size.w, figmaMeta.size.h);
    } catch {
      // Tolerate — fall through to the late resize below.
    }
  }

  // `figma.createFrame()` returns a node with default white solid fill +
  // black 1px stroke. LSML stacks are transparent by default ; clear
  // both so the imported tree doesn't pick up phantom backgrounds and
  // borders the source never had. The stack mapping side stashes the
  // source's actual fills under `metadata.figmaFills` (LSML stack has
  // no native background field) — re-apply them below if present.
  (node as unknown as { fills?: ImportPaint[] }).fills = [];
  (node as unknown as { strokes?: unknown[] }).strokes = [];

  // Restore the source background captured by mapStack — without this
  // every imported stack loses its solid / gradient background (e.g. a
  // header with `bg-[#040404]` re-imports as a transparent frame).
  // The mapping side writes under `prim.metadata.figmaFills` directly
  // (root-level metadata, not under `.figma.*`) for back-compat with
  // already-exported bundles ; we read at that path.
  const figmaFillsRaw = (prim as { metadata?: { figmaFills?: unknown } }).metadata?.figmaFills;
  if (Array.isArray(figmaFillsRaw) && figmaFillsRaw.length > 0) {
    // Pull the parallel gradientTransforms[] captured by mapStack — each
    // entry is the source's raw 2x3 affine matrix for a gradient fill,
    // null for solids. fillToPaint uses this matrix verbatim when
    // present ; without it gradient stops re-render against a default
    // unit-length rotation matrix and the visible bounds drift (e.g. a
    // button gradient with stops 31%/75% on a custom handle becomes
    // 100%/183% on a full-edge line, blowing out the second stop).
    const transforms = figmaMeta.gradientTransforms ?? [];
    const paints = (figmaFillsRaw as Fill[])
      .map((f, i) => fillToPaint(f, transforms[i] ?? null))
      .filter((p): p is ImportPaint => p !== null);
    if (paints.length > 0) {
      (node as unknown as { fills?: ImportPaint[] }).fills = paints;
    }
  }

  // IMAGE backgrounds — same pattern as buildFrame. Avatar circles, hero
  // banners, etc. go through this path when the source frame had an
  // IMAGE paint as its background. The LSML side has no native model
  // for image fills on a stack, so the export stashes them under
  // metadata.figma.imageBackgrounds with content-addressed asset paths.
  applyImageBackgrounds(
    node as unknown as { fills?: ImportPaint[] },
    figmaMeta.imageBackgrounds,
    ctx.assetMap,
  );

  if (prim.gap !== undefined) node.itemSpacing = prim.gap;
  if (prim.wrap === true) {
    node.layoutWrap = "WRAP";
    if (prim.crossGap !== undefined) node.counterAxisSpacing = prim.crossGap;
  }
  if (prim.justify) {
    const j = JUSTIFY_MAP[prim.justify];
    if (j) node.primaryAxisAlignItems = j;
  }
  if (prim.align) {
    const a = ALIGN_MAP[prim.align];
    if (a) node.counterAxisAlignItems = a;
  }

  // Padding : number → uniform, [t, r, b, l] → per-side.
  if (typeof prim.padding === "number") {
    node.paddingTop = prim.padding;
    node.paddingRight = prim.padding;
    node.paddingBottom = prim.padding;
    node.paddingLeft = prim.padding;
  } else if (Array.isArray(prim.padding) && prim.padding.length === 4) {
    const [t, r, b, l] = prim.padding;
    node.paddingTop = t;
    node.paddingRight = r;
    node.paddingBottom = b;
    node.paddingLeft = l;
  }

  applyUniversal(node, prim);
  applyFigmaExtras(node, figmaMeta);

  // Defensive late resize : re-apply size after applyFigmaExtras has
  // restored the source's layoutSizing modes. For axes the source had
  // as HUG, this resize call is a no-op (Figma keeps the auto-derived
  // dim). For FIXED axes, this re-asserts the captured dim in case any
  // intermediate setter clobbered it. Belt-and-braces with the early
  // resize above.
  if (figmaMeta.size) {
    try {
      node.resize(figmaMeta.size.w, figmaMeta.size.h);
    } catch {
      // HUG axes reject resize ; tolerate.
    }
  }

  // Position : universal prop (LSML 1.1 §5.4). Auto-layout frames sit at
  // an absolute position inside their parent ; without this the imported
  // stack collapses to (0, 0) of its LSML parent.
  if (prim.position) {
    (node as unknown as { x?: number; y?: number }).x = prim.position.x;
    (node as unknown as { x?: number; y?: number }).y = prim.position.y;
  }
  return node;
}
