// Cross-cutting capture for the `x-figma.authoring/1` profile.
//
// Every per-primitive mapper (frame, stack, text, image, shape, instance)
// goes through `captureFigmaExtras(node, prim)` once after the primitive
// is built. We read every property the profile cares about (effects,
// blend mode, mask flag + type, per-corner radii, smoothing, stroke
// extras, constraints, layout overrides) and stash them into
// `metadata.figma.*` via the existing merge helper.
//
// Per-primitive mappers still do their own captures for the kind-
// specific fields (text-only, shape-only, …) — this helper just
// covers the universal ones to avoid copy-paste.

import { asArray, asBoolean, asNumber, asObject, asString } from "./figma-mixed";
import {
  withFigmaMetadata,
  type FigmaBlendMode,
  type FigmaConstraint,
  type FigmaEffect,
  type FigmaLayoutAlign,
  type FigmaMaskType,
  type FigmaMetadata,
  type FigmaStrokeDetails,
} from "./figma-metadata";

interface MaybeFigmaNode {
  relativeTransform?: unknown;
  effects?: unknown;
  blendMode?: unknown;
  isMask?: unknown;
  maskType?: unknown;
  topLeftRadius?: unknown;
  topRightRadius?: unknown;
  bottomLeftRadius?: unknown;
  bottomRightRadius?: unknown;
  cornerSmoothing?: unknown;
  strokeJoin?: unknown;
  strokeCap?: unknown;
  strokeMiterLimit?: unknown;
  strokeAlign?: unknown;
  strokeTopWeight?: unknown;
  strokeRightWeight?: unknown;
  strokeBottomWeight?: unknown;
  strokeLeftWeight?: unknown;
  dashPattern?: unknown;
  constraints?: unknown;
  layoutAlign?: unknown;
  layoutGrow?: unknown;
  layoutPositioning?: unknown;
  minWidth?: unknown;
  maxWidth?: unknown;
  minHeight?: unknown;
  maxHeight?: unknown;
}

const SHADOW_TYPES = new Set(["DROP_SHADOW", "INNER_SHADOW"]);
const BLUR_TYPES = new Set(["LAYER_BLUR", "BACKGROUND_BLUR"]);

const BLEND_MODES = new Set<FigmaBlendMode>([
  "PASS_THROUGH",
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "LINEAR_BURN",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "LINEAR_DODGE",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
]);

const CONSTRAINT_VALUES = new Set<FigmaConstraint>(["MIN", "MAX", "CENTER", "STRETCH", "SCALE"]);

const LAYOUT_ALIGN_VALUES = new Set<FigmaLayoutAlign>([
  "MIN",
  "CENTER",
  "MAX",
  "STRETCH",
  "INHERIT",
]);

const MASK_TYPES = new Set<FigmaMaskType>(["ALPHA", "LUMINANCE", "VECTOR", "OUTLINE"]);

/** Capture every profile-relevant property and merge into prim.metadata.figma.
 *  No-op when the host node exposes nothing of interest. */
