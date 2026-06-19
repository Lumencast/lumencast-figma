// LSML 1.1 universal props (§5.4) extracted from a Figma node.
//
// `visible`     : node.visible (drop when true — the LSML default)
// `opacity`     : node.opacity (drop when 1)
// `rotation`    : node.rotation in degrees (drop when 0)
// `sizing`      : layoutSizingHorizontal/Vertical → x/y in {fixed, hug, fill}
//
// Bound values from `[bindUniversal:...]` directives are merged in by the
// caller (see mapping/index.ts).

import type { SizingMode, UniversalProps } from "~shared/lsml-types";
import { asBoolean, asNumber, asString } from "./figma-mixed";

interface FigmaNodeWithUniversal {
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  flipY?: boolean;
  blur?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}

function modeFromFigma(m: "FIXED" | "HUG" | "FILL" | undefined): SizingMode | null {
  if (!m) return null;
  if (m === "FIXED") return "fixed";
  if (m === "HUG") return "hug";
  if (m === "FILL") return "fill";
  return null;
}

export interface ExtractUniversalOptions {
  /** Cumulative rotation of the closest rotated ancestor (degrees). */
  parentRotation?: number;
  /** True when the immediate source parent is GROUP / BOOLEAN_OPERATION.
   *  In that case the rotation is encoded losslessly in the captured raw
   *  `metadata.figma.transform` matrix — emitting it again as a universal
   *  `rotation` field would cause double-application on Figma re-import.
   *  Non-Figma consumers ignore the metadata, so the visual approximation
   *  for them comes from the position alone (acceptable for transparent
   *  groups, where the rotation is geometrically tied to the matrix). */
  parentIsTransparent?: boolean;
  /** Composed 2×3 matrix of the transparent GROUP/BOOLEAN ancestor chain. Its
   *  rotation + mirror are decomposed and applied at render (the chain is
   *  otherwise metadata-only, so tiles/caramel under groups lose it). */
  groupChainTransform?: number[][] | undefined;
  /** True when THIS node is itself a transparent GROUP/BOOLEAN. Such a node is
   *  not a rendered box — it only passes the chain to its children. Decomposing
   *  the chain onto IT (a flip/rotation on the group frame) would re-apply the
   *  transform its descendants already carry → the texture tiles drifted. So a
   *  transparent group emits NO chain transform ; only real leaves/frames do. */
  nodeIsTransparent?: boolean;
}

export function extractUniversal(
  node: FigmaNodeWithUniversal,
  opts?: ExtractUniversalOptions,
): UniversalProps {
  const out: UniversalProps = {};

  if (asBoolean(node.visible) === false) {
    out.visible = false;
  }
  const opacity = asNumber(node.opacity);
  if (opacity !== undefined && opacity !== 1) {
    out.opacity = roundTo3(opacity);
  }
  // Skip rotation under a transparent-group parent — the raw matrix in
  // metadata.figma.transform owns rotation/flip/skew exactly (round-trip).
  if (!opts?.parentIsTransparent) {
    const rotation = asNumber(node.rotation);
    const parentRot = opts?.parentRotation ?? 0;
    if (rotation !== undefined) {
      const local = normaliseDegrees(rotation - parentRot);
      if (local !== 0) out.rotation = roundTo3(local);
    }
  }
  // Mirror (negative transform determinant) — applied as `scaleY(-1)` at render.
  if (asBoolean(node.flipY) === true) (out as { flipY?: boolean }).flipY = true;
  // Compose the transparent-GROUP chain's rotation + mirror onto this leaf —
  // but NOT onto a transparent group itself (it only forwards the chain ; see
  // `nodeIsTransparent`). Applying it here would double the transform its
  // descendants already carry.
  const chain = opts?.nodeIsTransparent ? undefined : opts?.groupChainTransform;
  const c0 = chain?.[0];
  const c1 = chain?.[1];
  if (chain && c0 && c1 && c0.length >= 2 && c1.length >= 2) {
    // `?? 0` only satisfies noUncheckedIndexedAccess — the length guard proved the
    // cells exist, and a real 0 survives `??`.
    const a = c0[0] ?? 0,
      c = c0[1] ?? 0,
      b = c1[0] ?? 0,
      d = c1[1] ?? 0;
    const det = a * d - c * b;
    const chainRot = normaliseDegrees((Math.atan2(b, a) * 180) / Math.PI);
    if (chainRot !== 0) out.rotation = roundTo3(normaliseDegrees((out.rotation ?? 0) + chainRot));
    if (det < 0) (out as { flipY?: boolean }).flipY = true;
  }
  // LAYER_BLUR radius → CSS `filter: blur()` at render.
  const blur = asNumber(node.blur);
  if (blur !== undefined && blur > 0) (out as { blur?: number }).blur = roundTo3(blur);

  // DROP_SHADOW / INNER_SHADOW → CSS `box-shadow` at render. The adapter already
  // shaped these into structured specs ({ inset, color, x, y, blur, spread }) ;
  // pass the array through verbatim (the runtime re-validates the colour).
  const shadow = (node as { shadow?: unknown }).shadow;
  if (Array.isArray(shadow) && shadow.length > 0) {
    (out as { shadow?: unknown[] }).shadow = shadow;
  }

  const lsH = asString(node.layoutSizingHorizontal) as "FIXED" | "HUG" | "FILL" | undefined;
  const lsV = asString(node.layoutSizingVertical) as "FIXED" | "HUG" | "FILL" | undefined;
  const sx = modeFromFigma(lsH);
  const sy = modeFromFigma(lsV);
  if ((sx && sx !== "fixed") || (sy && sy !== "fixed")) {
    out.sizing = { x: sx ?? "fixed", y: sy ?? "fixed" };
  }
  return out;
}

/** Normalise a degree value to (-180, 180]. */
function normaliseDegrees(d: number): number {
  const n = (((d % 360) + 540) % 360) - 180;
  return Math.abs(n) < 1e-6 ? 0 : n;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
