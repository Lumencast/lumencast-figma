// Figma FRAME without auto-layout → LSML `frame` (§4.3).
// Auto-layout FRAMEs route to `mapStack` (§4.1).
//
// Children are mapped recursively by the orchestrator. Position is computed
// relative to the parent frame ; the root frame ignores `position` (LSML
// runtime treats the root as the document origin).

import type { Fill, FramePrimitive } from "~shared/lsml-types";
import { paintToFill, type FigmaPaint, paintToSolidCss } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import type { MappingResult } from "./types";

export interface FrameMapInput {
  type: "FRAME" | "COMPONENT" | "INSTANCE" | "GROUP";
  id: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}

export interface FrameMapOptions {
  /** True when this frame is the root of the export (skip `position`). */
  isRoot: boolean;
  /** Parent's coordinate origin in Figma — children's `x/y` are absolute in Figma. */
  parentX?: number;
  parentY?: number;
}

export function mapFrame(
  node: FrameMapInput,
  opts: FrameMapOptions,
  children: FramePrimitive["children"],
): MappingResult {
  const parsed = parseLayerName(node.name, { primitiveKind: "frame" });

  const prim: FramePrimitive = {
    kind: "frame",
    children,
    ...extractUniversal(node),
  };

  if (opts.isRoot) {
    prim.size = { w: roundTo3(node.width), h: roundTo3(node.height) };
  } else {
    prim.size = { w: roundTo3(node.width), h: roundTo3(node.height) };
    const px = opts.parentX ?? 0;
    const py = opts.parentY ?? 0;
    const x = (node.x ?? 0) - px;
    const y = (node.y ?? 0) - py;
    if (x !== 0 || y !== 0) prim.position = { x: roundTo3(x), y: roundTo3(y) };
  }

  // Backgrounds : single solid → `background`, multi/gradient → `backgrounds[]`.
  const fills = (node.fills ?? [])
    .filter((p) => p.type !== "IMAGE")
    .map((p) => paintToFill(p))
    .filter((f): f is Fill => f !== null);
  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
    const single = (node.fills ?? []).find((p) => p.type === "SOLID");
    if (single) {
      const css = paintToSolidCss(single);
      if (css) prim.background = css;
    }
  } else if (fills.length > 0) {
    prim.backgrounds = fills;
  }

  if (parsed.bind) prim.bind = parsed.bind;
  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  return { node: prim };
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
