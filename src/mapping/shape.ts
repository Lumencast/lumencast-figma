// Figma RECTANGLE / ELLIPSE / VECTOR → LSML `shape` (§4.6).
//
// A RECTANGLE with an image fill is handled by `mapImage`, not here. This
// mapper handles geometric shapes — rect/circle and arbitrary vector paths.
// Multi-fill (1.1+) maps Figma's `fills[]` directly to LSML `fills[]` ; single
// solid fills collapse to the legacy `fill` field for canonical compactness.

import type { Bind, Fill, ShapePathEntry, ShapePrimitive, Stroke } from "~shared/lsml-types";
import { paintToFill, rawGradientTransform, type FigmaPaint, paintToSolidCss } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { resolveVariable } from "./variables";
import { asArray, asNumber } from "./figma-mixed";
import { withFigmaMetadata } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import type { MappingContext, MappingResult } from "./types";

interface MockShapeNode {
  type: "RECTANGLE" | "ELLIPSE" | "VECTOR" | "BOOLEAN_OPERATION" | "STAR" | "POLYGON" | "LINE";
  id: string;
  name: string;
  width: number;
  height: number;
  /** Absolute Figma coordinates on the canvas. Resolved against `parentX/Y`
   *  in opts to produce a parent-relative `position` in the LSML primitive. */
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  strokes?: { type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number }[];
  strokeWeight?: number;
  cornerRadius?: number;
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  /** Figma's flattened geometry, post-boolean operations. The primary source
   *  for emitting `shape.paths[]` (LSML 1.1 §4.6). Available on every vector-
   *  like node (VECTOR, BOOLEAN_OPERATION, STAR, POLYGON, LINE) in the main
   *  thread API. Fallback to `vectorPaths` when absent (older mocks). */
  fillGeometry?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
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
  parentRotation?: number;
  parentX?: number;
  parentY?: number;
  /** True when the immediate source parent is GROUP / BOOLEAN_OPERATION. */
  parentIsTransparent?: boolean;
  /** Composed transparent-Group ancestor chain — see TextMapOptions. */
  groupChainTransform?: number[][];
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
    ...extractUniversal(node, {
      parentRotation: opts?.parentRotation ?? 0,
      parentIsTransparent: opts?.parentIsTransparent === true,
    }),
  };

  const w = asNumber(node.width);
  const h = asNumber(node.height);
  if (prim.geometry === "rect" || prim.geometry === "circle") {
    if (w !== undefined && h !== undefined) {
      prim.size = { w: roundTo3(w), h: roundTo3(h) };
    }
  } else if (prim.geometry === "path") {
    // LSML 1.1 §4.6 : prefer `paths[]` (post-boolean flatten with per-
    // subpath windingRule). Falls back to `pathData` for the single-path
    // shorthand when the host node only exposes vectorPaths or there's a
    // single subpath.
    const fg = asArray<{ data: string; windingRule: "NONZERO" | "EVENODD" }>(node.fillGeometry);
    const vp = asArray<{ data: string; windingRule: "NONZERO" | "EVENODD" }>(node.vectorPaths);
    const subpaths = fg && fg.length > 0 ? fg : (vp ?? []);
    if (subpaths.length === 1 && subpaths[0]) {
      prim.pathData = subpaths[0].data;
    } else if (subpaths.length > 1) {
      prim.paths = subpaths.map((s): ShapePathEntry => {
        const out: ShapePathEntry = { data: s.data };
        if (s.windingRule) out.windingRule = s.windingRule;
        return out;
      });
    }
    // Recommended : also emit `size` for path geometry so renderers can
    // compute a viewBox without parsing every subpath.
    if (w !== undefined && h !== undefined) {
      prim.size = { w: roundTo3(w), h: roundTo3(h) };
    }
  }

  // Universal `position` (LSML §5.4) — relative to parent's coordinate
  // origin. Only emitted when non-zero ; the document root sits at (0,0).
  const px = asNumber(node.x) ?? 0;
  const py = asNumber(node.y) ?? 0;
  const parentX = opts?.parentX ?? 0;
  const parentY = opts?.parentY ?? 0;
  const relX = roundTo3(px - parentX);
  const relY = roundTo3(py - parentY);
  if (relX !== 0 || relY !== 0) prim.position = { x: relX, y: relY };

  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
    prim.fill = fills[0].color;
  } else if (fills.length > 0) {
    prim.fills = fills;
  }

  // Stash raw gradient matrices parallel-indexed with the fills we just
  // emitted. The withFigmaMetadata helper drops the array when every entry
  // is null (no gradients) so single-solid shapes carry no metadata.
  if (fills.length > 0) {
    const transforms = fillsArr
      .filter((p) => p.type !== "IMAGE")
      .map((p) => rawGradientTransform(p));
    withFigmaMetadata(prim, { gradientTransforms: transforms });
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

  // Preserve the source Figma layer name (raw, including any [bind:...]
  // directive prefix) so the import side can restore it verbatim.
  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim, {
    localPosition: prim.position ?? { x: 0, y: 0 },
    parentIsTransparent: opts?.parentIsTransparent === true,
    ...(opts?.groupChainTransform ? { groupChainTransform: opts.groupChainTransform } : {}),
  });

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
  // VECTOR, BOOLEAN_OPERATION, STAR, POLYGON, LINE — all flatten to a
  // path. We rely on `fillGeometry` (post-boolean) for the actual data.
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
