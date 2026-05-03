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
import type { MappingContext, MappingResult } from "./types";

interface MockShapeNode {
  type: "RECTANGLE" | "ELLIPSE" | "VECTOR";
  id: string;
  name: string;
  width: number;
  height: number;
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

export function mapShape(node: MockShapeNode, ctx?: MappingContext): MappingResult {
  const parsed = parseLayerName(node.name, { primitiveKind: "shape" });
  const fills = (node.fills ?? [])
    .filter((p) => p.type !== "IMAGE")
    .map((p) => paintToFill(p))
    .filter((f): f is Fill => f !== null);

  const prim: ShapePrimitive = {
    kind: "shape",
    geometry: geometryFor(node),
    ...extractUniversal(node),
  };

  if (prim.geometry === "rect" || prim.geometry === "circle") {
    prim.size = { w: roundTo3(node.width), h: roundTo3(node.height) };
  } else if (prim.geometry === "path") {
    const path = (node.vectorPaths ?? [])[0]?.data;
    if (path) prim.pathData = path;
  }

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

  if (prim.geometry === "rect" && node.cornerRadius !== undefined && node.cornerRadius !== 0) {
    prim.cornerRadius = roundTo3(node.cornerRadius);
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
  const out: Stroke[] = [];
  for (const s of node.strokes ?? []) {
    const color = paintToSolidCss({ ...s, type: "SOLID" });
    if (color) out.push({ color, width: node.strokeWeight ?? 1 });
  }
  return out;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { MockShapeNode };
