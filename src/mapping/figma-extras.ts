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
  type FigmaGuide,
  type FigmaLayoutAlign,
  type FigmaLayoutGrid,
  type FigmaMaskType,
  type FigmaMetadata,
  type FigmaStrokeDetails,
} from "./figma-metadata";

interface MaybeFigmaNode {
  relativeTransform?: unknown;
  effects?: unknown;
  strokes?: unknown;
  strokeWeight?: unknown;
  blendMode?: unknown;
  isMask?: unknown;
  maskType?: unknown;
  cornerRadius?: unknown;
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
  layoutSizingHorizontal?: unknown;
  layoutSizingVertical?: unknown;
  layoutGrids?: unknown;
  guides?: unknown;
}

const SHADOW_TYPES = new Set(["DROP_SHADOW", "INNER_SHADOW"]);
const BLUR_TYPES = new Set(["LAYER_BLUR", "BACKGROUND_BLUR"]);
const NOISE_TYPES = new Set(["MONOTONE", "MULTITONE", "DUOTONE"]);

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

export interface CaptureFigmaExtrasOptions {
  /** LSML position the per-primitive mapper just emitted (relative to the
   *  LSML parent). Used as a fallback translation when capturing a flipped
   *  transform under a coord-system parent (legacy det<0 path) — the
   *  matrix's translation is rewritten to the LSML position so that
   *  applying `node.relativeTransform = matrix` on import lands the
   *  visual at the correct local coordinates.
   *
   *  Ignored when `parentIsTransparent` is true : in that case the raw
   *  `relativeTransform` is captured verbatim (frame-ancestor-relative)
   *  and the importer applies it directly to the flat-then-group path. */
  localPosition?: { x: number; y: number };
  /** True when the immediate source parent is GROUP / BOOLEAN_OPERATION
   *  (a non-coord-system "transparent" container). Triggers 2x3
   *  `relativeTransform` capture composed with `groupChainTransform` so
   *  the result is expressed in the FRAME ancestor's coord system —
   *  exactly where the importer will mount the child after `figma.group()`. */
  parentIsTransparent?: boolean;
  /** Composed `relativeTransform` of every transparent-Group ancestor
   *  between the FRAME ancestor (exclusive) and the current node
   *  (exclusive). Multiplied with the node's own `relativeTransform` so
   *  the captured matrix is FRAME-ancestor-relative regardless of nesting
   *  depth. Identity (undefined) when the immediate parent is the FRAME
   *  ancestor itself. */
  groupChainTransform?: number[][];
}

/** Capture every profile-relevant property and merge into prim.metadata.figma.
 *  No-op when the host node exposes nothing of interest. */
