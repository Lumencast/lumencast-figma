// Import-side reader for `metadata.figma.*`. Mirror of
// `src/mapping/figma-metadata.ts` ; consumed by every per-primitive
// builder to re-apply Figma-specific props that LSML 1.1 cannot carry
// natively (textCase SMALL_CAPS variants, textAutoResize, fontName.style,
// gradient transform handles, original layer name).

export interface FigmaMetadata {
  textCase?: "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  fontStyle?: string;
  /** Raw Figma 2x3 affine matrices indexed parallel with the prim's `fills[]`
   *  / `backgrounds[]`. Used by the import builder to restore byte-stable
   *  gradient handles when present (avoids the lossy angle_deg round-trip). */
  gradientTransforms?: (number[][] | null)[];
  /** Original Figma `node.name` including any `[bind:...]` directives.
   *  Each builder restores it verbatim onto the created node. */
  layerName?: string;
}

export function readFigmaMetadata(prim: { metadata?: Record<string, unknown> }): FigmaMetadata {
  const meta = prim.metadata?.["figma"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as FigmaMetadata;
}
