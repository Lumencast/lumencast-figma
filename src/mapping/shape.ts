// Figma RECTANGLE / ELLIPSE / VECTOR → LSML `shape` (§4.6).
//
// A RECTANGLE with an image fill is handled by `mapImage`, not here. This
// mapper handles geometric shapes — rect/circle and arbitrary vector paths.
// Multi-fill (1.1+) maps Figma's `fills[]` directly to LSML `fills[]` ; single
// solid fills collapse to the legacy `fill` field for canonical compactness.

import type { Bind, Fill, ShapePrimitive, Stroke } from "~shared/lsml-types";
import { paintToFill, type FigmaPaint, paintToSolidCss } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { resolveVariable } from "./variables";
import { asArray, asNumber } from "./figma-mixed";
import { withFigmaMetadata } from "./figma-metadata";
import type { MappingContext, MappingResult } from "./types";

interface MockShapeNode {
  type: "RECTANGLE" | "ELLIPSE" | "VECTOR";
  id: string;
  name: string;
  width: number;
  height: number;
  /** Absolute Figma coordinates on the canvas. The export pipeline computes
   *  the position relative to the parent in `traverse.ts` and stamps it
   *  into `metadata.figma.position`. */
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  strokes?: { type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number }[];
  strokeWeight?: number;
  cornerRadius?: number;
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  /** Per-fill bound variables keyed by paint index. Figma exposes the variable
   *  refs on each `Paint` ; we surface them as a parallel array. */
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}

export interface ShapeMapOptions {
  parentX?: number;
  parentY?: number;
}

export function mapShape(
  node: MockShapeNode,
  ctx?: MappingContext,
  opts?: ShapeMapOptions,
): MappingResult {
  const parsed = parseLayerName(node.name, { primitiveKind: "shape" });
  const fillsArr = asArray<FigmaPaint>(node.fills) ?? [];
  const fills = fillsArr
    .filter((p) => p.type !== "IMAGE")
    .map((p) => paintToFill(p))
    .filter((f): f is Fill => f !== null);

  const prim: ShapePrimitive = {
    kind: "shape",
    geometry: geometryFor(node),
    ...extractUniversal(node),
  };

  const w = asNumber(node.width);
  const h = asNumber(node.height);
  if (prim.geometry === "rect" || prim.geometry === "circle") {
    if (w !== undefined && h !== undefined) {
      prim.size = { w: roundTo3(w), h: roundTo3(h) };
    }
  } else if (prim.geometry === "path") {
    const vp = asArray<{ data: string; windingRule: "NONZERO" | "EVENODD" }>(node.vectorPaths);
    const path = vp?.[0]?.data;
    if (path) prim.pathData = path;
  }

  // metadata.figma.position — preserve absolute placement for shapes that
  // sit inside non-auto-layout frames. LSML's `shape` has no native
  // position field ; without this metadata, every shape collapses to (0,0)
  // on re-import. metadata.figma.size — preserve vector dimensions so the
  // path renders at the right scale (LSML §4.6 leaves size unspecified for
  // path geometry).
  const px = asNumber(node.x) ?? 0;
  const py = asNumber(node.y) ?? 0;
  const parentX = opts?.parentX ?? 0;
  const parentY = opts?.parentY ?? 0;
  const relX = roundTo3(px - parentX);
  const relY = roundTo3(py - parentY);
  withFigmaMetadata(prim, {
    position: { x: relX, y: relY },
    ...(prim.geometry === "path" && w !== undefined && h !== undefined
      ? { size: { w: roundTo3(w), h: roundTo3(h) } }
      : {}),
  });

  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
    prim.fill = fills[0].color;
  } else if (fills.length > 0) {
    prim.fills = fills;
  }

  const strokes = mapStrokes(node);
  if (strokes.length === 1 && strokes[0]) {
    prim.stroke = strokes[0];
  } else if (strokes.length > 1) {
    prim.strokes = strokes;
  }

  // node.cornerRadius is `figma.mixed` (a Symbol) on rectangles whose four
  // corners differ — guard with asNumber.
  const cornerRadius = asNumber(node.cornerRadius);
  if (prim.geometry === "rect" && cornerRadius !== undefined && cornerRadius !== 0) {
    prim.cornerRadius = roundTo3(cornerRadius);
  }

  if (parsed.displayName) prim.ariaLabel = parsed.displayName;
  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  // Variable bindings : when fills[0] has a bound color variable AND the
  // shape rendered a single solid `fill`, replace the static fill with a
  // `bind: { fill: "tokens.<group>.<name>" }` and seed defaults. (Multi-fill
  // / non-solid bindings are deferred — they need bindStyle, which is not
  // yet in the schema. See lumencast-protocol issue.)
  let defaults: Record<string, unknown> | undefined;
  const bind: Bind = parsed.bind ?? {};
  if (ctx?.variables && prim.fill !== undefined && node.fillBoundVariables?.[0]?.color?.id) {
    const id = node.fillBoundVariables[0].color.id;
    const resolved = resolveVariable(id, ctx.variables);
    if (resolved) {
      bind["fill"] = resolved.path;
      delete prim.fill;
      defaults = { [resolved.path]: resolved.value };
    }
  }
  if (Object.keys(bind).length > 0) prim.bind = bind;

  if (defaults) return { node: prim, defaults };
  return { node: prim };
}

function geometryFor(node: MockShapeNode): ShapePrimitive["geometry"] {
  if (node.type === "RECTANGLE") return "rect";
  if (node.type === "ELLIPSE") return "circle";
  return "path";
}

function mapStrokes(node: MockShapeNode): Stroke[] {
  const strokesArr = asArray<{
    type: "SOLID";
    color: { r: number; g: number; b: number };
    opacity?: number;
  }>(node.strokes);
  if (!strokesArr) return [];
  const strokeWeight = asNumber(node.strokeWeight) ?? 1;
  const out: Stroke[] = [];
  for (const s of strokesArr) {
    // Figma exposes strokes as host Paint objects with internal Symbol-keyed
    // metadata. Spreading them (`{ ...s, ... }`) trips QuickJS — esbuild's
    // ES2017 spread helper iterates `getOwnPropertySymbols(s)` and the host
    // wrapper coerces Symbols to numeric indices, throwing "cannot convert
    // symbol to number". Construct the FigmaPaint shape explicitly instead.
    const paint: FigmaPaint = { type: "SOLID", color: s.color };
    if (s.opacity !== undefined) paint.opacity = s.opacity;
    const color = paintToSolidCss(paint);
    if (color) out.push({ color, width: strokeWeight });
  }
  return out;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { MockShapeNode };