export function captureFigmaExtras<T extends { metadata?: Record<string, unknown> }>(
  node: MaybeFigmaNode,
  prim: T,
  opts?: CaptureFigmaExtrasOptions,
): T {
  const figma: FigmaMetadata = {};

  // Transform capture for transparent-group children.
  //
  // Figma's GROUP / BOOLEAN_OPERATION are non-coord-system "transparent"
  // containers : their direct children's `relativeTransform` is expressed
  // in the FRAME ancestor's coord system, NOT in the GROUP's local frame.
  // When the importer turns a GROUP source into a real Figma GroupNode
  // (flat-then-group path : children built directly under the FRAME
  // ancestor, then `figma.group()` wraps them), it needs the raw matrix
  // to set `child.relativeTransform = matrix` and reproduce position +
  // rotation + flip + skew exactly.
  //
  // We capture verbatim — no tx/ty rewriting, no det check. Rotation,
  // flip, mirroring, skew, all live in the matrix. The child's
  // `extractUniversal` rotation is suppressed for the same parent
  // (see universal.ts) so the importer doesn't double-apply.
  //
  // Children of FRAME / STACK (coord-system parents) don't need this :
  // the LSML position + rotation are already lossless for them.
  if (opts?.parentIsTransparent) {
    // Verbatim capture. Figma's API returns each node's `relativeTransform`
    // in the FRAME ancestor's coord system whenever every container above
    // it (up to the FRAME) is a transparent GROUP / BOOLEAN_OPERATION ;
    // the same holds for nested groups, since none of them redefine the
    // origin. Composing with the parent group's `relativeTransform` would
    // therefore add the group's translation a second time and place the
    // leaf at twice the intended offset on import (the importer's
    // flat-then-group path applies this matrix directly under the FRAME
    // ancestor). `opts.groupChainTransform` is intentionally ignored.
    const transform = parseTransform(node.relativeTransform);
    if (transform) {
      figma.transform = [
        [transform[0]![0]!, transform[0]![1]!, transform[0]![2]!],
        [transform[1]![0]!, transform[1]![1]!, transform[1]![2]!],
      ];
    }
  } else {
    // Legacy fallback : flipped leaf inside a coord-system parent
    // (FRAME / STACK). Without this, a flipped Vector inside a regular
    // Frame loses its mirror on re-import (Figma's `node.rotation`
    // getter only carries the magnitude, not the flip orientation).
    // The matrix's translation is rewritten to the LSML-local position
    // so applying `node.relativeTransform = matrix` on import lands the
    // leaf at the correct local coordinates relative to its immediate
    // LSML parent (which equals the source's immediate parent here —
    // no flat-then-group path involved).
    const transform = parseTransform(node.relativeTransform);
    if (transform) {
      const det = transform[0]![0]! * transform[1]![1]! - transform[0]![1]! * transform[1]![0]!;
      if (det < 0) {
        const tx = opts?.localPosition?.x ?? 0;
        const ty = opts?.localPosition?.y ?? 0;
        figma.transform = [
          [transform[0]![0]!, transform[0]![1]!, tx],
          [transform[1]![0]!, transform[1]![1]!, ty],
        ];
      }
    }
  }

  // Effects
  const effects = parseEffects(node.effects);
  if (effects.length > 0) figma.effects = effects;

  // Stroke paints (any type) + uniform stroke weight. Stash always —
  // text and frame have no LSML stroke representation, and shape's
  // LSML `Stroke` only carries SOLID color + width. The import side
  // applies via `node.strokes = …` and `node.strokeWeight = …`.
  const strokes = parseStrokePaints(node.strokes);
  if (strokes.length > 0) {
    figma.strokes = strokes;
    const sw = asNumber(node.strokeWeight);
    if (sw !== undefined) figma.strokeWeight = sw;
  }

  // Blend mode (skip default)
  const blend = asString(node.blendMode);
  if (
    blend &&
    BLEND_MODES.has(blend as FigmaBlendMode) &&
    blend !== "PASS_THROUGH" &&
    blend !== "NORMAL"
  ) {
    figma.blendMode = blend as FigmaBlendMode;
  }

  // Mask
  if (asBoolean(node.isMask) === true) {
    figma.isMask = true;
    const mt = asString(node.maskType);
    if (mt && MASK_TYPES.has(mt as FigmaMaskType)) figma.maskType = mt as FigmaMaskType;
  }

  // Uniform cornerRadius — frame and stack primitives have no native
  // LSML field for this (only shape's `cornerRadius` is first-class), so
  // round-trip via metadata.figma.cornerRadius. Without this, button
  // pills (`cornerRadius: 33554400` for max curvature), rounded card
  // headers (`cornerRadius: 18`), avatar circles, etc. lose their
  // shape on re-import. Shape primitives also pass through here ; the
  // doublon with shape's native `cornerRadius` is harmless (~few bytes,
  // applyFigmaExtras becomes a no-op idempotent setter).
  const cr = asNumber(node.cornerRadius);
  if (cr !== undefined && cr !== 0) figma.cornerRadius = cr;

  // Per-corner radii — only emit when at least one corner differs from the
  // others (otherwise the uniform `cornerRadius` capture above covers it).
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

  // Stroke details — only emit when the node has actual strokes. Figma
  // exposes strokeAlign/Join/Cap/MiterLimit/per-side weights as defaults
  // on every node regardless of whether it paints any stroke ; capturing
  // them when `strokes` is empty pollutes the bundle and triggers a
  // phantom 1px stroke on import (the import side's defaults + the
  // metadata-restored alignment combine into a visible stroke). Gating on
  // `strokes.length > 0` mirrors the `figma.strokes` / `strokeWeight`
  // capture above and keeps stroke metadata consistent.
  if (strokes.length > 0) {
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
  }

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

  // Layout overrides. Note : Figma deprecated `layoutAlign: "CENTER"` —
  // the modern API rejects it ("CENTER is no longer a supported value
  // for layoutAlign"). The equivalent is `counterAxisAlignItems` on the
  // parent ; without a backref we can't translate it, so we drop CENTER
  // at capture time to avoid noisy import warnings + lost setter writes.
  const la = asString(node.layoutAlign);
  if (
    la &&
    LAYOUT_ALIGN_VALUES.has(la as FigmaLayoutAlign) &&
    la !== "INHERIT" &&
    la !== "CENTER"
  ) {
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

  // Per-axis sizing modes (FIXED / HUG / FILL). Captured for any node
  // that exposes them — frame, stack, text. Critical for stacks whose
  // dimensions are explicit (FIXED) : without restoring the mode, the
  // import collapses to HUG and the frame shrinks to its content.
  const lsh = asString(node.layoutSizingHorizontal);
  if (lsh === "FIXED" || lsh === "HUG" || lsh === "FILL") figma.layoutSizingHorizontal = lsh;
  const lsv = asString(node.layoutSizingVertical);
  if (lsv === "FIXED" || lsv === "HUG" || lsv === "FILL") figma.layoutSizingVertical = lsv;

  // Layout grids (frame-level rulers) — columns / rows / pixel grid that
  // designers configure via Figma's *Layout grid* panel. Captured verbatim
  // and re-applied so re-imports keep the same alignment scaffolding.
  const grids = parseLayoutGrids(node.layoutGrids);
  if (grids.length > 0) figma.layoutGrids = grids;

  // Guides — frame-level vertical (X) / horizontal (Y) ruler markers.
  // Anchored at integer offsets ; round-tripped as-is.
  const guides = parseGuides(node.guides);
  if (guides.length > 0) figma.guides = guides;

  if (Object.keys(figma).length > 0) withFigmaMetadata(prim, figma);
  return prim;
}

/** Parse `node.layoutGrids` into the metadata shape. Skips invisible
 *  default entries with no useful keys. */
function parseLayoutGrids(raw: unknown): FigmaLayoutGrid[] {
  const arr = asArray<unknown>(raw);
  if (!arr) return [];
  const out: FigmaLayoutGrid[] = [];
  for (const g of arr) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const pattern = asString(obj["pattern"]);
    if (pattern !== "ROWS" && pattern !== "COLUMNS" && pattern !== "GRID") continue;
    const entry: FigmaLayoutGrid = { pattern };
    const visible = asBoolean(obj["visible"]);
    if (visible === false) entry.visible = false;
    const color = asObject<{ r: unknown; g: unknown; b: unknown; a: unknown }>(obj["color"]);
    if (color) {
      entry.color = {
        r: asNumber(color.r) ?? 0,
        g: asNumber(color.g) ?? 0,
        b: asNumber(color.b) ?? 0,
        a: asNumber(color.a) ?? 1,
      };
    }
    if (pattern === "ROWS" || pattern === "COLUMNS") {
      const alignment = asString(obj["alignment"]);
      if (
        alignment === "MIN" ||
        alignment === "MAX" ||
        alignment === "CENTER" ||
        alignment === "STRETCH"
      ) {
        entry.alignment = alignment;
      }
      const gutter = asNumber(obj["gutterSize"]);
      if (gutter !== undefined) entry.gutterSize = gutter;
      const count = asNumber(obj["count"]);
      if (count !== undefined) entry.count = count;
      const section = asNumber(obj["sectionSize"]);
      if (section !== undefined) entry.sectionSize = section;
      const offset = asNumber(obj["offset"]);
      if (offset !== undefined) entry.offset = offset;
    } else {
      // GRID — only sectionSize is meaningful.
      const section = asNumber(obj["sectionSize"]);
      if (section !== undefined) entry.sectionSize = section;
    }
    out.push(entry);
  }
  return out;
}

