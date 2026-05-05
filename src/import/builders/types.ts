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
  /** Children appended to the placeholder Frame at build time. Captured
   *  here (not read from `frame.children` at post-pass time) so we don't
   *  rely on the host array's late state — in dynamic-page mode + after
   *  the tree is mounted to currentPage, `frame.children` has been seen
   *  to return empty for placeholders whose children were appended via
   *  the in-memory tree builder. Capturing the references at append time
   *  ensures we hold them through the conversion regardless of host
   *  array semantics. */
  children: ImportBaseNode[];
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
  /** Live counter incremented by each successful builder dispatch. The
   *  import pipeline reads it after the build to compute primitives
   *  created without re-walking the tree. */
  counter?: { built: number; expected: number };
  /** Frames whose declared `size` should be re-asserted after the
   *  post-pass figma.group() conversions. Frame placeholders
   *  legitimately grew during build (children outside their bbox), got
   *  clamped via the in-walk resize, but the figma.group() conversion
   *  in the post-pass can re-trigger Figma's auto-grow at every
   *  ancestor level (the new Group's bbox propagates up the chain).
   *  Without a final clamp, frames like `bg-texture` end up at the
   *  union-of-descendants bbox instead of their declared size. The
   *  pipeline iterates this list once all conversions are done and
   *  calls resize again. */
  frameResizeQueue?: { node: ImportBaseNode; w: number; h: number }[];
  /** Frames whose `clipsContent` should be flipped back to `false` after
   *  all children + group conversions are done. We force `true` during
   *  build to prevent Figma's auto-grow on Frames whose source had
   *  `clipsContent=false` with children extending past the bbox. Once
   *  the bbox is settled (post-pass complete), restoring `clipsContent`
   *  to its bundle value is safe — the bbox stays at the declared size. */
  clipsContentRestoreQueue?: { node: ImportBaseNode; clipsContent: boolean }[];
}
