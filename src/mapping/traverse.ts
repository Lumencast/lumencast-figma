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
import { paintToFill, type FigmaPaint } from "./color";
import type { Fill, Stroke } from "~shared/lsml-types";

interface AnyFigmaNode {
  type: string;
  id: string;
  name: string;
  visible?: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  rotation?: number;
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
  /** Cumulative rotation of the closest rotated ancestor in the chain (degrees).
   *  Per-primitive mappers subtract this from `node.rotation` to emit the
   *  local rotation — see `extractUniversal`. */
  parentRotation?: number;
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
  // Invisible nodes are NOT skipped — they flow through to the per-
  // primitive mappers, which read `node.visible === false` via
  // `extractUniversal` and emit `visible: false` on the LSML primitive.
  // Skipping them here would lose the source's structural fidelity (the
  // user expects the imported tree to contain every node from the
  // source, hidden or not, so they can re-show them by toggling
  // visibility in Figma without re-exporting).
  if (isOperatorInputComponent(node)) {
    console.warn("[lumencast]   → operator-input component, skipped from tree");
    ctx.trace?.push({ depth, type: node.type, id: node.id, name: node.name, action: "skip-operator-input" });
    return null;
  }

  // Build the parent-coords option block once — every leaf-primitive
  // mapper uses it to compute its `metadata.figma.position` relative to
  // the parent, so non-frame children of absolute layouts roundtrip.
  const parentOpts: { parentX?: number; parentY?: number; parentRotation?: number } = {};
  if (opts.parentX !== undefined) parentOpts.parentX = opts.parentX;
  if (opts.parentY !== undefined) parentOpts.parentY = opts.parentY;
  if (opts.parentRotation !== undefined) parentOpts.parentRotation = opts.parentRotation;

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
      case "STAR":
      case "POLYGON":
      case "LINE":
        console.warn("[lumencast]   → mapShape (", node.type, ")");
        ctx.trace?.push({ ...traceBase, action: "map-shape", note: node.type });
        return mapShape(node as never, ctx, parentOpts);
      case "BOOLEAN_OPERATION":
        // BOOLEAN_OPERATION has its operand vectors as children. Treating it
        // as a single shape via `mapShape` + `fillGeometry` would visually
        // flatten the union but DROP the operand nodes from the LSML tree
        // (the user expects a 1:1 node count with the source). Route it
        // through walkContainer so the operands round-trip as siblings —
        // for UNION (the common case) the rendered result is identical to
        // the boolean output since same-colour overlaps sum visually. Other
        // BO modes (subtract/intersect/exclude) lose the operation but keep
        // structural fidelity ; the visual loss is documented as a 1.1.x
        // limitation in the import logs.
        console.warn("[lumencast]   → walkContainer (BOOLEAN_OPERATION)");
        ctx.trace?.push({ ...traceBase, action: "walk-container", note: node.type });
        return walkContainer(node, ctx, opts);
      case "INSTANCE":
      case "FRAME": {
        const instOpts: {
          isRoot: boolean;
          parentX?: number;
          parentY?: number;
          parentRotation?: number;
        } = { isRoot: opts.isRoot };
        if (opts.parentX !== undefined) instOpts.parentX = opts.parentX;
        if (opts.parentY !== undefined) instOpts.parentY = opts.parentY;
        if (opts.parentRotation !== undefined) instOpts.parentRotation = opts.parentRotation;
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
  // Figma coordinate semantics : a node's `x/y` is relative to the closest
  // *coord-system* ancestor — FRAME/COMPONENT/INSTANCE/SECTION redefine the
  // origin, GROUP/BOOLEAN_OPERATION do NOT (their children's x/y stay in
  // the outer frame's coord system). When dispatching to per-primitive
  // mappers, opts.parentX/Y is the offset they'll subtract from the
  // child's x/y to compute its LSML position relative to its LSML parent.
  //
  //   - Coord-system parent (FRAME/etc.) : children's x is already local
  //     to this frame → pass parentX = 0.
  //   - Non-coord-system parent (GROUP/BOOLEAN_OPERATION) : children's x
  //     is in the outer frame's coord → pass parentX = node.x so the
  //     child's relX = child.x - group.x lands in the LSML group-frame's
  //     local coord system.
  const COORD_SYSTEM_TYPES = new Set([
    "FRAME",
    "COMPONENT",
    "INSTANCE",
    "SECTION",
    "COMPONENT_SET",
  ]);
  const isCoordSystem = COORD_SYSTEM_TYPES.has(node.type);
  const myX = isCoordSystem ? 0 : asNumber(node.x) ?? 0;
  const myY = isCoordSystem ? 0 : asNumber(node.y) ?? 0;
  // Rotation hierarchy : Figma reports each node's `rotation` independently
  // (the parent's rotation isn't subtracted). When we re-apply rotation on
  // every nested level on import, the visual rotation compounds and the
  // AABB inflates. Track the parent's rotation here and pass it to children
  // so `extractUniversal` emits LOCAL rotation (delta from parent's).
  const myRotation = asNumber(node.rotation) ?? 0;
  const childDepth = (opts.depth ?? 0) + 1;
  const childNodes = asArray<AnyFigmaNode>(node.children) ?? [];
  for (const child of childNodes) {
    const r = walk(child, ctx, {
      isRoot: false,
      parentX: myX,
      parentY: myY,
      parentRotation: myRotation,
      depth: childDepth,
    });
    if (r) childResults.push(r);
  }
  const children = childResults.map((r) => r.node) as PrimitiveNode[];

  // BOOLEAN_OPERATION render-fidelity : Figma's BO renders using its own
  // fill/strokes, IGNORING the operand vectors' own fill/stroke values.
  // Now that we recurse into BO operands (so the layer-panel structure
  // round-trips), we must override each operand's emitted fill/stroke
  // with the BO's own — otherwise the visible Union picks up the
  // operands' decorative gradients (e.g. the M emblem rendered half
  // white / half orange instead of pure white).
  if (node.type === "BOOLEAN_OPERATION") {
    const boFills = (asArray<FigmaPaint>(node.fills) ?? [])
      .filter((p) => p.type !== "IMAGE")
      .map((p) => paintToFill(p))
      .filter((f): f is Fill => f !== null);
    const boStrokes = mapBooleanOperationStrokes(node);
    for (const child of children) {
      overrideShapeFillsStrokes(child, boFills, boStrokes);
    }
  }

  let result: MappingResult;
  if (isStack) {
    const stackOpts: { parentX?: number; parentY?: number; parentRotation?: number } = {};
    if (opts.parentX !== undefined) stackOpts.parentX = opts.parentX;
    if (opts.parentY !== undefined) stackOpts.parentY = opts.parentY;
    if (opts.parentRotation !== undefined) stackOpts.parentRotation = opts.parentRotation;
    result = mapStack(node as never, children as StackPrimitive["children"], stackOpts);
  } else {
    const frameOpts: {
      isRoot: boolean;
      parentX?: number;
      parentY?: number;
      parentRotation?: number;
    } = { isRoot: opts.isRoot };
    if (opts.parentX !== undefined) frameOpts.parentX = opts.parentX;
    if (opts.parentY !== undefined) frameOpts.parentY = opts.parentY;
    if (opts.parentRotation !== undefined) frameOpts.parentRotation = opts.parentRotation;
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

interface FigmaSolidStroke {
  type: "SOLID";
  color: { r: number; g: number; b: number };
  opacity?: number;
}

function mapBooleanOperationStrokes(node: AnyFigmaNode): Stroke[] {
  const strokesArr = asArray<FigmaSolidStroke>(
    (node as unknown as { strokes?: unknown }).strokes,
  );
  if (!strokesArr) return [];
  const weight = asNumber((node as unknown as { strokeWeight?: unknown }).strokeWeight) ?? 1;
  const out: Stroke[] = [];
  for (const s of strokesArr) {
    if (s.type !== "SOLID" || !s.color) continue;
    const r = Math.round(s.color.r * 255);
    const g = Math.round(s.color.g * 255);
    const b = Math.round(s.color.b * 255);
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    out.push({ color: hex, width: weight });
  }
  return out;
}

/** Replace the fill/stroke fields on a SHAPE primitive (ignore others —
 *  text, image, frame, stack carry their own paint conventions) with the
 *  override values. Used by the BOOLEAN_OPERATION pass to make recursed
 *  operands render with the BO's own fills instead of their decorative
 *  per-operand gradients. */
function overrideShapeFillsStrokes(
  prim: PrimitiveNode,
  fills: Fill[],
  strokes: Stroke[],
): void {
  if ((prim as { kind: string }).kind !== "shape") return;
  const shape = prim as { fill?: string; fills?: Fill[]; stroke?: Stroke; strokes?: Stroke[] };
  delete shape.fill;
  delete shape.fills;
  if (
    fills.length === 1 &&
    fills[0]?.kind === "solid" &&
    fills[0].opacity === undefined
  ) {
    shape.fill = fills[0].color;
  } else if (fills.length > 0) {
    shape.fills = fills;
  }
  delete shape.stroke;
  delete shape.strokes;
  if (strokes.length === 1 && strokes[0]) {
    shape.stroke = strokes[0];
  } else if (strokes.length > 1) {
    shape.strokes = strokes;
  }
}