/** Parse `node.guides` (frame-level ruler guides). Each entry is `{ axis,
 *  offset }` with `axis: "X"` for vertical guides and `"Y"` for horizontal. */
function parseGuides(raw: unknown): FigmaGuide[] {
  const arr = asArray<unknown>(raw);
  if (!arr) return [];
  const out: FigmaGuide[] = [];
  for (const g of arr) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const axis = asString(obj["axis"]);
    const offset = asNumber(obj["offset"]);
    if ((axis !== "X" && axis !== "Y") || offset === undefined) continue;
    out.push({ axis, offset });
  }
  return out;
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
      const blur: FigmaEffect = { type: type as "LAYER_BLUR" | "BACKGROUND_BLUR", radius };
      const bt = asString(obj["blurType"]);
      if (bt === "NORMAL" || bt === "PROGRESSIVE") {
        (blur as { blurType?: "NORMAL" | "PROGRESSIVE" }).blurType = bt;
      }
      out.push(blur);
    } else if (type === "NOISE") {
      const noiseSize = asNumber(obj["noiseSize"]);
      const noiseType = asString(obj["noiseType"]);
      const density = asNumber(obj["density"]);
      if (
        noiseSize === undefined ||
        !noiseType ||
        !NOISE_TYPES.has(noiseType) ||
        density === undefined
      )
        continue;
      const e: FigmaEffect = {
        type: "NOISE",
        noiseSize,
        noiseType: noiseType as "MONOTONE" | "MULTITONE" | "DUOTONE",
        density,
      };
      const v = asObject<{ x: unknown; y: unknown }>(obj["noiseSizeVector"]);
      if (v) {
        const x = asNumber(v.x);
        const y = asNumber(v.y);
        if (x !== undefined && y !== undefined)
          (e as { noiseSizeVector?: { x: number; y: number } }).noiseSizeVector = { x, y };
      }
      const color = asObject<{ r: unknown; g: unknown; b: unknown; a: unknown }>(obj["color"]);
      if (color) {
        const r = asNumber(color.r) ?? 0;
        const g = asNumber(color.g) ?? 0;
        const b = asNumber(color.b) ?? 0;
        const a = asNumber(color.a) ?? 1;
        (e as { color?: { r: number; g: number; b: number; a: number } }).color = { r, g, b, a };
      }
      const sc = asObject<{ r: unknown; g: unknown; b: unknown; a: unknown }>(
        obj["secondaryColor"],
      );
      if (sc) {
        const r = asNumber(sc.r) ?? 0;
        const g = asNumber(sc.g) ?? 0;
        const b = asNumber(sc.b) ?? 0;
        const a = asNumber(sc.a) ?? 1;
        (e as { secondaryColor?: { r: number; g: number; b: number; a: number } }).secondaryColor =
          { r, g, b, a };
      }
      out.push(e);
    } else if (type === "TEXTURE") {
      const radius = asNumber(obj["radius"]);
      const noiseSize = asNumber(obj["noiseSize"]);
      if (radius === undefined || noiseSize === undefined) continue;
      const e: FigmaEffect = { type: "TEXTURE", radius, noiseSize };
      const v = asObject<{ x: unknown; y: unknown }>(obj["noiseSizeVector"]);
      if (v) {
        const x = asNumber(v.x);
        const y = asNumber(v.y);
        if (x !== undefined && y !== undefined)
          (e as { noiseSizeVector?: { x: number; y: number } }).noiseSizeVector = { x, y };
      }
      const clip = asBoolean(obj["clipToShape"]);
      if (clip !== undefined) (e as { clipToShape?: boolean }).clipToShape = clip;
      out.push(e);
    } else if (type === "GLASS") {
      const radius = asNumber(obj["radius"]);
      const refraction = asNumber(obj["refraction"]);
      const depth = asNumber(obj["depth"]);
      const lightAngle = asNumber(obj["lightAngle"]);
      const lightIntensity = asNumber(obj["lightIntensity"]);
      const dispersion = asNumber(obj["dispersion"]);
      const splay = asNumber(obj["splay"]);
      if (
        radius === undefined ||
        refraction === undefined ||
        depth === undefined ||
        lightAngle === undefined ||
        lightIntensity === undefined ||
        dispersion === undefined ||
        splay === undefined
      )
        continue;
      out.push({
        type: "GLASS",
        radius,
        refraction,
        depth,
        lightAngle,
        lightIntensity,
        dispersion,
        splay,
      });
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

/** Parse a Figma `node.strokes` array into FigmaPaintMetadata entries.
 *  Same shape as `paintToFigmaMetadata` in text.ts but for strokes ;
 *  used by the universal capture so text + frame + shape (non-SOLID)
 *  strokes round-trip with the full paint surface. */
function parseStrokePaints(raw: unknown): NonNullable<FigmaMetadata["strokes"]> {
  const arr = asArray<unknown>(raw);
  if (!arr) return [];
  const out: NonNullable<FigmaMetadata["strokes"]> = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const type = asString(obj["type"]);
    if (type !== "SOLID" && type !== "GRADIENT_LINEAR" && type !== "GRADIENT_RADIAL") continue;
    const entry: NonNullable<FigmaMetadata["strokes"]>[number] = { type };
    if (asBoolean(obj["visible"]) === false) entry.visible = false;
    const op = asNumber(obj["opacity"]);
    if (op !== undefined && op !== 1) entry.opacity = op;
    const blend = asString(obj["blendMode"]);
    if (
      blend &&
      BLEND_MODES.has(blend as FigmaBlendMode) &&
      blend !== "NORMAL" &&
      blend !== "PASS_THROUGH"
    ) {
      entry.blendMode = blend as FigmaBlendMode;
    }
    if (type === "SOLID") {
      const color = asObject<{ r: unknown; g: unknown; b: unknown }>(obj["color"]);
      if (!color) continue;
      const r = asNumber(color.r) ?? 0;
      const g = asNumber(color.g) ?? 0;
      const b = asNumber(color.b) ?? 0;
      entry.color = { r, g, b };
    } else {
      const stops = asArray<unknown>(obj["gradientStops"]);
      if (!stops) continue;
      const cleaned: NonNullable<typeof entry.gradientStops> = [];
      for (const s of stops) {
        if (!s || typeof s !== "object") continue;
        const so = s as Record<string, unknown>;
        const pos = asNumber(so["position"]);
        const c = asObject<{ r: unknown; g: unknown; b: unknown; a: unknown }>(so["color"]);
        if (pos === undefined || !c) continue;
        cleaned.push({
          position: pos,
          color: {
            r: asNumber(c.r) ?? 0,
            g: asNumber(c.g) ?? 0,
            b: asNumber(c.b) ?? 0,
            a: asNumber(c.a) ?? 1,
          },
        });
      }
      if (cleaned.length === 0) continue;
      entry.gradientStops = cleaned;
      const t = asArray<unknown>(obj["gradientTransform"]);
      if (t && t.length === 2) {
        const r0 = asArray<unknown>(t[0]);
        const r1 = asArray<unknown>(t[1]);
        if (r0 && r1 && r0.length === 3 && r1.length === 3) {
          entry.gradientTransform = [
            [asNumber(r0[0]) ?? 0, asNumber(r0[1]) ?? 0, asNumber(r0[2]) ?? 0],
            [asNumber(r1[0]) ?? 0, asNumber(r1[1]) ?? 0, asNumber(r1[2]) ?? 0],
          ];
        }
      }
    }
    out.push(entry);
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
