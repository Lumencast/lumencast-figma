// `metadata.figma.*` schema for the `x-figma.authoring/1` profile.
// Mirrors `lumencast-protocol/spec/profiles/figma-authoring.md`.
//
// Keys here are the export-side canonical shape. The `withFigmaMetadata`
// helper merges new keys into a primitive's existing `metadata.figma`
// block (early versions overwrote the whole block — only the last writer
// won, so multi-category captures lost data).
//
// Renderers / re-importers that don't speak the profile silently ignore
// every key here per LSML §17.4. Importers that DO speak it (this plugin)
// read each key and re-apply it on the created Figma node.

// ---------- Effects (drop / inner shadow, layer / background blur) ----------

export type FigmaEffectType = "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";

export interface FigmaEffectShadow {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  visible?: boolean;
  /** RGBA in 0..1. */
  color: { r: number; g: number; b: number; a: number };
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  /** Figma blend mode applied to the shadow. */
  blendMode?: FigmaBlendMode;
  /** DROP_SHADOW only — DEFAULT false. */
  showShadowBehindNode?: boolean;
}

export interface FigmaEffectBlur {
  type: "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  radius: number;
}

export type FigmaEffect = FigmaEffectShadow | FigmaEffectBlur;

// ---------- Blend mode (Figma's 19 modes) ----------

export type FigmaBlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

// ---------- Mask ----------

export type FigmaMaskType = "ALPHA" | "LUMINANCE" | "VECTOR" | "OUTLINE";

// ---------- Stroke details ----------

export interface FigmaStrokeDetails {
  /** [on, off, on, off, ...] in pixels. */
  dashPattern?: number[];
  strokeJoin?: "MITER" | "BEVEL" | "ROUND";
  strokeCap?: "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL";
  strokeMiterLimit?: number;
  /** "INSIDE" | "OUTSIDE" | "CENTER". */
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  /** Per-side weights for asymmetric borders. When set, override the
   *  primitive's `strokeWeight`. */
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
}

// ---------- Constraints (resize behaviour) ----------

export type FigmaConstraint = "MIN" | "MAX" | "CENTER" | "STRETCH" | "SCALE";

export interface FigmaConstraints {
  horizontal?: FigmaConstraint;
  vertical?: FigmaConstraint;
}

// ---------- Layout overrides (per-child auto-layout escape) ----------

export type FigmaLayoutAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";

export interface FigmaGradientStop {
  position: number;
  color: string; // CSS color
  opacity?: number;
}

// ---------- Hyperlinks (text) ----------

export interface FigmaHyperlink {
  /** [start, endExclusive] character range. */
  range: [number, number];
  url: string;
}

// ---------- Top-level shape ----------

export interface FigmaMetadata {
  /** Original Figma `node.name` including any `[bind:...]` directive prefix. */
  layerName?: string;

  // --- Geometry / layout fallbacks ---

  /** @deprecated since v0.2 — use universal `position` (LSML §5.4). Kept
   *  for back-compat reads of v0.1 bundles. */
  position?: { x: number; y: number };
  /** @deprecated since v0.2 — `shape.size` is now first-class for path
   *  geometry. Kept for v0.1 reads. */
  size?: { w: number; h: number };
  /** @deprecated since v0.2 — use `frame.clipsContent` (LSML §4.3). Kept
   *  for v0.1 reads. */
  clipsContent?: boolean;

  /** Figma's raw 2x3 affine transform `[[m00, m01, tx], [m10, m11, ty]]`.
   *  Captured ONLY when the linear part has a negative determinant — i.e.
   *  the node has been flipped horizontally or vertically. For pure
   *  rotations + translations the LSML universal `position` + `rotation`
   *  cover everything ; we don't pollute the bundle.
   *
   *  Why this matters : Figma's `node.rotation` getter alone cannot
   *  distinguish a rotation θ from a (flip + rotation) pair that looks
   *  the same visually but differs in orientation. Re-applying rotation
   *  only on import drops the flip and the rendered visual is the mirror
   *  of the source. Re-applying the full `relativeTransform` preserves it.
   *  (Documented in `spec/profiles/figma-authoring.md`.) */
  transform?: number[][];

  // --- Visual layering ---

  /** Effects stack — applied in array order at render time. */
  effects?: FigmaEffect[];
  /** Per-node blend mode. Default PASS_THROUGH (containers) / NORMAL (leaves). */
  blendMode?: FigmaBlendMode;
  /** When true, this node is the mask shape for its later siblings. */
  isMask?: boolean;
  /** Mask interpretation (only meaningful when `isMask: true`). */
  maskType?: FigmaMaskType;

  // --- Per-corner radii + smoothing ---

  /** [topLeft, topRight, bottomRight, bottomLeft]. Overrides `cornerRadius`. */
  cornerRadii?: [number, number, number, number];
  /** 0..1. 0 = pure rounded rectangle, 1 = full Apple squircle. */
  cornerSmoothing?: number;

  // --- Stroke details ---

  strokeDetails?: FigmaStrokeDetails;

  // --- Constraints / layout overrides ---

  constraints?: FigmaConstraints;
  layoutAlign?: FigmaLayoutAlign;
  /** 0 (no growth) or 1 (fill remaining axis). */
  layoutGrow?: 0 | 1;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;

  // --- Gradient extras ---

  /** Parallel-indexed with `fills[]` / `backgrounds[]`. Each entry is the
   *  verbatim Figma stop list for that fill — captures sub-percent
   *  positions and per-stop opacity that LSML's `Fill.linear-gradient.stops`
   *  loses. */
  gradientStops?: (FigmaGradientStop[] | null)[];
  /** Raw 2x3 affine matrices for gradient handles. Parallel-indexed with
   *  `fills[]` ; null entries mark non-gradient fills (solid, image). */
  gradientTransforms?: (number[][] | null)[];

