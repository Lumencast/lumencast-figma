// Apply `metadata.figma.*` keys from the `x-figma.authoring/1` profile
// onto a freshly created Figma node. Mirror of
// `src/mapping/figma-extras.ts` for the import side.
//
// Every assignment is defensive : Figma rejects properties that don't
// belong to a node type (e.g. `cornerRadii` on a vector throws "no
// setter for property"). The import is tolerant — we silently skip
// any setter that throws, so partial profile support degrades cleanly
// when a node type doesn't accept a key.

import type { ImportBaseNode } from "./figma-api";
import type {
  FigmaConstraints,
  FigmaEffect,
  FigmaMetadata,
  FigmaPaintMetadata,
  FigmaStrokeDetails,
} from "./figma-metadata";

interface MaybeFigmaWritable {
  relativeTransform?: number[][];
  effects?: unknown[];
  strokes?: unknown[];
  strokeWeight?: number;
  blendMode?: string;
  isMask?: boolean;
  maskType?: string;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  cornerSmoothing?: number;
  strokeJoin?: string;
  strokeCap?: string;
  strokeMiterLimit?: number;
  strokeAlign?: string;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  dashPattern?: number[];
  constraints?: FigmaConstraints;
  layoutAlign?: string;
  layoutGrow?: number;
  layoutPositioning?: string;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
}

export function applyFigmaExtras(node: ImportBaseNode, meta: FigmaMetadata): void {
  const w = node as unknown as MaybeFigmaWritable;

  if (meta.effects && meta.effects.length > 0) {
    // Figma's `node.effects = …` setter is strict : `visible` and
    // `blendMode` are REQUIRED on shadow effects, `radius` is required
    // on every type, etc. Our export side optimises by skipping default
    // values (visible=true, blendMode=NORMAL, spread=0) — for re-import
    // we must put them back, otherwise the whole assignment throws and
    // safeSet swallows it silently leaving the node effect-less.
    const normalised = meta.effects.map(normaliseEffectForFigma);
    safeSet(() => (w.effects = normalised));
  }
  if (meta.strokes && meta.strokes.length > 0) {
    const paints = meta.strokes
      .map(figmaPaintMetadataToImportStroke)
      .filter((p): p is unknown => p !== null);
    if (paints.length > 0) safeSet(() => (w.strokes = paints));
    if (meta.strokeWeight !== undefined) {
      const sw = meta.strokeWeight;
      safeSet(() => (w.strokeWeight = sw));
    }
  }
  if (meta.blendMode && meta.blendMode !== "PASS_THROUGH" && meta.blendMode !== "NORMAL") {
    const v = meta.blendMode;
    safeSet(() => (w.blendMode = v));
  }
  if (meta.isMask === true) {
    safeSet(() => (w.isMask = true));
    if (meta.maskType) {
      const v = meta.maskType;
      safeSet(() => (w.maskType = v));
    }
  }
  if (meta.cornerRadii) {
    const [tl, tr, br, bl] = meta.cornerRadii;
    safeSet(() => (w.topLeftRadius = tl));
    safeSet(() => (w.topRightRadius = tr));
    safeSet(() => (w.bottomRightRadius = br));
    safeSet(() => (w.bottomLeftRadius = bl));
  }
  if (meta.cornerSmoothing !== undefined && meta.cornerSmoothing !== 0) {
    const v = meta.cornerSmoothing;
    safeSet(() => (w.cornerSmoothing = v));
  }
  if (meta.strokeDetails) applyStrokeDetails(w, meta.strokeDetails);
  if (meta.constraints && (meta.constraints.horizontal || meta.constraints.vertical)) {
    const v = meta.constraints;
    safeSet(() => (w.constraints = v));
  }
  if (meta.layoutAlign && meta.layoutAlign !== "INHERIT") {
    const v = meta.layoutAlign;
    safeSet(() => (w.layoutAlign = v));
  }
  if (meta.layoutGrow === 1) safeSet(() => (w.layoutGrow = 1));
  if (meta.layoutPositioning === "ABSOLUTE") {
    safeSet(() => (w.layoutPositioning = "ABSOLUTE"));
  }
  if (meta.minWidth !== undefined && meta.minWidth !== null) {
    const v = meta.minWidth;
    safeSet(() => (w.minWidth = v));
  }
  if (meta.maxWidth !== undefined && meta.maxWidth !== null) {
    const v = meta.maxWidth;
    safeSet(() => (w.maxWidth = v));
  }
  if (meta.minHeight !== undefined && meta.minHeight !== null) {
    const v = meta.minHeight;
    safeSet(() => (w.minHeight = v));
  }
  if (meta.maxHeight !== undefined && meta.maxHeight !== null) {
    const v = meta.maxHeight;
    safeSet(() => (w.maxHeight = v));
  }

  // Apply the flip-preserving transform LAST when present : Figma's
  // `node.relativeTransform = matrix` overrides x / y / rotation in one
  // atomic write, restoring not just position+rotation but also flip
  // (negative-determinant linear part). When the source had no flip we
  // never emit `meta.transform`, so this is a no-op for plain rotated
  // nodes.
  if (meta.transform && meta.transform.length === 2) {
    const v = meta.transform;
    safeSet(() => (w.relativeTransform = v));
  }
}

