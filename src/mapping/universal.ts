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

  console.warn(
    "[lumencast]     extractUniversal — visible:",
    typeof node.visible,
    "opacity:",
    typeof node.opacity,
    "rotation:",
    typeof node.rotation,
    "layoutSizingH:",
    node.layoutSizingHorizontal,
    "layoutSizingV:",
    node.layoutSizingVertical,
  );

  if (asBoolean(node.visible) === false) {
    out.visible = false;
  }
  const opacity = asNumber(node.opacity);
  if (opacity !== undefined && opacity !== 1) {
    out.opacity = roundTo3(opacity);
  }
  const rotation = asNumber(node.rotation);
  if (rotation !== undefined && rotation !== 0) {
    out.rotation = roundTo3(rotation);
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

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
