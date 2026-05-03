// Internal mapping types shared across per-primitive mappers.

import type { OperatorInputSpec, PrimitiveNode } from "~shared/lsml-types";

export interface MappingResult {
  /** The LSML primitive that replaces the Figma node. */
  node: PrimitiveNode;
  /** Defaults seeded by this node (e.g. literal text values, resolved tokens).
   *  Merged into `bundle.defaults` by the bundle assembler. */
  defaults?: Record<string, unknown>;
  /** Asset references this node depends on (image hashes). The export pipeline
   *  resolves them to bytes. */
  assetRefs?: string[];
  /** Operator-input declarations discovered as a side-effect (rare ; usually
   *  a dedicated component scanner produces these). */
  operatorInputs?: OperatorInputSpec[];
}

export interface MappingContext {
  warn(code: string, message: string, nodeId?: string): void;
  /** Register an image hash and return its content-addressed asset name (e.g.
   *  `assets/9f3e...png`). The bundle assembler uses this map to populate the
   *  `assets` directory. */
  registerImageHash?(hash: string): string;
}