function applyStrokeDetails(w: MaybeFigmaWritable, sd: FigmaStrokeDetails): void {
  if (sd.dashPattern) {
    const v = sd.dashPattern;
    safeSet(() => (w.dashPattern = v));
  }
  if (sd.strokeJoin) {
    const v = sd.strokeJoin;
    safeSet(() => (w.strokeJoin = v));
  }
  if (sd.strokeCap) {
    const v = sd.strokeCap;
    safeSet(() => (w.strokeCap = v));
  }
  if (sd.strokeMiterLimit !== undefined) {
    const v = sd.strokeMiterLimit;
    safeSet(() => (w.strokeMiterLimit = v));
  }
  if (sd.strokeAlign) {
    const v = sd.strokeAlign;
    safeSet(() => (w.strokeAlign = v));
  }
  if (sd.strokeTopWeight !== undefined) {
    const v = sd.strokeTopWeight;
    safeSet(() => (w.strokeTopWeight = v));
  }
  if (sd.strokeRightWeight !== undefined) {
    const v = sd.strokeRightWeight;
    safeSet(() => (w.strokeRightWeight = v));
  }
  if (sd.strokeBottomWeight !== undefined) {
    const v = sd.strokeBottomWeight;
    safeSet(() => (w.strokeBottomWeight = v));
  }
  if (sd.strokeLeftWeight !== undefined) {
    const v = sd.strokeLeftWeight;
    safeSet(() => (w.strokeLeftWeight = v));
  }
}

function safeSet(fn: () => void): void {
  try {
    fn();
  } catch {
    // Real Figma rejects properties that don't belong to a node type
    // (e.g. cornerRadii on a vector). Silently skip — visual fidelity
    // for that key is forfeited but the node still imports.
  }
}

/** Reconstruct a full Figma effect object with required fields back-
 *  filled. Figma's `node.effects = …` setter rejects partial entries
 *  (e.g. an INNER_SHADOW without `visible` and `blendMode`) — and
 *  rejection of any single entry causes the whole assignment to throw.
 *  We strip the export-side optimisation by re-introducing defaults. */
function normaliseEffectForFigma(e: FigmaEffect): unknown {
  if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
    const out: Record<string, unknown> = {
      type: e.type,
      color: e.color,
      offset: e.offset,
      radius: e.radius,
      spread: e.spread ?? 0,
      visible: e.visible ?? true,
      blendMode: e.blendMode ?? "NORMAL",
    };
    if (e.type === "DROP_SHADOW") {
      out["showShadowBehindNode"] =
        (e as { showShadowBehindNode?: boolean }).showShadowBehindNode ?? false;
    }
    return out;
  }
  if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
    return {
      type: e.type,
      radius: e.radius,
      visible: e.visible ?? true,
      blurType: e.blurType ?? "NORMAL",
    };
  }
  if (e.type === "NOISE") {
    return {
      type: "NOISE",
      visible: e.visible ?? true,
      noiseSize: e.noiseSize,
      noiseSizeVector: e.noiseSizeVector ?? { x: e.noiseSize, y: e.noiseSize },
      noiseType: e.noiseType,
      density: e.density,
      ...(e.color !== undefined ? { color: e.color } : {}),
      ...(e.secondaryColor !== undefined ? { secondaryColor: e.secondaryColor } : {}),
    };
  }
  if (e.type === "TEXTURE") {
    return {
      type: "TEXTURE",
      visible: e.visible ?? true,
      radius: e.radius,
      noiseSize: e.noiseSize,
      noiseSizeVector: e.noiseSizeVector ?? { x: e.noiseSize, y: e.noiseSize },
      clipToShape: e.clipToShape ?? false,
    };
  }
  if (e.type === "GLASS") {
    return {
      type: "GLASS",
      visible: e.visible ?? true,
      radius: e.radius,
      refraction: e.refraction,
      depth: e.depth,
      lightAngle: e.lightAngle,
      lightIntensity: e.lightIntensity,
      dispersion: e.dispersion,
      splay: e.splay,
    };
  }
  return e;
}

/** Reconstruct a Figma stroke paint object from the serialised
 *  `metadata.figma.strokes[]` entry. Same paint shape as fills — passed
 *  to `node.strokes = …` so per-stroke blendMode/opacity + gradient
 *  transforms survive the round-trip. */
function figmaPaintMetadataToImportStroke(p: FigmaPaintMetadata): unknown {
  if (p.type === "SOLID") {
    if (!p.color) return null;
    const out: Record<string, unknown> = { type: "SOLID", color: p.color };
    if (p.opacity !== undefined && p.opacity !== 1) out["opacity"] = p.opacity;
    if (p.visible === false) out["visible"] = false;
    if (p.blendMode) out["blendMode"] = p.blendMode;
    return out;
  }
  if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL") {
    if (!p.gradientStops || p.gradientStops.length < 1) return null;
    const transform =
      p.gradientTransform && p.gradientTransform.length === 2
        ? p.gradientTransform
        : [
            [1, 0, 0],
            [0, 1, 0],
          ];
    const out: Record<string, unknown> = {
      type: p.type,
      gradientStops: p.gradientStops,
      gradientTransform: transform,
    };
    if (p.opacity !== undefined && p.opacity !== 1) out["opacity"] = p.opacity;
    if (p.visible === false) out["visible"] = false;
    if (p.blendMode) out["blendMode"] = p.blendMode;
    return out;
  }
  return null;
}
