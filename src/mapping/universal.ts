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

interface FigmaNodeWithUniversal {
  visible?: boolean;
  opacity?: number;
  rotation?: number;
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

export function extractUniversal(node: FigmaNodeWithUniversal): UniversalProps {
  const out: UniversalProps = {};

  if (node.visible === false) {
    out.visible = false;
  }
  if (node.opacity !== undefined && node.opacity !== 1) {
    out.opacity = roundTo3(node.opacity);
  }
  if (node.rotation !== undefined && node.rotation !== 0) {
    out.rotation = roundTo3(node.rotation);
  }

  const sx = modeFromFigma(node.layoutSizingHorizontal);
  const sy = modeFromFigma(node.layoutSizingVertical);
  // Only emit `sizing` when at least one axis is non-default ("fixed").
  if ((sx && sx !== "fixed") || (sy && sy !== "fixed")) {
    out.sizing = { x: sx ?? "fixed", y: sy ?? "fixed" };
  }
  return out;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
