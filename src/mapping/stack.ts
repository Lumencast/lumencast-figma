// Figma FRAME with auto-layout → LSML `stack` (§4.1).

import type { Fill, StackPrimitive } from "~shared/lsml-types";
import { paintToFill, rawGradientTransform, type FigmaPaint } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { asArray, asNumber, asString } from "./figma-mixed";
import { withFigmaMetadata, type FigmaImageBackground } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import { capturePaintExtras } from "./image";
import type { MappingContext, MappingResult } from "./types";

export interface StackMapInput {
  type: "FRAME" | "COMPONENT" | "INSTANCE";
  id: string;
  name: string;
  width: number;
  height: number;
  /** Position relative to the parent's coordinate origin. Resolved against
   *  `opts.parentX/parentY` to produce the LSML `position` universal prop. */
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  layoutMode: "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: "NO_WRAP" | "WRAP";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}

export interface StackMapOptions {
  parentX?: number;
  parentY?: number;
  parentRotation?: number;
}

const PRIMARY_JUSTIFY: Record<string, StackPrimitive["justify"]> = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  SPACE_BETWEEN: "space-between",
};

const COUNTER_ALIGN: Record<string, StackPrimitive["align"]> = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  BASELINE: "start", // Approximation — LSML 1.1 has no baseline.
};

export function mapStack(
  node: StackMapInput,
  children: StackPrimitive["children"],
  opts?: StackMapOptions,
  ctx?: MappingContext,
): MappingResult {
  const parsed = parseLayerName(node.name, { primitiveKind: "stack" });

  const prim: StackPrimitive = {
    kind: "stack",
    direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    children,
    ...extractUniversal(node, { parentRotation: opts?.parentRotation ?? 0 }),
  };

  // Universal `position` (LSML §5.4) — auto-layout frames still sit at
  // an absolute position inside their parent. Compute relative to the
  // closest coord-system ancestor's origin (passed in via opts).
  const px = asNumber(node.x) ?? 0;
  const py = asNumber(node.y) ?? 0;
  const parentX = opts?.parentX ?? 0;
  const parentY = opts?.parentY ?? 0;
  const relX = roundTo3(px - parentX);
  const relY = roundTo3(py - parentY);
  if (relX !== 0 || relY !== 0) prim.position = { x: relX, y: relY };

  const itemSpacing = asNumber(node.itemSpacing);
  if (itemSpacing !== undefined && itemSpacing !== 0) {
    prim.gap = roundTo3(itemSpacing);
  }
  if (node.layoutWrap === "WRAP") {
    prim.wrap = true;
    const cas = asNumber(node.counterAxisSpacing);
    if (cas !== undefined && cas !== 0) {
      prim.crossGap = roundTo3(cas);
    }
  }

  const primaryAxis = asString(node.primaryAxisAlignItems);
  const justify = primaryAxis ? PRIMARY_JUSTIFY[primaryAxis] : undefined;
  if (justify && justify !== "start") prim.justify = justify;

  const counterAxis = asString(node.counterAxisAlignItems);
  const align = counterAxis ? COUNTER_ALIGN[counterAxis] : undefined;
  if (align && align !== "start") prim.align = align;

  const padding = computePadding(node);
  if (padding !== undefined) prim.padding = padding;

  // Backgrounds map to `metadata` for stacks — LSML 1.1 stack has no
  // native background field. SOLID + GRADIENT round-trip via the legacy
  // `metadata.figmaFills` slot ; IMAGE fills go to `metadata.figma.imageBackgrounds`
  // alongside the asset registry registration so bytes are bundled.
  //
  // Gradient transforms : we capture the raw 2x3 matrix per gradient
  // fill into `metadata.figma.gradientTransforms[]` (same convention as
  // frame). Without it, the import's `fillToPaint` reconstructs a pure
  // rotation matrix with unit length + zero translation — fine for an
  // edge-to-edge gradient, but loses the source's gradient-line bounds
  // when the source applied a custom handle (e.g. a button gradient
  // that only covers ~30% of the height : Figma stops at 0.31/0.75 along
  // a SHORT gradient line, but without the transform Figma re-applies
  // the stops to a FULL-LENGTH line and the visible gradient blows
  // out — second stop ends up at >100% and the whole button looks solid).
  const fillsArr = asArray<FigmaPaint>(node.fills) ?? [];
  const visibleNonImage = fillsArr.filter(
    (p) => p.type === "SOLID" || p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL",
  );
  const fills: Fill[] = [];
  const gradientTransforms: (number[][] | null)[] = [];
  for (const paint of visibleNonImage) {
    const fill = paintToFill(paint);
    if (fill === null) continue;
    fills.push(fill);
    gradientTransforms.push(rawGradientTransform(paint));
  }
  if (fills.length > 0) {
    prim.metadata = { ...(prim.metadata ?? {}), figmaFills: fills };
    if (gradientTransforms.some((t) => t !== null)) {
      withFigmaMetadata(prim, { gradientTransforms });
    }
  }
  const imageAssetRefs: string[] = [];
  const imageBackgrounds: FigmaImageBackground[] = [];
  if (ctx?.registerImageHash) {
    for (const paint of fillsArr) {
      if (paint.type !== "IMAGE") continue;
      const hash = (paint as unknown as { imageHash?: unknown }).imageHash;
      if (typeof hash !== "string" || hash === "") continue;
      const src = ctx.registerImageHash(hash);
      const extras = capturePaintExtras(paint) ?? {};
      imageBackgrounds.push({ ...extras, src });
      imageAssetRefs.push(hash);
    }
  }
  if (imageBackgrounds.length > 0) {
    withFigmaMetadata(prim, { imageBackgrounds });
  }

  if (parsed.bind) prim.bind = parsed.bind;
  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  // Capture the source's explicit dimensions when either axis is FIXED.
  // LSML's stack has no native size field, so the import side restores
  // them via metadata.figma.size + node.resize() after re-applying the
  // sizing modes captured by captureFigmaExtras. HUG-only frames don't
  // need this — Figma re-derives the size from the content.
  const lsh = asString(node.layoutSizingHorizontal);
  const lsv = asString(node.layoutSizingVertical);
  if (lsh === "FIXED" || lsv === "FIXED") {
    const w = asNumber(node.width);
    const h = asNumber(node.height);
    if (w !== undefined && h !== undefined) {
      withFigmaMetadata(prim, { size: { w: roundTo3(w), h: roundTo3(h) } });
    }
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim, {
    localPosition: prim.position ?? { x: 0, y: 0 },
  });

  const result: MappingResult = { node: prim };
  if (imageAssetRefs.length > 0) result.assetRefs = imageAssetRefs;
  return result;
}

function computePadding(node: StackMapInput): StackPrimitive["padding"] {
  const t = asNumber(node.paddingTop) ?? 0;
  const r = asNumber(node.paddingRight) ?? 0;
  const b = asNumber(node.paddingBottom) ?? 0;
  const l = asNumber(node.paddingLeft) ?? 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  if (t === r && r === b && b === l) return roundTo3(t);
  return [roundTo3(t), roundTo3(r), roundTo3(b), roundTo3(l)];
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
