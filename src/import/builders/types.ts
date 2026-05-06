// Shared context passed to per-primitive builders during import.

import type { ImportBaseNode } from "../figma-api";
import type { ImportTrace } from "../trace";

export interface BuildContext {
  /** Bundle-level `defaults` map. Builders consult it to reverse-resolve
   *  `__lit.*` synthesised LeafPaths (text characters, image asset paths). */
  defaults: Record<string, unknown>;
  /** Map of `assets/<sha256>.<ext>` path → Figma image hash, populated by
   *  the asset-embedding step before builders run. */
  assetMap: Record<string, string>;
  /** Sink for non-fatal warnings surfaced to the UI. */
  warn(code: string, message: string): void;
  /** Optional structured trace recorder. The walker pushes one entry per
   *  visited primitive ; the import pipeline serialises it as
   *  `import-trace.json` for the user-facing diagnostic file. */
  trace?: ImportTrace;
  /** Live counter incremented by each successful builder dispatch. The
   *  import pipeline reads it after the build to compute primitives
   *  created without re-walking the tree. */
  counter?: { built: number; expected: number };
  /** Frames whose `clipsContent` should be flipped back to `false` after
   *  the tree is fully built. We force `true` during build (in `buildFrame`)
   *  to prevent Figma's auto-grow on Frames whose source had
   *  `clipsContent=false` with children extending past the bbox — and
   *  inline figma.group() calls inside such frames can also propagate
   *  bboxes up the ancestor chain. Once the build is complete, restoring
   *  `clipsContent` to its bundle value is safe : the bbox stays at the
   *  declared size. */
  clipsContentRestoreQueue?: { node: ImportBaseNode; clipsContent: boolean }[];
}
