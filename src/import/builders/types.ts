// Shared context passed to per-primitive builders during import.

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
}
