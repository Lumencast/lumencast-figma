// Re-import of content-addressed assets.
//
// On import, the user provides a map of `assets/<sha256>.<ext>` → bytes
// (loaded via the UI's File-API picker — see src/ui/import-picker.ts).
// This module wraps `figma.createImage` to produce per-asset Figma image
// hashes, which builders inject into IMAGE paint refs.

import type { ImportFigmaApi } from "./figma-api";

export interface AssetByteSource {
  /** Bundle-side path : `assets/<sha256>.<ext>`. */
  path: string;
  bytes: Uint8Array;
}

export interface EmbeddedAssets {
  /** Map of `assets/<sha256>.<ext>` → Figma-side image hash. */
  assetMap: Record<string, string>;
  /** Number of assets actually embedded. */
  count: number;
}

export function embedAssets(api: ImportFigmaApi, sources: AssetByteSource[]): EmbeddedAssets {
  const assetMap: Record<string, string> = {};
  for (const src of sources) {
    const handle = api.createImage(src.bytes);
    assetMap[src.path] = handle.hash;
  }
  return { assetMap, count: sources.length };
}
