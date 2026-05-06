// Internal mapping types shared across per-primitive mappers.

import type { OperatorInputSpec, PrimitiveNode } from "~shared/lsml-types";
import type { VariableResolverApi } from "./variables";
import type { MappingTrace } from "./trace";
import type { MainComponentMap } from "./preload";

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
  /** Optional Figma variable resolver. When present, mappers consult it for
   *  paint / size / color binds and emit token-LeafPath bindings instead of
   *  static values (LSML §17.0 composition). */
  variables?: VariableResolverApi;
  /** Optional trace recorder. When present, traverse.ts pushes one entry
   *  per visited node — used to populate `_debug/mapping-trace.json` in
   *  the .lsmlz archive. */
  trace?: MappingTrace;
  /** Pre-resolved INSTANCE → mainComponent lookup. Required in
   *  `documentAccess: "dynamic-page"` mode where the synchronous
   *  `node.mainComponent` getter throws — the export pipeline calls
   *  `preloadMainComponents` once before the walk and stashes the result
   *  here so `isOperatorInputComponent` etc. can stay synchronous. */
  mainComponentMap?: MainComponentMap;
}
