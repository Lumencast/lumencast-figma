// LSML shape → Figma RECTANGLE / ELLIPSE / VECTOR.

import type { ShapePrimitive, Fill, Stroke } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportShapeNode, ImportStroke } from "../figma-api";
import { cssToRgb, cssToRgba } from "../color";
import { applyUniversal } from "../universal";
import type { BuildContext } from "./types";

export function buildShape(
  prim: ShapePrimitive,
  api: ImportFigmaApi,
  _ctx: BuildContext,
): ImportShapeNode {
  let node: ImportShapeNode;
  switch (prim.geometry) {
    case "rect":
      node = api.createRectangle();
      break;
    case "circle":
      node = api.createEllipse();
      break;
    case "path":
      node = api.createVector();
      break;
  }

  node.name = prim.ariaLabel ?? "Shape";
  if (prim.size) node.resize(prim.size.w, prim.size.h);

  if (prim.geometry === "path" && prim.pathData) {
    node.vectorPaths = [{ data: prim.pathData, windingRule: "NONZERO" }];
  }

  // Fills.
  if (prim.fills && prim.fills.length > 0) {
    node.fills = prim.fills.map(fillToPaint).filter((p): p is ImportPaint => p !== null);
  } else if (prim.fill !== undefined) {
    const rgb = cssToRgb(prim.fill);
    if (rgb) {
      const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
      if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
      node.fills = [fill];
    }
  }

  // Strokes.
  if (prim.strokes && prim.strokes.length > 0) {
    node.strokes = prim.strokes.map(strokeToImport).filter((s): s is ImportStroke => s !== null);
    node.strokeWeight = prim.strokes[0]?.width ?? 1;
  } else if (prim.stroke) {
    const s = strokeToImport(prim.stroke);
    if (s) {
      node.strokes = [s];
      node.strokeWeight = prim.stroke.width;
    }
  }

  if (prim.geometry === "rect" && prim.cornerRadius !== undefined) {
    node.cornerRadius = prim.cornerRadius;
  }

  applyUniversal(node, prim);
  return node;
}

function fillToPaint(fill: Fill): ImportPaint | null {
  if (fill.kind === "solid") {
    const rgb = cssToRgb(fill.color);
    if (!rgb) return null;
    const out: ImportPaint = { type: "SOLID", color: rgb.rgb };
    if (fill.opacity !== undefined && fill.opacity !== 1) out.opacity = fill.opacity;
    else if (rgb.opacity !== 1) out.opacity = rgb.opacity;
    return out;
  }
  if (fill.kind === "linear-gradient" || fill.kind === "radial-gradient") {
    const stops = fill.stops
      .map((s) => {
        const c = cssToRgba(s.color);
        if (!c) return null;
        const a = s.opacity !== undefined ? s.opacity : c.a;
        return { position: s.offset, color: { r: c.r, g: c.g, b: c.b, a } };
      })
      .filter(
        (s): s is { position: number; color: { r: number; g: number; b: number; a: number } } =>
          s !== null,
      );
    if (stops.length < 2) return null;
    const out: ImportPaint = {
      type: fill.kind === "linear-gradient" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL",
      gradientStops: stops,
      gradientTransform: gradientTransformFromAngle(
        fill.kind === "linear-gradient" ? (fill.angle_deg ?? 0) : 0,
      ),
    };
    if (fill.opacity !== undefined && fill.opacity !== 1) out.opacity = fill.opacity;
    return out;
  }
  return null;
}

function strokeToImport(stroke: Stroke): ImportStroke | null {
  const rgb = cssToRgb(stroke.color);
  if (!rgb) return null;
  const out: ImportStroke = { type: "SOLID", color: rgb.rgb };
  if (rgb.opacity !== 1) out.opacity = rgb.opacity;
  return out;
}

/** Rebuild a Figma 2x3 affine transform from an angle. Inverse of
 *  `gradientTransformToAngleDeg` in src/mapping/color.ts. */
function gradientTransformFromAngle(deg: number): number[][] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, s, 0],
    [-s, c, 0],
  ];
}
