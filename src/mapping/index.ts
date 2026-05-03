// Public API of the Figma → LSML mapping layer.
//
// Entry : `mapTree(rootNode, ctx)` — walks the subtree, dispatches to the
// per-primitive mappers (text / image / shape / frame / stack), and returns
// the top-level LSML primitive plus the defaults / asset hashes the caller
// needs to assemble the bundle.

import { walk } from "./traverse";
import type { MappingContext, MappingResult } from "./types";

export type { MappingContext, MappingResult };

interface RootNode {
  type: string;
  id: string;
  name: string;
  width?: number;
  height?: number;
}

export function mapTree(node: RootNode, ctx: MappingContext): MappingResult {
  const r = walk(node as never, ctx, { isRoot: true });
  if (!r) {
    throw new Error(
      `Root node ${node.id} (${node.type}) has no LSML representation. The export root must be a FRAME / COMPONENT / INSTANCE.`,
    );
  }
  return r;
}
