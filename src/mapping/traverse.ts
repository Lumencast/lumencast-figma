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
import { asArray, asNumber } from "./figma-mixed";

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
  const fills = asArray<unknown>(node.fills);
  if (!fills) return false;
  return fills.some((f): f is { type: string; imageHash?: string; visible?: boolean } => {
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
  /** Tree depth for the trace recorder (root = 0). Internal — callers don't set it. */
  depth?: number;
}

/** Map a single Figma node + its descendants. Returns null when the node
 *  should be skipped entirely (no representation, or an OperatorInput component
 *  scanned out-of-band). */
export function walk(
  node: AnyFigmaNode,
  ctx: MappingContext,
  opts: WalkOptions,
): MappingResult | null {
  const depth = opts.depth ?? 0;
  console.warn("[lumencast] walk:", node.type, node.id, node.name);
  if (node.visible === false) {
    ctx.trace?.push({ depth, type: node.type, id: node.id, name: node.name, action: "skip-invisible" });
    return null;
  }
  if (isOperatorInputComponent(node)) {
    console.warn("[lumencast]   → operator-input component, skipped from tree");
    ctx.trace?.push({ depth, type: node.type, id: node.id, name: node.name, action: "skip-operator-input" });
    return null;
  }

  // Build the parent-coords option block once — every leaf-primitive
  // mapper uses it to compute its `metadata.figma.position` relative to
  // the parent, so non-frame children of absolute layouts roundtrip.
  const parentOpts: { parentX?: number; parentY?: number } = {};
  if (opts.parentX !== undefined) parentOpts.parentX = opts.parentX;
  if (opts.parentY !== undefined) parentOpts.parentY = opts.parentY;

  const traceBase = { depth, type: node.type, id: node.id, name: node.name };
  try {
    switch (node.type) {
      case "TEXT":
        console.warn("[lumencast]   → mapText");
        ctx.trace?.push({ ...traceBase, action: "map-text" });
        return mapText(node as never, parentOpts);
      case "RECTANGLE":
        if (hasImageFill(node)) {
          console.warn("[lumencast]   → mapImage");
          ctx.trace?.push({ ...traceBase, action: "map-image" });
          return mapImage(node as never, ctx, parentOpts);
        }
        console.warn("[lumencast]   → mapShape (rect)");
        ctx.trace?.push({ ...traceBase, action: "map-shape", note: "rect" });
        return mapShape(node as never, ctx, parentOpts);
      case "ELLIPSE":
      case "VECTOR":
      case "BOOLEAN_OPERATION":
      case "STAR":
      case "POLYGON":
      case "LINE":
        // All vector-like nodes share `fillGeometry` (post-boolean flatten)
        // — mapShape consumes it as `shape.paths[]`. Treating BOOLEAN_OPERATION
        // as a single shape (instead of recursing into its children) is the
        // fix for "logo becomes plein de vectors".
        console.warn("[lumencast]   → mapShape (", node.type, ")");
        ctx.trace?.push({ ...traceBase, action: "map-shape", note: node.type });
        return mapShape(node as never, ctx, parentOpts);
      case "INSTANCE":
      case "FRAME": {
        const instOpts: { isRoot: boolean; parentX?: number; parentY?: number } = {
          isRoot: opts.isRoot,
        };
        if (opts.parentX !== undefined) instOpts.parentX = opts.parentX;
        if (opts.parentY !== undefined) instOpts.parentY = opts.parentY;
        console.warn("[lumencast]   → mapInstance (try)");
        const inst = mapInstance(node as never, instOpts, ctx);
        if (inst) {
          console.warn("[lumencast]   → mapInstance (matched §4.9)");
          ctx.trace?.push({ ...traceBase, action: "map-instance" });
          return inst;
        }
        console.warn("[lumencast]   → walkContainer (frame/stack)");
        ctx.trace?.push({ ...traceBase, action: "walk-container", note: node.type });
        return walkContainer(node, ctx, opts);
      }
      case "COMPONENT":
      case "GROUP":
        console.warn("[lumencast]   → walkContainer (", node.type, ")");
        ctx.trace?.push({ ...traceBase, action: "walk-container", note: node.type });
        return walkContainer(node, ctx, opts);
      default:
        ctx.warn(
          "UNSUPPORTED_NODE",
          `Node type ${node.type} has no LSML 1.1 mapping ; skipped.`,
          node.id,
        );
        ctx.trace?.push({ ...traceBase, action: "skip-unsupported" });
        return null;
    }
  } catch (err) {
    ctx.trace?.push({ ...traceBase, action: "error", error: err instanceof Error ? err.message : String(err) });
    console.error("[lumencast] FAIL inside walk for", node.type, node.id, node.name, "→", err);
    if (err instanceof Error) console.error("[lumencast]   stack:", err.stack);
    throw err;
  }
}

function walkContainer(node: AnyFigmaNode, ctx: MappingContext, opts: WalkOptions): MappingResult {
  const isStack =
    (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") &&
    typeof node.layoutMode === "string" &&
    node.layoutMode !== "NONE";

  const childResults: MappingResult[] = [];
  const myX = asNumber(node.x) ?? 0;
  const myY = asNumber(node.y) ?? 0;
  const childDepth = (opts.depth ?? 0) + 1;
  const childNodes = asArray<AnyFigmaNode>(node.children) ?? [];
  for (const child of childNodes) {
    const r = walk(child, ctx, { isRoot: false, parentX: myX, parentY: myY, depth: childDepth });
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
