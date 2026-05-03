// Public API of the export pipeline (Figma → LSML bundle).
//
// The orchestrator `exportFrame` runs the full pipeline :
//   1. traverse the selected frame
//   2. map each node to an LSML primitive
//   3. extract assets to content-hashed refs
//   4. assemble the bundle
//   5. canonicalize + content-hash via @lumencast/compiler
//   6. validate against the LSML 1.1 schema
//   7. return ExportResult to the caller (UI thread serializes to file)
//
// Phase 1 wires this up. Today it throws.

import type { ExportResult } from "~main/messages";

export async function exportFrame(_root: SceneNode): Promise<ExportResult> {
  throw new Error("exportFrame not implemented yet (Phase 1)");
}
