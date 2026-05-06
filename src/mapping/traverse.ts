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
  // Used by BOOLEAN_OPERATION only.
  booleanOperation?: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE";
}

function isOperatorInputComponent(node: AnyFigmaNode, ctx: MappingContext): boolean {
  if (node.type === "COMPONENT") return node.name === OPERATOR_INPUT_COMPONENT_NAME;
  if (node.type === "INSTANCE") {
    // dynamic-page documents : `node.mainComponent` throws, so we read
    // the value the export pipeline pre-resolved into ctx. Tests / mock
    // surfaces don't populate the map ; fall through to the sync getter.
    const map = ctx.mainComponentMap;
    const mc = map?.has(node.id) ? map.get(node.id) : node.mainComponent;
    return mc?.name === OPERATOR_INPUT_COMPONENT_NAME;
  }
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
  /** True iff the immediate parent in the source tree is a GROUP or
   *  BOOLEAN_OPERATION (i.e. a non-coord-system "transparent" container).
   *  When set, the per-primitive mapper captures `metadata.figma.transform`
   *  (frame-ancestor-relative) so the Figma importer can `figma.group()`
   *  the children flat under the FRAME ancestor. */
  parentIsTransparent?: boolean;
  /** Composed 2x3 transform matrix of every transparent-Group ancestor
   *  between the FRAME ancestor (exclusive) and the current node
   *  (exclusive). Multiplied with `node.relativeTransform` to express the
   *  node's transform in the FRAME ancestor's coord system, regardless of
   *  how deep the GROUP chain is. Identity (undefined) when the immediate
   *  parent is a coord-system container. */
  groupChainTransform?: number[][];
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
  // No per-node console output : `ctx.trace?.push(...)` already records
  // the same information structurally, and 8000+ console.warn calls in
  // Figma's plugin sandbox add ~15-20s of pure logging overhead on a
  // medium-size scene. Step-level summaries in bundle.ts remain.
  //
  // Invisible nodes are NOT skipped — they flow through to the per-
  // primitive mappers, which read `node.visible === false` via
  // `extractUniversal` and emit `visible: false` on the LSML primitive.
  // Skipping them here would lose the source's structural fidelity (the
  // user expects the imported tree to contain every node from the
  // source, hidden or not, so they can re-show them by toggling
  // visibility in Figma without re-exporting).
  if (isOperatorInputComponent(node, ctx)) {
    ctx.trace?.push({
      depth,
      type: node.type,
      id: node.id,
      name: node.name,
      action: "skip-operator-input",
    });
    return null;
  }

  // Build the parent-coords option block once — every leaf-primitive
  // mapper uses it to compute its `metadata.figma.position` relative to
  // the parent, so non-frame children of absolute layouts roundtrip.
  const parentOpts: {
    parentX?: number;
    parentY?: number;
    parentRotation?: number;
    parentIsTransparent?: boolean;
    groupChainTransform?: number[][];
  } = {};
  if (opts.parentX !== undefined) parentOpts.parentX = opts.parentX;
  if (opts.parentY !== undefined) parentOpts.parentY = opts.parentY;
  if (opts.parentRotation !== undefined) parentOpts.parentRotation = opts.parentRotation;
  if (opts.parentIsTransparent) parentOpts.parentIsTransparent = true;
  if (opts.groupChainTransform) parentOpts.groupChainTransform = opts.groupChainTransform;

  const traceBase = { depth, type: node.type, id: node.id, name: node.name };
  try {
    switch (node.type) {
      case "TEXT":
        ctx.trace?.push({ ...traceBase, action: "map-text" });
        return mapText(node as never, parentOpts);
      case "RECTANGLE":
        if (hasImageFill(node)) {
          ctx.trace?.push({ ...traceBase, action: "map-image" });
          return mapImage(node as never, ctx, parentOpts);
        }
        ctx.trace?.push({ ...traceBase, action: "map-shape", note: "rect" });
        return mapShape(node as never, ctx, parentOpts);
      case "ELLIPSE":
      case "VECTOR":
      case "STAR":
      case "POLYGON":
      case "LINE":
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
        ctx.trace?.push({ ...traceBase, action: "walk-container", note: node.type });
        return walkContainer(node, ctx, opts);
      case "INSTANCE":
      case "FRAME": {
        const instOpts: {
          isRoot: boolean;
          parentX?: number;
          parentY?: number;
          parentRotation?: number;
          parentIsTransparent?: boolean;
          groupChainTransform?: number[][];
        } = { isRoot: opts.isRoot };
        if (opts.parentX !== undefined) instOpts.parentX = opts.parentX;
        if (opts.parentY !== undefined) instOpts.parentY = opts.parentY;
        if (opts.parentRotation !== undefined) instOpts.parentRotation = opts.parentRotation;
        if (opts.parentIsTransparent) instOpts.parentIsTransparent = true;
        if (opts.groupChainTransform) instOpts.groupChainTransform = opts.groupChainTransform;
        const inst = mapInstance(node as never, instOpts, ctx);
        if (inst) {
          ctx.trace?.push({ ...traceBase, action: "map-instance" });
          return inst;
        }
        ctx.trace?.push({ ...traceBase, action: "walk-container", note: node.type });
        return walkContainer(node, ctx, opts);
      }
      case "COMPONENT":
      case "GROUP":
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
    // Persist failure into the mapping trace so it lands in the export
    // archive's `_debug/mapping-trace.json`. No console output : the
    // archive is the authoritative record.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : undefined;
    ctx.trace?.push({
      ...traceBase,
      action: "error",
      error: stack ? `${msg}\n${stack}` : msg,
    });
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
  const myX = isCoordSystem ? 0 : (asNumber(node.x) ?? 0);
  const myY = isCoordSystem ? 0 : (asNumber(node.y) ?? 0);
  // Rotation hierarchy : Figma reports each node's `rotation` independently
  // (the parent's rotation isn't subtracted). When we re-apply rotation on
  // every nested level on import, the visual rotation compounds and the
  // AABB inflates. Track the parent's rotation here and pass it to children
  // so `extractUniversal` emits LOCAL rotation (delta from parent's).
  const myRotation = asNumber(node.rotation) ?? 0;
  const isTransparentGroup = node.type === "GROUP" || node.type === "BOOLEAN_OPERATION";

  // Group chain transform : compose ancestor transparent-Group `relativeTransform`
  // matrices so that a leaf inside G1→G2→G3→V can express its transform
  // directly in F's frame (where F is the FRAME ancestor). Children of a
  // FRAME / STACK / SECTION / COMPONENT / INSTANCE start fresh (the chain
  // resets) ; children of a GROUP / BOOLEAN_OPERATION inherit our chain
  // composed with our own relTrans.
  let childChain: number[][] | undefined;
  if (isTransparentGroup) {
    const myMat = parseRelativeTransform(
      (node as { relativeTransform?: unknown }).relativeTransform,
    );
    if (myMat) {
      childChain = compose2x3(opts.groupChainTransform, myMat);
    } else {
      childChain = opts.groupChainTransform;
    }
  } else if (isCoordSystem) {
    childChain = undefined; // reset
  } else {
    childChain = opts.groupChainTransform; // pass through
  }

  const childDepth = (opts.depth ?? 0) + 1;
  const childNodes = asArray<AnyFigmaNode>(node.children) ?? [];
  for (const child of childNodes) {
    const childOpts: WalkOptions = {
      isRoot: false,
      parentX: myX,
      parentY: myY,
      parentRotation: myRotation,
      depth: childDepth,
    };
    if (isTransparentGroup) childOpts.parentIsTransparent = true;
    if (childChain) childOpts.groupChainTransform = childChain;
    const r = walk(child, ctx, childOpts);
    if (r) childResults.push(r);
  }
  const children = childResults.map((r) => r.node) as PrimitiveNode[];

  // BOOLEAN_OPERATION render-fidelity, UNION-only fallback.
  //
  // For UNION (and the unknown/legacy case), the importer wraps the
  // operands in a plain GroupNode — operands paint with their own
  // fills, so we override each operand with the BO's fills to
  // reproduce the visible same-colour union. SUBTRACT / INTERSECT /
  // EXCLUDE are now reconstructed as real BooleanOperationNodes by the
  // importer (`figma.subtract` / `intersect` / `exclude`), which
  // renders with the BO's own paint regardless of the operands' fills
  // — overriding there would silently destroy the operands' source
  // fills with no visual benefit.
  if (node.type === "BOOLEAN_OPERATION") {
    const op = node.booleanOperation ?? "UNION";
    if (op === "UNION") {
      const boFills = (asArray<FigmaPaint>(node.fills) ?? [])
        .filter((p) => p.type !== "IMAGE")
        .map((p) => paintToFill(p))
        .filter((f): f is Fill => f !== null);
      const boStrokes = mapBooleanOperationStrokes(node);
      for (const child of children) {
        overrideShapeFillsStrokes(child, boFills, boStrokes);
      }
    }
  }

  let result: MappingResult;
  if (isStack) {
    const stackOpts: {
      parentX?: number;
      parentY?: number;
      parentRotation?: number;
      parentIsTransparent?: boolean;
      groupChainTransform?: number[][];
    } = {};
    if (opts.parentX !== undefined) stackOpts.parentX = opts.parentX;
    if (opts.parentY !== undefined) stackOpts.parentY = opts.parentY;
    if (opts.parentRotation !== undefined) stackOpts.parentRotation = opts.parentRotation;
    if (opts.parentIsTransparent) stackOpts.parentIsTransparent = true;
    if (opts.groupChainTransform) stackOpts.groupChainTransform = opts.groupChainTransform;
    result = mapStack(node as never, children as StackPrimitive["children"], stackOpts, ctx);
  } else {
    const frameOpts: {
      isRoot: boolean;
      parentX?: number;
      parentY?: number;
      parentRotation?: number;
      parentIsTransparent?: boolean;
      groupChainTransform?: number[][];
    } = { isRoot: opts.isRoot };
    if (opts.parentX !== undefined) frameOpts.parentX = opts.parentX;
    if (opts.parentY !== undefined) frameOpts.parentY = opts.parentY;
    if (opts.parentRotation !== undefined) frameOpts.parentRotation = opts.parentRotation;
    if (opts.parentIsTransparent) frameOpts.parentIsTransparent = true;
    if (opts.groupChainTransform) frameOpts.groupChainTransform = opts.groupChainTransform;
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
  const strokesArr = asArray<FigmaSolidStroke>((node as unknown as { strokes?: unknown }).strokes);
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
/** Coerce a Figma `relativeTransform` (which may carry `figma.mixed`
 *  Symbol-wrapped numbers via the host bridge) into a clean 2x3 number
 *  matrix. Returns null when the shape doesn't match. */
function parseRelativeTransform(raw: unknown): number[][] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const out: number[][] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length !== 3) return null;
    const row: number[] = [];
    for (const c of r) {
      const n = asNumber(c);
      if (n === undefined) return null;
      row.push(n);
    }
    out.push(row);
  }
  return out;
}

/** Compose two 2x3 affine transforms : returns A * B treating each as a
 *  3x3 matrix with the implicit `[0,0,1]` last row. Used to flatten a
 *  chain of transparent-Group `relativeTransform`s when capturing a leaf
 *  child's frame-ancestor-relative transform. Pass `undefined` for A as
 *  identity. */
function compose2x3(a: number[][] | undefined, b: number[][]): number[][] {
  if (!a)
    return [
      [b[0]![0]!, b[0]![1]!, b[0]![2]!],
      [b[1]![0]!, b[1]![1]!, b[1]![2]!],
    ];
  const a00 = a[0]![0]!,
    a01 = a[0]![1]!,
    a02 = a[0]![2]!;
  const a10 = a[1]![0]!,
    a11 = a[1]![1]!,
    a12 = a[1]![2]!;
  const b00 = b[0]![0]!,
    b01 = b[0]![1]!,
    b02 = b[0]![2]!;
  const b10 = b[1]![0]!,
    b11 = b[1]![1]!,
    b12 = b[1]![2]!;
  return [
    [a00 * b00 + a01 * b10, a00 * b01 + a01 * b11, a00 * b02 + a01 * b12 + a02],
    [a10 * b00 + a11 * b10, a10 * b01 + a11 * b11, a10 * b02 + a11 * b12 + a12],
  ];
}

function overrideShapeFillsStrokes(prim: PrimitiveNode, fills: Fill[], strokes: Stroke[]): void {
  if ((prim as { kind: string }).kind !== "shape") return;
  const shape = prim as { fill?: string; fills?: Fill[]; stroke?: Stroke; strokes?: Stroke[] };
  delete shape.fill;
  delete shape.fills;
  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
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
