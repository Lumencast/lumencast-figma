// LSML frame → Figma FRAME (no auto-layout). Children are appended by the
// orchestrator after each builder has produced its node ; this builder owns
// only the frame itself.

import type { Fill, FramePrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportFrameNode, ImportPaint } from "../figma-api";
import { cssToRgb, cssToRgba } from "../color";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import type { BuildContext } from "./types";

export function buildFrame(
  prim: FramePrimitive,
  api: ImportFigmaApi,
  _ctx: BuildContext,
): ImportFrameNode {
  const node = api.createFrame();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? "Frame";
  if (prim.size) node.resize(prim.size.w, prim.size.h);
  node.layoutMode = "NONE";

  // `clipsContent` is the canonical first-class field (LSML 1.1 §4.3).
  // Default true matches the Figma frame default — without this, child
  // layouts that extend past the declared `size` trigger auto-grow.
  (node as unknown as { clipsContent?: boolean }).clipsContent = prim.clipsContent ?? true;

  // Position : universal prop (LSML 1.1 §5.4).
  const pos = prim.position;
  if (pos) {
    node.x = pos.x;
    node.y = pos.y;
  }

  // Backgrounds. When the source captured raw gradient matrices in
  // `metadata.figma.gradientTransforms[]` (v0.2+), use those instead of
  // reconstructing from `angle_deg`.
  const transforms = figmaMeta.gradientTransforms ?? [];
  if (prim.backgrounds && prim.backgrounds.length > 0) {
    node.fills = prim.backgrounds
      .map((f, i) => fillToPaint(f, transforms[i] ?? null))
      .filter((p): p is ImportPaint => p !== null);
  } else if (prim.background !== undefined) {
    const rgb = cssToRgb(prim.background);
    if (rgb) {
      const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
      if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
      node.fills = [fill];
    }
  }

  applyUniversal(node, prim);
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
    let transform: number[][];
    if (rawTransform) {
      transform = rawTransform;
    } else {
      const angle = fill.kind === "linear-gradient" ? (fill.angle_deg ?? 0) : 0;
      const rad = (angle * Math.PI) / 180;
      transform = [
        [Math.cos(rad), Math.sin(rad), 0],
        [-Math.sin(rad), Math.cos(rad), 0],
      ];
    }
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
