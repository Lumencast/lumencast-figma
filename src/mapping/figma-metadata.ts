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
  /** Figma 2024+ : blur kernel choice. Default "NORMAL". */
  blurType?: "NORMAL" | "PROGRESSIVE";
}

export interface FigmaEffectNoise {
  type: "NOISE";
  visible?: boolean;
  noiseSize: number;
  noiseSizeVector?: { x: number; y: number };
  noiseType: "MONOTONE" | "MULTITONE" | "DUOTONE";
  color?: { r: number; g: number; b: number; a: number };
  density: number;
  /** MULTITONE/DUOTONE secondary colour (when applicable). */
  secondaryColor?: { r: number; g: number; b: number; a: number };
}

export interface FigmaEffectTexture {
  type: "TEXTURE";
  visible?: boolean;
  radius: number;
  noiseSize: number;
  noiseSizeVector?: { x: number; y: number };
  clipToShape?: boolean;
}

export interface FigmaEffectGlass {
  type: "GLASS";
  visible?: boolean;
  radius: number;
  refraction: number;
  depth: number;
  lightAngle: number;
  lightIntensity: number;
  dispersion: number;
  splay: number;
}

export type FigmaEffect =
  | FigmaEffectShadow
  | FigmaEffectBlur
  | FigmaEffectNoise
  | FigmaEffectTexture
  | FigmaEffectGlass;

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

// ---------- Paint metadata (per-fill capture for text + extras) ----------

/** Serialisable subset of a Figma `Paint` (SOLID / GRADIENT_LINEAR /
 *  GRADIENT_RADIAL). Stashed under `metadata.figma.textFills[]` so text
 *  primitives with non-trivial fills (gradients, multi-fill, per-paint
 *  blend mode) round-trip with full fidelity. */
export interface FigmaPaintMetadata {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL";
  visible?: boolean;
  opacity?: number;
  blendMode?: FigmaBlendMode;
  /** SOLID only — RGB 0..1. */
  color?: { r: number; g: number; b: number };
  /** GRADIENT_* — stops with RGBA 0..1. */
  gradientStops?: {
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }[];
  /** GRADIENT_* — 2x3 affine matrix. */
  gradientTransform?: number[][];
}

// ---------- Image backgrounds (frame / stack with IMAGE fills) ----------

/** IMAGE paint stashed on a frame or stack — Figma allows IMAGE fills on
 *  any container (avatar circles, hero banners, card backgrounds), but
 *  LSML's `frame.backgrounds` only models SOLID / GRADIENT. We round-trip
 *  these IMAGE fills via `metadata.figma.imageBackgrounds[]` ; the import
 *  side reconstructs the IMAGE paint and appends to `node.fills`. */
export interface FigmaImageBackground {
  /** Bundle-relative asset path returned by `ctx.registerImageHash`. The
   *  asset registry rewrites this to `assets/<sha256>.<ext>` after the
   *  bytes are resolved. */
  src: string;
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
  blendMode?: FigmaBlendMode;
  opacity?: number;
  visible?: boolean;
  scalingFactor?: number;
  rotation?: number;
  filters?: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    highlights?: number;
    shadows?: number;
  };
  imageTransform?: number[][];
}

// ---------- Layout grids + guides (frame-level rulers) ----------

/** Figma `layoutGrid` entry. Three patterns share the surface — `ROWS` and
 *  `COLUMNS` use alignment + gutter + count + section/offset, `GRID` uses
 *  only `sectionSize`. Stashed verbatim ; the import side hands the array
 *  back to `node.layoutGrids = [...]`. */
export interface FigmaLayoutGrid {
  pattern: "ROWS" | "COLUMNS" | "GRID";
  visible?: boolean;
  color?: { r: number; g: number; b: number; a: number };
  /** ROWS / COLUMNS only. */
  alignment?: "MIN" | "MAX" | "CENTER" | "STRETCH";
  gutterSize?: number;
  count?: number;
  sectionSize?: number;
  offset?: number;
}

/** Figma `guide` entry — page-level or frame-level ruler. `axis: X` is a
 *  vertical guide at column `offset` ; `axis: Y` is a horizontal guide at
 *  row `offset`. */
export interface FigmaGuide {
  axis: "X" | "Y";
  offset: number;
}

// ---------- Hyperlinks (text) ----------

export interface FigmaHyperlink {
  /** [start, endExclusive] character range. */
  range: [number, number];
  url: string;
}

// ---------- Multi-style text ranges ----------

/** A contiguous range of characters with non-uniform styling. Captured via
 *  Figma's `getStyledTextSegments` and re-applied per range on import via
 *  `setRangeFontName`, `setRangeFills`, `setRangeFontSize`, etc.
 *
 *  Without this, multi-style text (e.g. "<bold>+645 LP</bold> <gray>par la
 *  communauté</gray>") collapses on round-trip : `node.fontName` returns
 *  the figma.mixed Symbol → our extractStyle drops fontFamily entirely →
 *  builder falls back to Inter Regular black. Same for fills (multi-color
 *  text loses every range fill).
 *
 *  Only the differences between segments are stored — segments that match
 *  the node-level style (already captured in `prim.style`) carry only
 *  `start`/`end`. Cross-cutting fields (textCase, textDecoration,
 *  letterSpacing, lineHeight) round-trip per range when they vary. */
