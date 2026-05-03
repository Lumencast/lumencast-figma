// Tree walker that turns a Figma SceneNode subtree into LSML PrimitiveNodes.
//
// The walker dispatches on `node.type` to the right per-primitive mapper,
// recurses into children for containers, merges per-node defaults / asset
// refs into the accumulated MappingResult, and drops nodes that have no LSML
// representation (e.g. SLICE, BOOLEAN_OPERATION before flattening).

import type { PrimitiveNode, StackPrimitive, FramePrimitive } from "~shared/lsml-types";
import { mapText } from "./text";
import { mapImage } from "./image";
import { mapShape } from "./shape";
import { mapFrame } from "./frame";
import { mapStack } from "./stack";
import { mapInstance } from "./instance";
import type { MappingContext, MappingResult } from "./types";
import { OPERATOR_INPUT_COMPONENT_NAME } from "~shared/constants";

interface AnyFigmaNode {
  type: string;
  id: string;
  name: string;
  visible?: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutMode?: string;
  fills?: unknown[];
  characters?: string;
  children?: AnyFigmaNode[];
  // Used by INSTANCE only.
  mainComponent?: { name: string } | null;
}

function isOperatorInputComponent(node: AnyFigmaNode): boolean {
  if (node.type === "COMPONENT") return node.name === OPERATOR_INPUT_COMPONENT_NAME;
  if (node.type === "INSTANCE") return node.mainComponent?.name === OPERATOR_INPUT_COMPONENT_NAME;
  return false;
}

function hasImageFill(node: AnyFigmaNode): boolean {
  if (!Array.isArray(node.fills)) return false;
  return node.fills.some((f): f is { type: string; imageHash?: string; visible?: boolean } => {
    return (
      typeof f === "object" &&
      f !== null &&
      (f as { type?: unknown }).type === "IMAGE" &&
      (f as { visible?: unknown }).visible !== false &&
      typeof (f as { imageHash?: unknown }).imageHash === "string"
    );
  });
}

export interface WalkOptions {
  isRoot: boolean;
  parentX?: number;
  parentY?: number;
}

/** Map a single Figma node + its descendants. Returns null when the node
 *  should be skipped entirely (no representation, or an OperatorInput component
 *  scanned out-of-band). */
export function walk(
  node: AnyFigmaNode,
  ctx: MappingContext,
  opts: WalkOptions,
): MappingResult | null {
  if (node.visible === false) {
    // We still want the node in the tree if explicit, but for a default Figma
    // export we skip purely hidden nodes. Designers can opt them in via a
    // future plugin setting.
    return null;
  }
  if (isOperatorInputComponent(node)) return null;

  switch (node.type) {
    case "TEXT":
      return mapText(node as never);
    case "RECTANGLE":
      if (hasImageFill(node)) return mapImage(node as never, ctx);
      return mapShape(node as never, ctx);
    case "ELLIPSE":
    case "VECTOR":
      return mapShape(node as never, ctx);
    case "INSTANCE":
    case "FRAME": {
      // Either designer-created INSTANCE OR re-imported FRAME with
      // `lumencast.instance.*` plugin data → emit LSML §4.9 instance. The
      // import pipeline materialises §4.9 instances as FRAMEs (real INSTANCE
      // nodes can only be created by cloning a COMPONENT, which we don't
      // have on import — see src/main/import-adapter.ts).
      const instOpts: { isRoot: boolean; parentX?: number; parentY?: number } = {
        isRoot: opts.isRoot,
      };
      if (opts.parentX !== undefined) instOpts.parentX = opts.parentX;
      if (opts.parentY !== undefined) instOpts.parentY = opts.parentY;
      const inst = mapInstance(node as never, instOpts, ctx);
      if (inst) return inst;
      return walkContainer(node, ctx, opts);
    }
    case "COMPONENT":
    case "GROUP":
      return walkContainer(node, ctx, opts);
    default:
      ctx.warn(
        "UNSUPPORTED_NODE",
        `Node type ${node.type} has no LSML 1.1 mapping ; skipped.`,
        node.id,
      );
      return null;
  }
}

function walkContainer(node: AnyFigmaNode, ctx: MappingContext, opts: WalkOptions): MappingResult {
  const isStack =
    (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") &&
    typeof node.layoutMode === "string" &&
    node.layoutMode !== "NONE";

  const childResults: MappingResult[] = [];
  const myX = node.x ?? 0;
  const myY = node.y ?? 0;
  for (const child of node.children ?? []) {
    const r = walk(child, ctx, { isRoot: false, parentX: myX, parentY: myY });
    if (r) childResults.push(r);
  }
  const children = childResults.map((r) => r.node) as PrimitiveNode[];

  let result: MappingResult;
  if (isStack) {
    result = mapStack(node as never, children as StackPrimitive["children"]);
  } else {
    const frameOpts: { isRoot: boolean; parentX?: number; parentY?: number } = {
      isRoot: opts.isRoot,
    };
    if (opts.parentX !== undefined) frameOpts.parentX = opts.parentX;
    if (opts.parentY !== undefined) frameOpts.parentY = opts.parentY;
    result = mapFrame(node as never, frameOpts, children as FramePrimitive["children"], ctx);
  }

  // Merge defaults / assetRefs / operatorInputs from descendants.
  const defaults: Record<string, unknown> = { ...(result.defaults ?? {}) };
  const assetRefs: string[] = [...(result.assetRefs ?? [])];
  const operatorInputs = [...(result.operatorInputs ?? [])];
  for (const r of childResults) {
    if (r.defaults) Object.assign(defaults, r.defaults);
    if (r.assetRefs) assetRefs.push(...r.assetRefs);
    if (r.operatorInputs) operatorInputs.push(...r.operatorInputs);
  }
  const out: MappingResult = { node: result.node };
  if (Object.keys(defaults).length) out.defaults = defaults;
  if (assetRefs.length) out.assetRefs = assetRefs;
  if (operatorInputs.length) out.operatorInputs = operatorInputs;
  return out;
}
