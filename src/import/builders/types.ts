// Shared context passed to per-primitive builders during import.

import type { ImportBaseNode } from "../figma-api";
import type { ImportTrace } from "../trace";

export interface PendingGroupConversion {
  /** The placeholder FRAME we built — will be deleted after `figma.group()`
   *  moves its children into a GroupNode at the same parent + index. */
  frame: ImportBaseNode;
  /** Source Figma node type ("GROUP" or "BOOLEAN_OPERATION") so the
   *  post-pass can name the resulting Figma group accordingly. */
  sourceType: "GROUP" | "BOOLEAN_OPERATION";
}

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
  /** Frames whose source was a GROUP / BOOLEAN_OPERATION. The import
   *  pipeline iterates this list AFTER the tree is mounted and converts
   *  each placeholder frame into a real Figma GroupNode via
   *  `figma.group(children, parent, index)`. Pushed in build order ; the
   *  post-pass walks it in REVERSE so deepest groups convert first. */
  groupConversions: PendingGroupConversion[];
}