export interface FigmaTextSegment {
  /** Inclusive start index into `text.characters`. */
  start: number;
  /** Exclusive end index — `[start, end)` matches Figma's range convention. */
  end: number;
  fontName?: { family: string; style: string };
  fontSize?: number;
  /** Per-range paint stack (multi-color text). */
  fills?: FigmaPaintMetadata[];
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  letterSpacing?: { unit: "PIXELS" | "PERCENT"; value: number };
  lineHeight?: { unit: "PIXELS" | "PERCENT" | "AUTO"; value?: number };
  hyperlink?: { url: string };
}

// ---------- Top-level shape ----------

export interface FigmaMetadata {
  /** Original Figma `node.name` including any `[bind:...]` directive prefix. */
  layerName?: string;

  /** Source Figma node type when it isn't a FRAME — typically `GROUP` or
   *  `BOOLEAN_OPERATION`. LSML has no native group primitive, so the
   *  export flattens both to LSML `frame`. On re-import the builder
   *  consults this hint and converts the frame into a real Figma
   *  GroupNode via `figma.group()` so the layer-panel structure matches
   *  the source. */
  sourceType?: "GROUP" | "BOOLEAN_OPERATION";

  /** Boolean operation flavour. Only meaningful when `sourceType ===
   *  "BOOLEAN_OPERATION"`. Captured so the importer can call the right
   *  Figma API (`figma.union` / `subtract` / `intersect` / `exclude`)
   *  instead of `figma.group`, preserving the actual cut/overlap
   *  semantics. `UNION` is the default when missing — matches the
   *  pre-1.1.x behaviour of routing every BO through `figma.group`. */
  booleanOperation?: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE";

  /** Captured fills for `text` primitives. LSML's `style.color` only carries
   *  a CSS color, so SOLID fills round-trip via that channel. Gradient or
   *  multi-fill text needs the full paint array — stashed here verbatim
   *  and re-applied on import via `node.fills = …`. Each entry is a
   *  Figma-shaped paint with the keys we need to reconstruct ImportPaint. */
  textFills?: FigmaPaintMetadata[];

  /** Captured stroke paints. LSML's `Stroke` only carries `{color, width}`
   *  (SOLID only), and `text` / `frame` primitives have no native stroke
   *  representation at all. This array preserves the full per-stroke
   *  paint surface (gradient strokes, image strokes, blendMode/opacity)
   *  and is applied on import via `node.strokes = …`. Used for shape
   *  (when non-SOLID), text, and frame. */
  strokes?: FigmaPaintMetadata[];

  /** Uniform stroke weight for text and frame primitives — shape carries
   *  it via LSML's `stroke.width`. Skipped when the strokes array is
   *  empty or every per-side weight is set in `strokeDetails`. */
  strokeWeight?: number;

  /** Per-image-paint metadata for `image` primitives — Figma exposes
   *  several knobs on the IMAGE fill itself (separate from the LSML
   *  `image.fit` field) that we round-trip via this block. The import
   *  side splices each non-null key back into the freshly-constructed
   *  IMAGE paint before assigning to `node.fills`. */
  imagePaint?: {
    /** PASS_THROUGH/NORMAL skipped by the export. The user-visible
     *  difference between source and re-imported scenes when the source
     *  paints with HARD_LIGHT (or any non-default blend) collapses
     *  without this. */
    blendMode?: FigmaBlendMode;
    /** Per-paint opacity. Skipped when 1. */
    opacity?: number;
    /** Per-paint visibility. Skipped when true. */
    visible?: boolean;
    /** FILL mode subdivision : fraction of the container the image
     *  covers. Default 1. Skipped when 1. */
    scalingFactor?: number;
    /** Image rotation in degrees, applied at paint-time. Default 0. */
    rotation?: number;
    /** Figma's image-filter knobs (exposure, contrast, saturation,
     *  temperature, tint, highlights, shadows). All values are -1..1.
     *  Captured verbatim ; the import re-applies them. */
    filters?: {
      exposure?: number;
      contrast?: number;
      saturation?: number;
      temperature?: number;
      tint?: number;
      highlights?: number;
      shadows?: number;
    };
    /** Affine transform applied to the image's local UV space (pan/zoom
     *  effect inside the container). 2x3 matrix. */
    imageTransform?: number[][];
    /** Figma's raw scaleMode. LSML's `image.fit` collapses `CROP` → `cover`
     *  (same as `FILL`), but Figma honours `imageTransform` ONLY when
     *  scaleMode is `CROP`. Without round-tripping the raw mode, every
     *  cropped image (panned/zoomed via imageTransform) re-imports as a
     *  plain `FILL` and the transform is silently ignored — losing the
     *  pan/zoom and the visual that depends on it (e.g. a thin colour line
     *  revealed only by an off-screen image position). */
    scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
  };

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

