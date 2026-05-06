// Shared LSML Fill → Figma ImportPaint converter.
//
// Three primitive builders (frame, shape, stack) all need the same
// conversion : LSML's `Fill` (solid / linear-gradient / radial-gradient)
// → Figma's `ImportPaint` (SOLID / GRADIENT_LINEAR / GRADIENT_RADIAL).
// The logic was duplicated in frame.ts and shape.ts ; centralising
// avoids drift and lets stack.ts pick it up directly.

import type { Fill } from "~shared/lsml-types";
import type { ImportPaint } from "./figma-api";
import { cssToRgb, cssToRgba } from "./color";

export function fillToPaint(fill: Fill, rawTransform: number[][] | null): ImportPaint | null {
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