  // --- Text extras ---

  /** SMALL_CAPS / SMALL_CAPS_FORCED — cases not representable in
   *  `style.textTransform`. UPPER/LOWER/TITLE belong in style.textTransform. */
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  /** Raw Figma `fontName.style` ("Bold Italic", "SemiBold", ...). */
  fontStyle?: string;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  textTruncation?: "DISABLED" | "ENDING";
  /** Only meaningful when `textTruncation: ENDING`. */
  maxLines?: number;
  hyperlinks?: FigmaHyperlink[];
}

/** Decorate a primitive's `metadata` block with figma-specific keys. Only
 *  emits a metadata block when at least one figma key is non-empty.
 *
 *  Mappers call this multiple times during a single primitive's
 *  construction (once per category : position, gradient transforms,
 *  layer name, effects, ...). Each call merges its keys into any
 *  pre-existing `figma` sub-block — early versions OVERWROTE the block,
 *  losing fields set by previous calls. */
export function withFigmaMetadata<T extends { metadata?: Record<string, unknown> }>(
  prim: T,
  figma: FigmaMetadata,
): T {
  const filtered = pruneEmpty(figma);
  if (Object.keys(filtered).length === 0) return prim;
  const existing = (prim.metadata?.["figma"] as FigmaMetadata | undefined) ?? {};
  prim.metadata = {
    ...(prim.metadata ?? {}),
    figma: { ...existing, ...filtered },
  };
  return prim;
}

/** Read the figma metadata block off a primitive, type-narrowing the
 *  freeform `metadata` field. Returns an empty object when absent. */
export function readFigmaMetadata(prim: { metadata?: Record<string, unknown> }): FigmaMetadata {
  const meta = prim.metadata?.["figma"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as FigmaMetadata;
}

function pruneEmpty(meta: FigmaMetadata): FigmaMetadata {
  const out: FigmaMetadata = {};
  if (meta.layerName) out.layerName = meta.layerName;
  if (meta.transform && meta.transform.length === 2) out.transform = meta.transform;
  if (meta.position && (meta.position.x !== 0 || meta.position.y !== 0)) {
    out.position = meta.position;
  }
  if (meta.size && (meta.size.w > 0 || meta.size.h > 0)) {
    out.size = meta.size;
  }
  if (meta.clipsContent !== undefined) out.clipsContent = meta.clipsContent;
  if (meta.effects && meta.effects.length > 0) out.effects = meta.effects;
  if (meta.blendMode && meta.blendMode !== "PASS_THROUGH" && meta.blendMode !== "NORMAL") {
    out.blendMode = meta.blendMode;
  }
  if (meta.isMask) out.isMask = meta.isMask;
  if (meta.maskType) out.maskType = meta.maskType;
  if (meta.cornerRadii) out.cornerRadii = meta.cornerRadii;
  if (meta.cornerSmoothing !== undefined && meta.cornerSmoothing !== 0) {
    out.cornerSmoothing = meta.cornerSmoothing;
  }
  if (meta.strokeDetails && Object.keys(meta.strokeDetails).length > 0) {
    out.strokeDetails = meta.strokeDetails;
  }
  if (meta.constraints && (meta.constraints.horizontal || meta.constraints.vertical)) {
    out.constraints = meta.constraints;
  }
  if (meta.layoutAlign && meta.layoutAlign !== "INHERIT") out.layoutAlign = meta.layoutAlign;
  if (meta.layoutGrow !== undefined && meta.layoutGrow !== 0) out.layoutGrow = meta.layoutGrow;
  if (meta.layoutPositioning && meta.layoutPositioning !== "AUTO") {
    out.layoutPositioning = meta.layoutPositioning;
  }
  if (meta.minWidth !== undefined && meta.minWidth !== null) out.minWidth = meta.minWidth;
  if (meta.maxWidth !== undefined && meta.maxWidth !== null) out.maxWidth = meta.maxWidth;
  if (meta.minHeight !== undefined && meta.minHeight !== null) out.minHeight = meta.minHeight;
  if (meta.maxHeight !== undefined && meta.maxHeight !== null) out.maxHeight = meta.maxHeight;
  if (meta.gradientStops && meta.gradientStops.some((s) => s !== null && s.length > 0)) {
    out.gradientStops = meta.gradientStops;
  }
  if (meta.gradientTransforms && meta.gradientTransforms.some((t) => t !== null)) {
    out.gradientTransforms = meta.gradientTransforms;
  }
  if (meta.textCase && meta.textCase !== "ORIGINAL") out.textCase = meta.textCase;
  if (meta.fontStyle) out.fontStyle = meta.fontStyle;
  if (meta.textAutoResize && meta.textAutoResize !== "NONE") out.textAutoResize = meta.textAutoResize;
  if (meta.paragraphSpacing !== undefined && meta.paragraphSpacing !== 0) {
    out.paragraphSpacing = meta.paragraphSpacing;
  }
  if (meta.paragraphIndent !== undefined && meta.paragraphIndent !== 0) {
    out.paragraphIndent = meta.paragraphIndent;
  }
  if (meta.textTruncation && meta.textTruncation !== "DISABLED") {
    out.textTruncation = meta.textTruncation;
  }
  if (meta.maxLines !== undefined) out.maxLines = meta.maxLines;
  if (meta.hyperlinks && meta.hyperlinks.length > 0) out.hyperlinks = meta.hyperlinks;
  return out;
}
