// Import-side reader for `metadata.figma.*` per the `x-figma.authoring/1`
// profile. Mirrors `src/mapping/figma-metadata.ts` ; consumed by every
// per-primitive builder to re-apply Figma-specific properties on the
// freshly created node.
//
// See `lumencast-protocol/spec/profiles/figma-authoring.md` for the
// canonical spec.

export type FigmaEffectType = "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";

export interface FigmaEffectShadow {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  visible?: boolean;
  color: { r: number; g: number; b: number; a: number };
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  blendMode?: FigmaBlendMode;
  showShadowBehindNode?: boolean;
}

export interface FigmaEffectBlur {
  type: "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  radius: number;
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

export type FigmaMaskType = "ALPHA" | "LUMINANCE" | "VECTOR" | "OUTLINE";

export interface FigmaStrokeDetails {
  dashPattern?: number[];
  strokeJoin?: "MITER" | "BEVEL" | "ROUND";
  strokeCap?: "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL";
  strokeMiterLimit?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
}

export type FigmaConstraint = "MIN" | "MAX" | "CENTER" | "STRETCH" | "SCALE";

export interface FigmaConstraints {
  horizontal?: FigmaConstraint;
  vertical?: FigmaConstraint;
}

export type FigmaLayoutAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";

export interface FigmaGradientStop {
  position: number;
  color: string;
  opacity?: number;
}

export interface FigmaHyperlink {
  range: [number, number];
  url: string;
}

export interface FigmaTextSegment {
  start: number;
  end: number;
  fontName?: { family: string; style: string };
  fontSize?: number;
  fills?: FigmaPaintMetadata[];
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  letterSpacing?: { unit: "PIXELS" | "PERCENT"; value: number };
  lineHeight?: { unit: "PIXELS" | "PERCENT" | "AUTO"; value?: number };
  hyperlink?: { url: string };
}

export interface FigmaImageBackground {
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

export interface FigmaLayoutGrid {
  pattern: "ROWS" | "COLUMNS" | "GRID";
  visible?: boolean;
  color?: { r: number; g: number; b: number; a: number };
  alignment?: "MIN" | "MAX" | "CENTER" | "STRETCH";
  gutterSize?: number;
  count?: number;
  sectionSize?: number;
  offset?: number;
}

export interface FigmaGuide {
  axis: "X" | "Y";
  offset: number;
}

export interface FigmaPaintMetadata {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL";
  visible?: boolean;
  opacity?: number;
  blendMode?: FigmaBlendMode;
  color?: { r: number; g: number; b: number };
  gradientStops?: {
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }[];
  gradientTransform?: number[][];
}

export interface FigmaMetadata {
  layerName?: string;
  /** Source Figma node type when it wasn't a FRAME (GROUP / BOOLEAN_OPERATION).
   *  Triggers post-build conversion to a real Figma GroupNode. */
  sourceType?: "GROUP" | "BOOLEAN_OPERATION";
  /** Full fills array captured from a text node — used when LSML's
   *  `style.color` (single CSS color) can't represent the source's
   *  gradient or multi-fill paint. */
  textFills?: FigmaPaintMetadata[];
  /** Captured stroke paints (text / frame have no native LSML stroke ;
   *  shape uses this only for non-SOLID strokes). */
  strokes?: FigmaPaintMetadata[];
  /** Uniform stroke weight for text + frame primitives. */
  strokeWeight?: number;

  /** Per-image-paint extras for `image` primitives. Restored on the
   *  IMAGE paint before `node.fills = [paint]` is assigned. */
  imagePaint?: {
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
    scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
  };
  /** Raw 2x3 affine transform — used to restore flip + rotation atomically
   *  when the source node had a negative-determinant transform. */
  transform?: number[][];
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  clipsContent?: boolean;
  effects?: FigmaEffect[];
  blendMode?: FigmaBlendMode;
  isMask?: boolean;
  maskType?: FigmaMaskType;
  cornerRadius?: number;
  cornerRadii?: [number, number, number, number];
  cornerSmoothing?: number;
  strokeDetails?: FigmaStrokeDetails;
  constraints?: FigmaConstraints;
  layoutAlign?: FigmaLayoutAlign;
  layoutGrow?: 0 | 1;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  gradientStops?: (FigmaGradientStop[] | null)[];
  gradientTransforms?: (number[][] | null)[];
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  fontStyle?: string;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  textTruncation?: "DISABLED" | "ENDING";
  maxLines?: number;
  hyperlinks?: FigmaHyperlink[];
  textSegments?: FigmaTextSegment[];
  layoutGrids?: FigmaLayoutGrid[];
  guides?: FigmaGuide[];
  imageBackgrounds?: FigmaImageBackground[];
}

export function readFigmaMetadata(prim: { metadata?: Record<string, unknown> }): FigmaMetadata {
  const meta = prim.metadata?.["figma"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as FigmaMetadata;
}
