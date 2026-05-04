// LSML shape → Figma RECTANGLE / ELLIPSE / VECTOR.

import type { ShapePrimitive, Fill, Stroke } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportShapeNode, ImportStroke } from "../figma-api";
import { cssToRgb, cssToRgba } from "../color";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
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

  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? prim.ariaLabel ?? "Shape";

  if (prim.size) {
    node.resize(prim.size.w, prim.size.h);
  } else if (figmaMeta.size) {
    // Vector geometry has no native LSML size ; we stashed it in
    // metadata.figma.size on export so paths render at the right scale.
    node.resize(figmaMeta.size.w, figmaMeta.size.h);
  }

  if (prim.geometry === "path") {
    // LSML 1.1 §4.6 : `paths[]` is the multi-subpath form, `pathData` the
    // single-path shorthand. The two are mutually exclusive at the schema
    // level, so we accept whichever is present.
    //
    // Figma's `vectorPaths` setter is stricter than its getter : it rejects
    // SVG path data where a command letter sits adjacent to its first
    // coordinate (`M13.16` → `Failed to convert path. Invalid command at
    // M13.16`). The standard SVG grammar permits this elision, the getter
    // emits it, but the setter wants whitespace. We normalise on the way in.
    if (prim.paths && prim.paths.length > 0) {
      node.vectorPaths = prim.paths.map((p) => ({
        data: normalizeSvgPath(p.data),
        windingRule: p.windingRule ?? "NONZERO",
      }));
    } else if (prim.pathData) {
      node.vectorPaths = [
        { data: normalizeSvgPath(prim.pathData), windingRule: "NONZERO" },
      ];
    }
  }

  // Fills. When the source captured raw gradient matrices in
  // `metadata.figma.gradientTransforms[]` (v0.2+), use those instead of
  // reconstructing from `angle_deg` — preserves Figma's exact handle.
  const transforms = figmaMeta.gradientTransforms ?? [];
  if (prim.fills && prim.fills.length > 0) {
    node.fills = prim.fills
      .map((f, i) => fillToPaint(f, transforms[i] ?? null))
      .filter((p): p is ImportPaint => p !== null);
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

  // Position : universal prop (LSML 1.1 §5.4). v0.1 bundles stashed it
  // in `metadata.figma.position` ; we still read that as a fallback.
  // Frame builders append children after they're constructed, so we set
  // x/y on the node before the parent appends — Figma keeps the assignment.
  const pos = prim.position ?? figmaMeta.position;
  if (pos) {
    (node as unknown as { x?: number; y?: number }).x = pos.x;
    (node as unknown as { x?: number; y?: number }).y = pos.y;
  }

  return node;
}

function fillToPaint(fill: Fill, rawTransform: number[][] | null): ImportPaint | null {
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
    const transform =
      rawTransform ??
      gradientTransformFromAngle(
        fill.kind === "linear-gradient" ? (fill.angle_deg ?? 0) : 0,
      );
    const out: ImportPaint = {
      type: fill.kind === "linear-gradient" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL",
      gradientStops: stops,
      gradientTransform: transform,
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

/** Normalise an SVG path string for Figma's strict `vectorPaths` setter.
 *  Figma rejects command-coordinate elisions like `M13.16` and `L7.18-3.5`
 *  even though both are valid SVG path syntax (the grammar permits the
 *  whitespace to be omitted when the next token is unambiguous). We :
 *
 *    1. Insert a space between any command letter (MmLlHhVvCcSsQqTtAaZz)
 *       and the following character.
 *    2. Insert a space before a `-` that follows a digit or dot
 *       (`L7.18-3.5` → `L7.18 -3.5`). Scientific-notation exponents like
 *       `1.5e-3` are preserved : the regex requires a digit/dot directly
 *       before `-`, but in `e-3` the char before `-` is `e`, so it
 *       doesn't match — exponents stay untouched.
 *    3. Collapse runs of whitespace to a single space.
 *
 *  No-op for already-spaced inputs (round-trip stable). */
function normalizeSvgPath(raw: string): string {
  return raw
    // 1. Space BEFORE a command letter that sticks to a digit/dot
    //    (`0L1` → `0 L1`). Run before pass 2 so the inserted space
    //    becomes visible to it.
    .replace(/([0-9.])([MmLlHhVvCcSsQqTtAaZz])/g, "$1 $2")
    // 2. Space AFTER a command letter that sticks to its first coord
    //    (`M13.16` → `M 13.16`).
    .replace(/([MmLlHhVvCcSsQqTtAaZz])(?=[^\s,])/g, "$1 ")
    // 3. Space before `-` that follows a digit or dot (`7.18-3.5` →
    //    `7.18 -3.5`). Exponents stay intact because the char before
    //    `-` in `e-3` is `e`, not `[0-9.]`.
    .replace(/([0-9.])(?=-)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}
