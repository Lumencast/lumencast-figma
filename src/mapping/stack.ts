// Figma FRAME with auto-layout → LSML `stack` (§4.1).

import type { Fill, StackPrimitive } from "~shared/lsml-types";
import { paintToFill, type FigmaPaint } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { asArray, asNumber, asString } from "./figma-mixed";
import { withFigmaMetadata } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import type { MappingResult } from "./types";

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
  // background. If a fill is present, lift it as a wrapping frame upstream
  // (out of scope for v0.1 — record a metadata hint instead).
  const fillsArr = asArray<FigmaPaint>(node.fills) ?? [];
  const fills = fillsArr
    .filter(
      (p) => p.type === "SOLID" || p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL",
    )
    .map((p) => paintToFill(p))
    .filter((f): f is Fill => f !== null);
  if (fills.length > 0) {
    prim.metadata = { ...(prim.metadata ?? {}), figmaFills: fills };
  }

  if (parsed.bind) prim.bind = parsed.bind;
  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim);

  return { node: prim };
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