  /** Uniform corner radius. Only meaningful for frame / stack primitives —
   *  shape carries its own `cornerRadius` natively (LSML §4.6). Captured
   *  here so pills (button rounded-full), rounded cards (frame radius
   *  18px), avatar circles, etc. round-trip on container nodes that
   *  have no native field. Skipped when zero. */
  cornerRadius?: number;
  /** [topLeft, topRight, bottomRight, bottomLeft]. Overrides `cornerRadius`
   *  when at least one corner differs from the others. */
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
  /** Per-axis sizing mode for auto-layout frames + text nodes. Without
   *  this, every imported stack defaults to HUG/HUG which collapses
   *  fixed-size frames (a 880×192 stack containing a 1034×192 text
   *  re-imports as 100×116, clipping the overflow). Captured from
   *  `node.layoutSizingHorizontal/Vertical` ; the import builder applies
   *  it BEFORE `node.resize` so Figma honours the explicit dimensions. */
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";

  // --- Layout grids + guides (canvas rulers, frame-level) ---

  /** Frame-level layoutGrids — the columns/rows/grid overlays a designer
   *  configures via *Layout grid* in Figma. Captured verbatim and re-
   *  applied so re-imports keep the same alignment scaffolding. */
  layoutGrids?: FigmaLayoutGrid[];
  /** Frame-level guides — vertical (axis: X) or horizontal (axis: Y)
   *  ruler guides anchored at integer offsets inside the frame. */
  guides?: FigmaGuide[];

  /** IMAGE fills used as frame / stack backgrounds. Captured separately
   *  from `backgrounds` because LSML's Fill type doesn't model IMAGE. */
  imageBackgrounds?: FigmaImageBackground[];

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
  /** Vertical alignment of text content within the text node's box.
   *  Default `TOP` ; the source's `CENTER` / `BOTTOM` is required for
   *  designs where the text sits inside a fixed-height container with
   *  the text vertically centered (e.g. a 67×389 box with a single
   *  centered "Transform" word). Without this the text re-imports as
   *  TOP-aligned and visually drifts up. */
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  textTruncation?: "DISABLED" | "ENDING";
  /** Only meaningful when `textTruncation: ENDING`. */
  maxLines?: number;
  hyperlinks?: FigmaHyperlink[];
  /** Multi-style text ranges. Populated when the source text node has
   *  non-uniform fontName / fills / etc. across characters — round-trips
   *  bold-prefix sentences, multi-color sentences, mixed-size text, etc. */
  textSegments?: FigmaTextSegment[];
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
  if (meta.sourceType) out.sourceType = meta.sourceType;
  if (meta.booleanOperation) out.booleanOperation = meta.booleanOperation;
  if (meta.imagePaint && Object.keys(meta.imagePaint).length > 0) out.imagePaint = meta.imagePaint;
  if (meta.textFills && meta.textFills.length > 0) out.textFills = meta.textFills;
  if (meta.strokes && meta.strokes.length > 0) out.strokes = meta.strokes;
  if (meta.strokeWeight !== undefined && meta.strokeWeight !== 1) out.strokeWeight = meta.strokeWeight;
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
  if (meta.cornerRadius !== undefined && meta.cornerRadius !== 0) {
    out.cornerRadius = meta.cornerRadius;
  }
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
  if (meta.layoutSizingHorizontal) out.layoutSizingHorizontal = meta.layoutSizingHorizontal;
  if (meta.layoutSizingVertical) out.layoutSizingVertical = meta.layoutSizingVertical;
  if (meta.layoutGrids && meta.layoutGrids.length > 0) out.layoutGrids = meta.layoutGrids;
  if (meta.guides && meta.guides.length > 0) out.guides = meta.guides;
  if (meta.imageBackgrounds && meta.imageBackgrounds.length > 0) {
    out.imageBackgrounds = meta.imageBackgrounds;
  }
  if (meta.gradientStops && meta.gradientStops.some((s) => s !== null && s.length > 0)) {
    out.gradientStops = meta.gradientStops;
  }
  if (meta.gradientTransforms && meta.gradientTransforms.some((t) => t !== null)) {
    out.gradientTransforms = meta.gradientTransforms;
  }
  if (meta.textCase && meta.textCase !== "ORIGINAL") out.textCase = meta.textCase;
  if (meta.fontStyle) out.fontStyle = meta.fontStyle;
  if (meta.textAutoResize && meta.textAutoResize !== "NONE") out.textAutoResize = meta.textAutoResize;
  if (meta.textAlignVertical && meta.textAlignVertical !== "TOP") {
    out.textAlignVertical = meta.textAlignVertical;
  }
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
  if (meta.textSegments && meta.textSegments.length > 0) out.textSegments = meta.textSegments;
  return out;
}
