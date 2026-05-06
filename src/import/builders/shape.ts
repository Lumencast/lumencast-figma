// LSML shape → Figma RECTANGLE / ELLIPSE / VECTOR.

import type { ShapePrimitive, Stroke } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportShapeNode, ImportStroke } from "../figma-api";
import { cssToRgb } from "../color";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import { fillToPaint } from "../fill-to-paint";
import type { BuildContext } from "./types";

export function buildShape(
  prim: ShapePrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
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

  // figma.createRectangle / createEllipse / createVector return nodes
  // with a default white fill + black 1px stroke (and an empty effects
  // array, but we strip it defensively). The LSML model is transparent
  // / strokeless / effect-less until the bundle says otherwise — clear
  // the defaults before re-applying anything. Same pattern as buildFrame
  // ; without it every vector whose source has no stroke ends up with a
  // visible 1px black border (e.g. mask outlines, decorative paths).
  (node as unknown as { fills?: ImportPaint[] }).fills = [];
  (node as unknown as { strokes?: ImportStroke[] }).strokes = [];
  (node as unknown as { effects?: unknown[] }).effects = [];

  // Resize early for rect / ellipse — these don't have a vectorPaths
  // setter that would override the bbox, and some downstream setters
  // (e.g. cornerRadius interpretation) may depend on dimensions being
  // already set. For `path` geometry we delay the resize until AFTER
  // `vectorPaths` is set, since Figma's vectorPaths setter atomically
  // recomputes the node's bbox from the path's natural extent —
  // clobbering any prior `resize` call. This was the cause of WP
  // watermark pixels round-tripping at their path-natural sizes
  // (101.10 / 106.78) instead of the source's manual resize (101.453).
  if (prim.geometry !== "path") {
    if (prim.size) {
      node.resize(prim.size.w, prim.size.h);
    } else if (figmaMeta.size) {
      node.resize(figmaMeta.size.w, figmaMeta.size.h);
    }
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
    //
    // Wrap the setter in try/catch : if a single path's data is malformed
    // (some Figma sources emit e.g. malformed scientific-notation, double
    // dots, etc. that our normaliser doesn't catch yet), throwing here
    // would propagate up to `walk.ts:appendSafely` and silently DROP the
    // ENTIRE shape — losing not just the path data but also the node's
    // position, fills, transform. Surfacing as a warning keeps the empty
    // vector node alive so the rest of the tree round-trips.
    if (prim.paths && prim.paths.length > 0) {
      try {
        node.vectorPaths = prim.paths.map((p) => ({
          data: normalizeSvgPath(p.data),
          windingRule: p.windingRule ?? "NONZERO",
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const sample = prim.paths[0]?.data.slice(0, 200) ?? "";
        ctx.warn(
          "VECTOR_PATHS_REJECTED",
          `Vector path data was rejected by Figma's setter (${msg}). ${prim.paths.length} subpath(s) ; first sample : ${sample}. The vector renders empty ; the node + position are preserved so the layout structure stays intact.`,
        );
      }
    } else if (prim.pathData) {
      try {
        node.vectorPaths = [{ data: normalizeSvgPath(prim.pathData), windingRule: "NONZERO" }];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const sample = prim.pathData.slice(0, 200);
        ctx.warn(
          "VECTOR_PATHS_REJECTED",
          `Vector path data was rejected by Figma's setter (${msg}). path : ${sample}. The vector renders empty.`,
        );
      }
    }
    // Resize AFTER vectorPaths : Figma reset the bbox to the path's
    // natural extent when we assigned `node.vectorPaths`. Re-apply the
    // captured dimensions so the vector renders at the source's manual
    // size (e.g. each WP watermark pixel had its source bbox manually
    // sized to 101.453 ; without this re-resize the path's intrinsic
    // bounds (101.10 or 106.78) leak into the imported tree and the
    // pattern becomes visibly inconsistent — half the pixels at one
    // size, the other half at another).
    if (prim.size) {
      try {
        node.resize(prim.size.w, prim.size.h);
      } catch {
        // Tolerate — degenerate path data may reject resize.
      }
    } else if (figmaMeta.size) {
      try {
        node.resize(figmaMeta.size.w, figmaMeta.size.h);
      } catch {
        // Tolerate.
      }
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
  applyFigmaExtras(node, figmaMeta);

  // Position : universal prop (LSML 1.1 §5.4). v0.1 bundles stashed it
  // in `metadata.figma.position` ; we still read that as a fallback.
  // Frame builders append children after they're constructed, so we set
  // x/y on the node before the parent appends — Figma keeps the assignment.
  //
  // Skip when `meta.transform` is present : the relativeTransform setter
  // run by `applyFigmaExtras` already encodes position + linear in one
  // atomic write (FRAME-ancestor-relative, composed through any
  // transparent-Group ancestor chain). Setting x/y after would override
  // the translation parts and re-introduce the GROUP-vs-FRAME coord-
  // system mismatch we're trying to eliminate.
  if (!figmaMeta.transform) {
    const pos = prim.position ?? figmaMeta.position;
    if (pos) {
      (node as unknown as { x?: number; y?: number }).x = pos.x;
      (node as unknown as { x?: number; y?: number }).y = pos.y;
    }
  }

  return node;
}

function strokeToImport(stroke: Stroke): ImportStroke | null {
  const rgb = cssToRgb(stroke.color);
  if (!rgb) return null;
  const out: ImportStroke = { type: "SOLID", color: rgb.rgb };
  if (rgb.opacity !== 1) out.opacity = rgb.opacity;
  return out;
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
  return (
    raw
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
      // 4. Comma → space. Some Figma exports use commas as separators
      //    (`M5,5L10,10`) ; the strict setter accepts both but we keep
      //    output uniform to avoid regex misfires on subsequent passes.
      .replace(/,/g, " ")
      // 5. Two consecutive decimal-fraction numbers stuck together :
      //    `0.5.5` is `0.5` followed by `.5` (continuation of arc
      //    flag-style packing). Insert a space before the second dot.
      //    `12.34.56` → `12.34 .56`.
      .replace(/(\.[0-9]+)(?=\.)/g, "$1 ")
      .replace(/\s+/g, " ")
      .trim()
  );
}
