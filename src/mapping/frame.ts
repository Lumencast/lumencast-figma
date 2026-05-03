// Figma FRAME without auto-layout → LSML `frame` (§4.3).
// Auto-layout FRAMEs route to `mapStack` (§4.1).
//
// Children are mapped recursively by the orchestrator. Position is computed
// relative to the parent frame ; the root frame ignores `position` (LSML
// runtime treats the root as the document origin).

import type { Bind, Fill, FramePrimitive } from "~shared/lsml-types";
import { paintToFill, type FigmaPaint, paintToSolidCss } from "./color";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { resolveVariable } from "./variables";
import type { MappingContext, MappingResult } from "./types";

export interface FrameMapInput {
  type: "FRAME" | "COMPONENT" | "INSTANCE" | "GROUP";
  id: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  /** Per-fill bound variable references — same shape as on shape nodes. */
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
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
  ctx?: MappingContext,
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

  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  // Variable bindings : when fills[0] has a bound color variable AND the
  // frame rendered a single solid `background`, replace the static
  // background with `bind: { background: "tokens.<group>.<name>" }` and
  // seed defaults.
  let defaults: Record<string, unknown> | undefined;
  const bind: Bind = parsed.bind ?? {};
  if (ctx?.variables && prim.background !== undefined && node.fillBoundVariables?.[0]?.color?.id) {
    const id = node.fillBoundVariables[0].color.id;
    const resolved = resolveVariable(id, ctx.variables);
    if (resolved) {
      bind["background"] = resolved.path;
      delete prim.background;
      defaults = { [resolved.path]: resolved.value };
    }
  }
  if (Object.keys(bind).length > 0) prim.bind = bind;

  if (defaults) return { node: prim, defaults };
  return { node: prim };
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