export function captureFigmaExtras<T extends { metadata?: Record<string, unknown> }>(
  node: MaybeFigmaNode,
  prim: T,
): T {
  const figma: FigmaMetadata = {};

  // Flip detection : Figma's `node.rotation` getter returns the rotation
  // magnitude but loses the flip orientation. A flipped node's
  // relativeTransform has a negative determinant on the linear part. When
  // detected, stash the full 2x3 matrix so the import side can restore
  // the orientation exactly via `node.relativeTransform = ...`.
  const transform = parseTransform(node.relativeTransform);
  if (transform) {
    const det = transform[0]![0]! * transform[1]![1]! - transform[0]![1]! * transform[1]![0]!;
    if (det < 0) figma.transform = transform;
  }

  // Effects
  const effects = parseEffects(node.effects);
  if (effects.length > 0) figma.effects = effects;

  // Blend mode (skip default)
  const blend = asString(node.blendMode);
  if (blend && BLEND_MODES.has(blend as FigmaBlendMode) && blend !== "PASS_THROUGH" && blend !== "NORMAL") {
    figma.blendMode = blend as FigmaBlendMode;
  }

  // Mask
  if (asBoolean(node.isMask) === true) {
    figma.isMask = true;
    const mt = asString(node.maskType);
    if (mt && MASK_TYPES.has(mt as FigmaMaskType)) figma.maskType = mt as FigmaMaskType;
  }

  // Per-corner radii — only emit when at least one corner differs from the
  // others (otherwise the LSML uniform `cornerRadius` covers it).
  const tl = asNumber(node.topLeftRadius);
  const tr = asNumber(node.topRightRadius);
  const br = asNumber(node.bottomRightRadius);
  const bl = asNumber(node.bottomLeftRadius);
  if (tl !== undefined && tr !== undefined && br !== undefined && bl !== undefined) {
    if (!(tl === tr && tr === br && br === bl)) {
      figma.cornerRadii = [tl, tr, br, bl];
    }
  }
  const smoothing = asNumber(node.cornerSmoothing);
  if (smoothing !== undefined && smoothing !== 0) figma.cornerSmoothing = smoothing;

  // Stroke details — only emit when at least one extra-key is set.
  const strokeDetails: FigmaStrokeDetails = {};
  const dashPattern = parseNumberArray(node.dashPattern);
  if (dashPattern.length > 0) strokeDetails.dashPattern = dashPattern;
  const sj = asString(node.strokeJoin);
  if (sj === "MITER" || sj === "BEVEL" || sj === "ROUND") strokeDetails.strokeJoin = sj;
  const sc = asString(node.strokeCap);
  if (
    sc === "NONE" ||
    sc === "ROUND" ||
    sc === "SQUARE" ||
    sc === "ARROW_LINES" ||
    sc === "ARROW_EQUILATERAL"
  ) {
    strokeDetails.strokeCap = sc;
  }
  const sml = asNumber(node.strokeMiterLimit);
  if (sml !== undefined && sml !== 4) strokeDetails.strokeMiterLimit = sml;
  const sa = asString(node.strokeAlign);
  if (sa === "INSIDE" || sa === "OUTSIDE" || sa === "CENTER") strokeDetails.strokeAlign = sa;
  const stw = asNumber(node.strokeTopWeight);
  const srw = asNumber(node.strokeRightWeight);
  const sbw = asNumber(node.strokeBottomWeight);
  const slw = asNumber(node.strokeLeftWeight);
  if (stw !== undefined && srw !== undefined && sbw !== undefined && slw !== undefined) {
    // Per-side weights only meaningful when not all equal.
    if (!(stw === srw && srw === sbw && sbw === slw)) {
      strokeDetails.strokeTopWeight = stw;
      strokeDetails.strokeRightWeight = srw;
      strokeDetails.strokeBottomWeight = sbw;
      strokeDetails.strokeLeftWeight = slw;
    }
  }
  if (Object.keys(strokeDetails).length > 0) figma.strokeDetails = strokeDetails;

  // Constraints
  const c = asObject<{ horizontal?: unknown; vertical?: unknown }>(node.constraints);
  if (c) {
    const h = asString(c.horizontal);
    const v = asString(c.vertical);
    const out: { horizontal?: FigmaConstraint; vertical?: FigmaConstraint } = {};
    if (h && CONSTRAINT_VALUES.has(h as FigmaConstraint)) out.horizontal = h as FigmaConstraint;
    if (v && CONSTRAINT_VALUES.has(v as FigmaConstraint)) out.vertical = v as FigmaConstraint;
    if (out.horizontal || out.vertical) {
      // Skip default MIN/MIN.
      if (!(out.horizontal === "MIN" && out.vertical === "MIN")) {
        figma.constraints = out;
      }
    }
  }

  // Layout overrides
  const la = asString(node.layoutAlign);
  if (la && LAYOUT_ALIGN_VALUES.has(la as FigmaLayoutAlign) && la !== "INHERIT") {
    figma.layoutAlign = la as FigmaLayoutAlign;
  }
  const lg = asNumber(node.layoutGrow);
  if (lg === 1) figma.layoutGrow = 1;
  const lp = asString(node.layoutPositioning);
  if (lp === "ABSOLUTE") figma.layoutPositioning = lp;
  const minW = asNumber(node.minWidth);
  if (minW !== undefined) figma.minWidth = minW;
  const maxW = asNumber(node.maxWidth);
  if (maxW !== undefined) figma.maxWidth = maxW;
  const minH = asNumber(node.minHeight);
  if (minH !== undefined) figma.minHeight = minH;
  const maxH = asNumber(node.maxHeight);
  if (maxH !== undefined) figma.maxHeight = maxH;

  if (Object.keys(figma).length > 0) withFigmaMetadata(prim, figma);
  return prim;
}

