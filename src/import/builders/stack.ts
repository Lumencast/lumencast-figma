// LSML stack → Figma FRAME with auto-layout.

import type { StackPrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportFrameNode } from "../figma-api";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
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
  _ctx: BuildContext,
): ImportFrameNode {
  const node = api.createFrame();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? "Stack";
  node.layoutMode = prim.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL";

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

  // Position : universal prop (LSML 1.1 §5.4). Auto-layout frames sit at
  // an absolute position inside their parent ; without this the imported
  // stack collapses to (0, 0) of its LSML parent.
  if (prim.position) {
    (node as unknown as { x?: number; y?: number }).x = prim.position.x;
    (node as unknown as { x?: number; y?: number }).y = prim.position.y;
  }
  return node;
}
