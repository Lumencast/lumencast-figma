// Import-side reader for `metadata.figma.*`. Mirror of
// `src/mapping/figma-metadata.ts` ; consumed by every per-primitive
// builder to re-apply Figma-specific props that LSML 1.1 cannot carry
// natively (position on non-frame primitives, vector size, textCase,
// textAutoResize, fontName.style, clipsContent).

export interface FigmaMetadata {
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  fontStyle?: string;
  clipsContent?: boolean;
  /** Raw Figma 2x3 affine matrices indexed parallel with the prim's `fills[]`
   *  / `backgrounds[]`. Used by the import builder to restore byte-stable
   *  gradient handles when present (avoids the lossy angle_deg round-trip). */
  gradientTransforms?: (number[][] | null)[];
}

export function readFigmaMetadata(prim: { metadata?: Record<string, unknown> }): FigmaMetadata {
  const meta = prim.metadata?.["figma"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as FigmaMetadata;
}