function parseEffects(raw: unknown): FigmaEffect[] {
  const arr = asArray<unknown>(raw);
  if (!arr) return [];
  const out: FigmaEffect[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const obj = e as Record<string, unknown>;
    const type = asString(obj["type"]);
    if (!type) continue;
    if (asBoolean(obj["visible"]) === false) continue;
    if (SHADOW_TYPES.has(type)) {
      const color = asObject<{ r: unknown; g: unknown; b: unknown; a: unknown }>(obj["color"]);
      const offset = asObject<{ x: unknown; y: unknown }>(obj["offset"]);
      const radius = asNumber(obj["radius"]);
      if (!color || !offset || radius === undefined) continue;
      const r = asNumber(color.r) ?? 0;
      const g = asNumber(color.g) ?? 0;
      const b = asNumber(color.b) ?? 0;
      const a = asNumber(color.a) ?? 1;
      const ox = asNumber(offset.x) ?? 0;
      const oy = asNumber(offset.y) ?? 0;
      const shadow: FigmaEffect = {
        type: type as "DROP_SHADOW" | "INNER_SHADOW",
        color: { r, g, b, a },
        offset: { x: ox, y: oy },
        radius,
      };
      const spread = asNumber(obj["spread"]);
      if (spread !== undefined && spread !== 0) shadow.spread = spread;
      const blend = asString(obj["blendMode"]);
      if (blend && BLEND_MODES.has(blend as FigmaBlendMode) && blend !== "NORMAL") {
        shadow.blendMode = blend as FigmaBlendMode;
      }
      const ssbn = asBoolean(obj["showShadowBehindNode"]);
      if (ssbn === true && shadow.type === "DROP_SHADOW") shadow.showShadowBehindNode = true;
      out.push(shadow);
    } else if (BLUR_TYPES.has(type)) {
      const radius = asNumber(obj["radius"]);
      if (radius === undefined) continue;
      out.push({ type: type as "LAYER_BLUR" | "BACKGROUND_BLUR", radius });
    }
  }
  return out;
}

/** Coerce `node.relativeTransform` (which may be the figma.mixed Symbol or
 *  contain Symbol-wrapped numbers) into a clean `number[][]` 2x3 matrix.
 *  Returns null if the shape doesn't match. */
function parseTransform(raw: unknown): number[][] | null {
  const rows = asArray<unknown>(raw);
  if (!rows || rows.length !== 2) return null;
  const out: number[][] = [];
  for (const r of rows) {
    const cols = asArray<unknown>(r);
    if (!cols || cols.length !== 3) return null;
    const row: number[] = [];
    for (const c of cols) {
      const n = asNumber(c);
      if (n === undefined) return null;
      row.push(n);
    }
    out.push(row);
  }
  return out;
}

function parseNumberArray(raw: unknown): number[] {
  const arr = asArray<unknown>(raw);
  if (!arr) return [];
  const out: number[] = [];
  for (const v of arr) {
    const n = asNumber(v);
    if (n !== undefined) out.push(n);
  }
  return out;
}
