// Public API of the import pipeline (LSML bundle → Figma node tree).
//
// The orchestrator `importBundle` :
//   1. validate the bundle against the LSML 1.1 schema
//   2. fetch / embed assets (from local refs)
//   3. walk the layout tree, calling per-primitive builders
//   4. attach plugin data (bindings, operator-input metadata)
//   5. return the created root node id
//
// Phase 3 wires this up. Today it throws.

import type { ImportResult } from "~main/messages";
import type { SceneBundle } from "~shared/lsml-types";

export async function importBundle(_bundle: SceneBundle): Promise<ImportResult> {
  throw new Error("importBundle not implemented yet (Phase 3)");
}
