// Shared helper : turn `metadata.figma.imageBackgrounds[]` entries back
// into Figma IMAGE paints and append them to a frame / stack node's
// `fills` array. Used by buildFrame and buildStack — frames and stacks
// can both carry IMAGE fills (avatar circles, hero banners, card image
// backgrounds), but LSML's Fill type doesn't model them, so the export
// side stashes them under metadata and we reconstruct here.

import type { FigmaImageBackground } from "./figma-metadata";
import type { ImportPaint } from "./figma-api";

/** Construct Figma IMAGE paints from the metadata-side `imageBackgrounds`
 *  entries and merge them into the existing `fills` array. The asset
 *  registry returned a content-addressed `src` path during export ; on
 *  import the user supplies the bytes via `assetMap[src] → imageHash`.
 *  Entries whose hash isn't found are skipped (a warning is the caller's
 *  responsibility — keeps this helper purely transformational). */
export function applyImageBackgrounds(
  node: { fills?: ImportPaint[] },
  imageBackgrounds: FigmaImageBackground[] | undefined,
  assetMap: Record<string, string>,
): void {
  if (!imageBackgrounds || imageBackgrounds.length === 0) return;
  const existing = (node.fills ?? []).slice();
  for (const bg of imageBackgrounds) {
    const hash = assetMap[bg.src];
    if (!hash) continue;
    const paint: ImportPaint = {
      type: "IMAGE",
      imageHash: hash,
      scaleMode: bg.scaleMode ?? "FILL",
    };
    // Splice the per-paint extras Figma supports on IMAGE fills. Cast
    // through Record<string, unknown> because ImportPaint's IMAGE branch
    // doesn't enumerate every field (blendMode, scalingFactor, rotation,
    // filters, imageTransform are accepted by the real Figma setter).
    const w = paint as unknown as Record<string, unknown>;
    if (bg.blendMode) w["blendMode"] = bg.blendMode;
    if (bg.opacity !== undefined && bg.opacity !== 1) w["opacity"] = bg.opacity;
    if (bg.visible === false) w["visible"] = false;
    if (bg.scalingFactor !== undefined && bg.scalingFactor !== 1) {
      w["scalingFactor"] = bg.scalingFactor;
    }
    if (bg.rotation !== undefined && bg.rotation !== 0) w["rotation"] = bg.rotation;
    if (bg.filters) w["filters"] = bg.filters;
    if (bg.imageTransform) w["imageTransform"] = bg.imageTransform;
    existing.push(paint);
  }
  if (existing.length > 0) node.fills = existing;
}
