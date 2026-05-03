// Public API of the Figma → LSML mapping layer.
//
// Each per-primitive mapper takes a Figma SceneNode and produces an LSML
// primitive (or null when the node should be skipped). The orchestrator
// `mapNode` picks the right mapper based on the node type.
//
// Phase 1 implements text/image/shape/frame/stack mappers.
// Phase 2 adds instance + variable resolution.

import type { BasePrimitive } from "~shared/lsml-types";

export interface MappingContext {
  /** Optional warning sink — surfaced to the UI. */
  warn(code: string, message: string, nodeId?: string): void;
  /** Asset extraction is delegated to src/export/assets.ts and threaded here. */
  registerAsset?(bytes: Uint8Array, mimeType: string): string;
}

export function mapNode(_node: SceneNode, _ctx: MappingContext): BasePrimitive | null {
  // Implemented in Phase 1.
  throw new Error("mapNode not implemented yet (Phase 1)");
}
