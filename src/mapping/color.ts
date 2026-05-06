// Convert Figma colors and paints to LSML / CSS values.
//
// Figma RGB is normalised 0..1 ; CSS hex / rgba expects 0..255 / 0..1.
// Colors come out as `#rrggbb` for opaque solids and `rgba(...)` when
// translucent — keeping the on-disk LSML compact when possible.

import type { Fill, GradientStop } from "~shared/lsml-types";

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface FigmaPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE" | string;
  visible?: boolean;
  opacity?: number;
  color?: RGB;
  gradientStops?: {
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }[];
  gradientTransform?: number[][];
  imageHash?: string | null;
  scaleMode?: string;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function to255(n: number): number {
  return Math.round(clamp01(n) * 255);
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** RGB(A) → CSS color string. Drops alpha when fully opaque. */
export function rgbToCss(rgb: RGB, alpha = 1): string {
  const a = clamp01(alpha);
  const r = to255(rgb.r);
  const g = to255(rgb.g);
  const b = to255(rgb.b);
  if (a === 1) {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  // 3-decimal alpha keeps canonical form stable yet readable.
  const ra = Math.round(a * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${ra})`;
}

/** Solid paint → CSS color. Returns null for non-solid paints. */
export function paintToSolidCss(paint: FigmaPaint): string | null {
  if (paint.visible === false) return null;
  if (paint.type !== "SOLID" || !paint.color) return null;
  const a = paint.opacity ?? 1;
  return rgbToCss(paint.color, a);
}

/** Extract the raw 2x3 affine matrix from a Figma paint, if it has one.
 *  Used by mappers to stash the matrix in `metadata.figma.gradientTransforms[]`
 *  for byte-stable round-trip — `angle_deg` alone loses translation/scale/shear. */
export function rawGradientTransform(paint: FigmaPaint): number[][] | null {
  if (paint.type !== "GRADIENT_LINEAR" && paint.type !== "GRADIENT_RADIAL") return null;
  const t = paint.gradientTransform;
  if (!t || t.length < 2) return null;
  // Deep-clone to a plain 2x3 array — Figma's host matrix carries Symbol-
  // keyed metadata that breaks JSON.stringify and downstream canonicalize.
  const out: number[][] = [];
  for (let i = 0; i < 2; i++) {
    const row = t[i];
    if (!row) continue;
    const cleaned: number[] = [];
    for (let j = 0; j < 3; j++) {
      const v = row[j];
      cleaned.push(typeof v === "number" ? v : 0);
    }
    out.push(cleaned);
  }
  return out.length === 2 ? out : null;
}

/** Best-effort gradient-transform → angle in degrees.
 *
 *  Figma stores a 2x3 affine matrix that maps the unit square to the gradient
 *  handle. The first row's `[a, b]` describes the rotation/scale of the
 *  gradient axis. We extract the angle of (a, b) — accurate enough for common
 *  authored gradients ; complex transforms degrade to an angle approximation. */
export function gradientTransformToAngleDeg(t: number[][] | undefined): number {
  if (!t || t.length < 2) return 0;
  const row0 = t[0];
  if (!row0 || row0.length < 2) return 0;
  const a = row0[0] ?? 1;
  const b = row0[1] ?? 0;
  const rad = Math.atan2(b, a);
  let deg = (rad * 180) / Math.PI;
  // Normalize to [0, 360) and round to one decimal — keeps canonical JSON tidy.
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return Math.round(deg * 10) / 10;
}

/** A Figma paint becomes an LSML Fill. Returns null for unsupported / image
 *  paints (image fills are extracted upstream, not as Fill). */
export function paintToFill(paint: FigmaPaint): Fill | null {
  if (paint.visible === false) return null;
  if (paint.type === "SOLID" && paint.color) {
    const fill: Fill = { kind: "solid", color: rgbToCss(paint.color) };
    if (paint.opacity !== undefined && paint.opacity !== 1) fill.opacity = paint.opacity;
    return fill;
  }
  if (paint.type === "GRADIENT_LINEAR" && paint.gradientStops) {
    const stops = mapGradientStops(paint.gradientStops);
    if (stops.length < 2) return null;
    const fill: Fill = {
      kind: "linear-gradient",
      stops,
    };
    const angle = gradientTransformToAngleDeg(paint.gradientTransform);
    if (angle !== 0) fill.angle_deg = angle;
    if (paint.opacity !== undefined && paint.opacity !== 1) fill.opacity = paint.opacity;
    return fill;
  }
  if (paint.type === "GRADIENT_RADIAL" && paint.gradientStops) {
    const stops = mapGradientStops(paint.gradientStops);
    if (stops.length < 2) return null;
    const fill: Fill = {
      kind: "radial-gradient",
      stops,
    };
    if (paint.opacity !== undefined && paint.opacity !== 1) fill.opacity = paint.opacity;
    return fill;
  }
  return null;
}

function mapGradientStops(
  stops: { position: number; color: { r: number; g: number; b: number; a: number } }[],
): GradientStop[] {
  return stops.map((s) => {
    const out: GradientStop = {
      offset: clamp01(s.position),
      color: rgbToCss(s.color),
    };
    if (s.color.a !== undefined && s.color.a !== 1) out.opacity = clamp01(s.color.a);
    return out;
  });
}

export type { FigmaPaint };
