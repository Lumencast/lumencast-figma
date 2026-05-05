// Walk an LSML primitive tree, dispatching to per-primitive builders, and
// append child nodes to their parent containers.
//
// GROUP / BOOLEAN_OPERATION sources are NOT materialised as Frame
// placeholders any more. Instead, the iterator detects an LSML frame
// primitive whose `metadata.figma.sourceType` is GROUP/BOOLEAN_OPERATION
// and runs an inline "flat-then-group" path :
//
//   1. Recursively build the GROUP's descendants flat under the LSML
//      parent's Figma node (the FRAME ancestor in the source).
//   2. Each leaf carries `metadata.figma.transform` (composed through
//      the transparent-Group ancestor chain by `mapping/traverse.ts`),
//      so its world position lands correctly in the FRAME ancestor's
//      coord system on the first relativeTransform setter call.
//   3. Once descendants are appended, call `figma.group(descendants,
//      parent, index)` to wrap them into a real Figma GroupNode at the
//      same parent + index. Figma's group() preserves world position
//      by re-expressing each child's relativeTransform in the new
//      Group's local frame.
//
// This eliminates the previous Frame-placeholder + post-pass conversion
// machinery (groupConversions, frameResizeQueue, etc.) and gives us
// 1:1 fidelity with Figma's own group semantics — no cascade
// compensation, no double-resize, no clipsContent acrobatics.
//
// Every build call is wrapped in try/catch. When a primitive trips
// Figma's API (font not loaded, bad pathData, sizing constraint, etc.),
// we log the error with the primitive's kind + name + path, surface it
// as a warning, and continue with the rest of the tree. Without this
// the whole import bails on the first bad primitive and the user sees
// only the partial subtree that was already built.

import type { Fill, FramePrimitive, PrimitiveNode } from "~shared/lsml-types";
import type { ImportBaseNode, ImportFigmaApi, ImportFrameNode, ImportPaint } from "./figma-api";
import { buildText } from "./builders/text";
import { buildImage } from "./builders/image";
import { buildShape } from "./builders/shape";
import { buildFrame } from "./builders/frame";
import { buildStack } from "./builders/stack";
import { buildInstance } from "./builders/instance";
import { readFigmaMetadata, type FigmaMetadata } from "./figma-metadata";
import { cssToRgb } from "./color";
import { fillToPaint } from "./fill-to-paint";
import type { BuildContext } from "./builders/types";

type FramishParent = ImportBaseNode & {
  appendChild(child: ImportBaseNode): void;
  children?: ImportBaseNode[];
};

export function buildPrimitive(
  prim: PrimitiveNode,
  api: ImportFigmaApi,
  ctx: BuildContext,
  path = "$",
): ImportBaseNode {
  const kind = (prim as { kind: string }).kind;
  const ariaOrName =
    (prim as { ariaLabel?: string; alt?: string }).ariaLabel ??
    (prim as { ariaLabel?: string; alt?: string }).alt ??
    "";
  ctx.trace?.push({
    path,
    kind,
    ...(ariaOrName ? { name: ariaOrName } : {}),
    action: "build-start",
  });

  try {
    let result: ImportBaseNode;
    switch (prim.kind) {
      case "text":
        result = buildText(prim, api, ctx);
        break;
      case "image":
        result = buildImage(prim, api, ctx);
        break;
      case "shape":
        result = buildShape(prim, api, ctx);
        break;
      case "frame": {
        const node = buildFrame(prim, api, ctx);
        // GROUP / BOOLEAN_OPERATION sources MUST be intercepted at the
        // PARENT level (via `buildAndAttach`) so they take the flat-
        // then-group path. If we land here for such a prim, the caller
        // dispatched incorrectly — fall back to the regular Frame path
        // (children appended into the placeholder), which is wrong but
        // visible (the layer panel will show a Frame instead of a Group).
        // The trace records the mis-dispatch so we can detect it.
        const figmaMeta = readFigmaMetadata(prim);
        if (
          figmaMeta.sourceType === "GROUP" ||
          figmaMeta.sourceType === "BOOLEAN_OPERATION"
        ) {
          ctx.trace?.push({
            path,
            kind,
            action: "frame-dispatch-warn",
            error: "GROUP/BOOLEAN_OPERATION primitive built as Frame placeholder ; must be intercepted by buildAndAttach.",
          });
        }
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          buildAndAttach(child, node as FramishParent, api, ctx, `${path}.children[${i}]`);
        }
        // Re-resize after children are appended : children outside the
        // declared bbox can trigger Figma's auto-grow even with
        // clipsContent forced true (the forced flip is for safety ; the
        // re-resize is the definitive clamp).
        const fp = prim as { size?: { w: number; h: number } };
        if (fp.size) {
          try {
            (node as unknown as { resize(w: number, h: number): void }).resize(fp.size.w, fp.size.h);
          } catch {
            // Tolerate.
          }
        }
        result = node;
        break;
      }
      case "stack": {
        const node = buildStack(prim, api, ctx);
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          buildAndAttach(child, node as FramishParent, api, ctx, `${path}.children[${i}]`);
        }
        // Re-resize the stack after children are appended. For HUG axes
        // this is a no-op ; for FIXED axes it re-asserts the captured size.
        const sp = prim as { metadata?: Record<string, unknown> };
        const figmaMeta = (sp.metadata?.["figma"] ?? {}) as { size?: { w: number; h: number } };
        if (figmaMeta.size) {
          try {
            (node as unknown as { resize(w: number, h: number): void }).resize(
              figmaMeta.size.w,
              figmaMeta.size.h,
            );
          } catch {
            // Tolerate.
          }
        }
        result = node;
        break;
      }
      case "instance":
        result = buildInstance(prim, api, ctx);
        break;
      default: {
        // grid / media / repeat / vendor — surfaced as warning + empty
        // placeholder frame so the tree shape survives.
        ctx.warn(
          "UNSUPPORTED_PRIMITIVE",
          `Primitive "${kind}" is not yet supported on import ; rendered as an empty frame.`,
        );
        const placeholder: ImportFrameNode = api.createFrame();
        placeholder.name = `[unsupported:${kind}]`;
        result = placeholder;
        break;
      }
    }
    if (ctx.counter) ctx.counter.built++;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : undefined;
    ctx.trace?.push({
      path,
      kind,
      ...(ariaOrName ? { name: ariaOrName } : {}),
      action: "build-failed",
      error: stack ? `${msg}\n${stack}` : msg,
    });
    throw err;
  }
}

/** Build one child primitive and attach it to `parent`. Dispatches to the
 *  flat-then-group path when the child is a GROUP / BOOLEAN_OPERATION
 *  source ; otherwise builds the node and appends it normally. Returns
 *  the resulting node (already in `parent`) or null on failure.
 *
 *  When `inFlatGroupPath` is true the caller is `buildGroupInline`,
 *  meaning this child is being attached as a TRANSIENT flat sibling
 *  under the FRAME ancestor before `figma.group()` (or
 *  `figma.union/subtract/...`) wraps it. In that mode we re-assert
 *  size + sizing modes + `relativeTransform` AFTER `appendChild` :
 *
 *    - `relativeTransform` set BEFORE `appendChild` doesn't stick on
 *      off-tree nodes — Figma stores the matrix relative to the
 *      immediate parent, so it has to be re-applied once the parent
 *      exists. Without this, every flat-then-group leaf lands at
 *      (0, 0) in the FRAME ancestor and the wrap bbox collapses to a
 *      tiny union (visible in stats cards as `Group 2087326240` coming
 *      back at 27x15 with all sub-groups missing).
 *    - For an auto-layout `parent`, we additionally flip
 *      `layoutPositioning="ABSOLUTE"` to disable the stack's layout on
 *      this transient sibling, then replay
 *      `layoutSizingHorizontal/Vertical` + `resize()` (the
 *      `appendChild` had let the stack hug the child to its content's
 *      natural extent).
 *
 *  Regular child loops (non-flat-then-group) keep the default behaviour
 *  : builders set everything pre-attach, and the parent honours it. */
function buildAndAttach(
  prim: PrimitiveNode,
  parent: FramishParent,
  api: ImportFigmaApi,
  ctx: BuildContext,
  path: string,
  inFlatGroupPath = false,
): ImportBaseNode | null {
  const figmaMeta = readFigmaMetadata(prim);
  if (
    (prim as { kind: string }).kind === "frame" &&
    (figmaMeta.sourceType === "GROUP" || figmaMeta.sourceType === "BOOLEAN_OPERATION")
  ) {
    return buildGroupInline(
      prim as PrimitiveNode & { kind: "frame"; children: PrimitiveNode[] },
      figmaMeta,
      parent,
      api,
      ctx,
      path,
    );
  }
  let child: ImportBaseNode;
  try {
    child = buildPrimitive(prim, api, ctx, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warn("IMPORT_BUILD_FAILED", `Could not build primitive at ${path} : ${msg}`);
    return null;
  }
  try {
    parent.appendChild(child);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warn("IMPORT_APPEND_FAILED", `Could not append child at ${path} : ${msg}`);
    ctx.trace?.push({
      path,
      kind: child.type,
      action: "append-failed",
      error: msg,
    });
    return null;
  }
  // Flat-then-group post-attach replay.
  //
  // Two distinct host quirks this block compensates for, both visible
  // only after `appendChild` :
  //
  //   1. Figma's `relativeTransform` setter on an off-tree node doesn't
  //      stick — the matrix is stored relative to the immediate parent
  //      and that parent is undefined when `applyFigmaExtras` runs
  //      inside the builder. Without a post-attach replay, every
  //      flat-then-group leaf lands at (0, 0) in the FRAME ancestor
  //      and the eventual `figma.group()` wraps a stack of siblings at
  //      the origin → bbox collapses to a tiny union (`Group
  //      2087326240` coming back at 27×15 with the 4 sub-groups
  //      visually missing on the steps stats card was the symptom).
  //
  //   2. `layoutPositioning = "ABSOLUTE"` is only valid on a node
  //      already in an auto-layout parent — pre-attach assignment is
  //      silently dropped. On `appendChild` to an auto-layout stack
  //      the flat siblings then get arranged sequentially and shrunk
  //      to content's natural extent (`LOGO TXT 1` superposing
  //      `PICTO FINAL 2`, bento stats icon collapsing 25 → 15.8 px).
  //
  // For (1) we always replay `metadata.figma.transform`. For (2),
  // additionally only when the parent is auto-layout, we flip
  // ABSOLUTE + replay `layoutSizingHorizontal/Vertical` + `resize()`
  // so the stack stops managing the child and its captured
  // dimensions are honoured before the wrap.
  if (inFlatGroupPath) {
    if (isAutoLayout(parent)) {
      try {
        (child as unknown as { layoutPositioning?: string }).layoutPositioning = "ABSOLUTE";
      } catch {
        // Tolerate — host node may reject the property.
      }
      if (figmaMeta.layoutSizingHorizontal) {
        const v = figmaMeta.layoutSizingHorizontal;
        try {
          (child as unknown as { layoutSizingHorizontal?: string }).layoutSizingHorizontal = v;
        } catch {
          // Tolerate.
      }
    }
      if (figmaMeta.layoutSizingVertical) {
        const v = figmaMeta.layoutSizingVertical;
        try {
          (child as unknown as { layoutSizingVertical?: string }).layoutSizingVertical = v;
        } catch {
          // Tolerate.
        }
      }
      const size = (prim as { size?: { w: number; h: number } }).size ?? figmaMeta.size;
      if (size) {
        try {
          (child as unknown as { resize(w: number, h: number): void }).resize(size.w, size.h);
        } catch {
          // Tolerate — text nodes in HUG mode reject resize on the hugged axis.
        }
      }
    }
    if (figmaMeta.transform && figmaMeta.transform.length === 2) {
      try {
        (child as unknown as { relativeTransform?: number[][] }).relativeTransform =
          figmaMeta.transform;
      } catch {
        // Tolerate.
      }
    }
  }
  return child;
}

function isAutoLayout(node: ImportBaseNode): boolean {
  const mode = (node as unknown as { layoutMode?: string }).layoutMode;
  return mode === "HORIZONTAL" || mode === "VERTICAL";
}

type WrapKind = "group" | "union" | "subtract" | "intersect" | "exclude";

function pickWrapApi(
  api: ImportFigmaApi,
  meta: FigmaMetadata,
): {
  kind: WrapKind;
  fn: (
    nodes: ImportBaseNode[],
    parent: FramishParent,
    index?: number,
  ) => ImportBaseNode;
} {
  if (meta.sourceType !== "BOOLEAN_OPERATION") {
    return { kind: "group", fn: (n, p, i) => api.group(n, p, i) };
  }
  switch (meta.booleanOperation) {
    case "SUBTRACT":
      return { kind: "subtract", fn: (n, p, i) => api.subtract(n, p, i) };
    case "INTERSECT":
      return { kind: "intersect", fn: (n, p, i) => api.intersect(n, p, i) };
    case "EXCLUDE":
      return { kind: "exclude", fn: (n, p, i) => api.exclude(n, p, i) };
    case "UNION":
    default:
      return { kind: "union", fn: (n, p, i) => api.union(n, p, i) };
  }
}

/** Inline "flat-then-group" path for GROUP / BOOLEAN_OPERATION sources.
 *
 *  Recursively attaches the GROUP's descendants to `parent` (the LSML
 *  parent's Figma node — the FRAME ancestor in the source tree), then
 *  wraps the freshly-attached siblings in a Figma GroupNode via
 *  `figma.group()`. Each leaf carries `metadata.figma.transform`
 *  pre-composed in the FRAME ancestor's coord system, so its world
 *  position is correct on first attach.
 *
 *  Nested GROUPs work naturally : the inner GROUP's invocation also
 *  goes through this function, attaches its leaves to the same
 *  `parent`, and groups them — the resulting inner GroupNode is a
 *  child of `parent` at this point. The outer GROUP's invocation then
 *  groups [innerGroupNode, ...] into the outer Group, which Figma
 *  reparents from `parent` to the new outer Group automatically. */
function buildGroupInline(
  prim: PrimitiveNode & { kind: "frame"; children: PrimitiveNode[] },
  meta: FigmaMetadata,
  parent: FramishParent,
  api: ImportFigmaApi,
  ctx: BuildContext,
  path: string,
): ImportBaseNode | null {
  ctx.trace?.push({
    path,
    kind: "frame",
    ...(meta.layerName ? { name: meta.layerName } : {}),
    action: "group-inline-start",
  });

  // Build descendants flat under `parent`, keeping track of the
  // resulting node references in append order.
  //
  // When `parent` is an auto-layout stack, leaves and inner Groups
  // must be marked `layoutPositioning=ABSOLUTE` BEFORE they're
  // appended — otherwise the stack auto-arranges them and the
  // composed `relativeTransform` we set on each leaf is reset to a
  // layout-determined position. After the OUTER `figma.group()` call
  // wraps everything into a single Group (which becomes the stack's
  // direct child), THAT Group has default AUTO positioning so the
  // stack arranges it normally — same behaviour as the source's
  // GROUP-inside-stack. Internal positions of the Group's children
  // are preserved through the auto-positioning of the Group.
  const parentIsAutoLayout = isAutoLayout(parent);
  const flatChildren: ImportBaseNode[] = [];
  for (let i = 0; i < prim.children.length; i++) {
    const child = prim.children[i]!;
    const childPath = `${path}.children[${i}]`;
    // `inFlatGroupPath = true` always : every direct iteration of this
    // loop is, by definition, attaching a transient flat sibling that
    // will be wrapped by `figma.group()` (or
    // `figma.union/subtract/...`) below. The post-attach replay inside
    // `buildAndAttach` then re-asserts `relativeTransform` (and, for
    // auto-layout parents, the ABSOLUTE flip + size) so the wrap bbox
    // honours the captured FRAME-ancestor-relative geometry.
    const node = buildAndAttach(child, parent, api, ctx, childPath, true);
    if (node) {
      // For nested-group recursion: the recursive `buildGroupInline`
      // call creates an inner GroupNode inside `parent` and returns it.
      // It needs ABSOLUTE positioning too — the OUTER `figma.group()`
      // is still in our future and the stack would arrange the inner
      // Group as a regular stack child between now and then.
      if (parentIsAutoLayout) {
        try {
          (node as unknown as { layoutPositioning?: string }).layoutPositioning = "ABSOLUTE";
        } catch {
          // Tolerate.
        }
      }
      flatChildren.push(node);
    }
  }

  if (flatChildren.length === 0) {
    // Empty group — nothing to wrap. Don't emit a phantom GroupNode :
    // figma.group() throws on empty arrays. Surface as a warning so
    // the user knows the source group is gone.
    ctx.warn(
      "GROUP_EMPTY_SKIPPED",
      `GROUP placeholder at ${path} has 0 buildable children ; group is skipped.`,
    );
    return null;
  }

  // Compute insertion index : we want the resulting GroupNode to land
  // where the first flat child currently sits in `parent.children`.
  // figma.group() removes the children from `parent` and inserts the
  // new Group at this index.
  let index: number | undefined;
  const parentChildren = parent.children;
  if (parentChildren) {
    const i = parentChildren.indexOf(flatChildren[0]!);
    if (i >= 0) index = i;
  }

  // Pick the wrap API based on the source's container type. GROUP →
  // `figma.group`. BOOLEAN_OPERATION + flavour → `figma.union/subtract/
  // intersect/exclude` so SUBTRACT / INTERSECT / EXCLUDE actually carve
  // the operands instead of merely grouping them. Missing flavour or an
  // unknown value falls back to UNION (== group-equivalent visual for
  // operands whose fills were already overridden at export time).
  const wrap = pickWrapApi(api, meta);
  let group: ImportBaseNode;
  try {
    group = wrap.fn(flatChildren, parent, index);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BO conversion can fail when operands are types Figma refuses
    // (e.g. text, frames). Fall back to plain group so the layer panel
    // still shows the operands instead of dropping the whole subtree.
    if (wrap.kind !== "group") {
      ctx.warn(
        "BOOLEAN_OPERATION_FALLBACK",
        `${wrap.kind}() failed at ${path} : ${msg}. Falling back to figma.group() ; visual fidelity for the boolean op is lost.`,
      );
      try {
        group = api.group(flatChildren, parent, index);
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        ctx.warn(
          "GROUP_CONVERSION_FAILED",
          `figma.group() fallback also failed at ${path} : ${msg2}. The flat children remain in the parent at their world positions.`,
        );
        ctx.trace?.push({
          path,
          kind: "frame",
          action: "group-inline-failed",
          error: msg2,
        });
        return null;
      }
    } else {
      ctx.warn(
        "GROUP_CONVERSION_FAILED",
        `figma.group() failed at ${path} : ${msg}. The flat children remain in the parent at their world positions.`,
      );
      ctx.trace?.push({
        path,
        kind: "frame",
        action: "group-inline-failed",
        error: msg,
      });
      return null;
    }
  }

  (group as unknown as { name: string }).name = meta.layerName ?? "Group";
  // Universal props (LSML §5.4) — opacity / visible / rotation come from
  // the primitive itself, not metadata.figma. `figma.group()` produces a
  // GroupNode at default state, so we re-apply them here.
  const universal = prim as { opacity?: number; visible?: boolean; rotation?: number };
  if (universal.opacity !== undefined) {
    try {
      (group as unknown as { opacity?: number }).opacity = universal.opacity;
    } catch {
      // Tolerate.
    }
  }
  if (universal.visible === false) {
    try {
      (group as unknown as { visible?: boolean }).visible = false;
    } catch {
      // Tolerate.
    }
  }
  // Rotation : intentionally NOT applied on the resulting GroupNode.
  // Each leaf descendant already carries its FRAME-ancestor-relative
  // transform via `metadata.figma.transform` (composed through the
  // transparent-Group ancestor chain by `mapping/traverse.ts`), so the
  // source GROUP's own rotation is already baked into the leaves'
  // positions. Re-applying it here would double-rotate the visual.
  // `prim.rotation` is preserved in the LSML universal slot for non-
  // Figma consumers ; on Figma re-import, we ignore it on the Group.
  void universal.rotation;
  applyGroupishProperties(group, meta);

  // Real BooleanOperationNodes (figma.union/subtract/intersect/exclude)
  // paint with their OWN fills + strokes — operands are merely a source
  // of geometry. The mapping side captured the BO's paint on the LSML
  // frame primitive's `background` / `backgrounds[]` (and metadata
  // strokes), but `applyGroupishProperties` skips those keys on purpose
  // (groups don't paint, but BOs do). Apply them explicitly here when
  // the wrap actually produced a BooleanOperationNode — without this
  // every Subtract / Intersect / Exclude renders fully transparent.
  if (wrap.kind !== "group") {
    applyBooleanOperationPaint(group, prim);
  }

  if (ctx.counter) ctx.counter.built++;
  ctx.trace?.push({
    path,
    kind: "frame",
    action: "group-inline-done",
  });
  return group;
}

/** Properties that survive the source GROUP → resulting GroupNode
 *  transfer. `figma.group()` returns a fresh GroupNode whose properties
 *  are all defaults — we re-apply mask, blendMode, opacity, visible,
 *  effects, layout-related keys so the layer panel + render fidelity
 *  match the source. Keys excluded on purpose : `name` (set explicitly
 *  above), `relativeTransform` / `x` / `y` (figma.group owns the new
 *  Group's position — derived from children's bbox), `width` / `height`
 *  (Group sizing is auto), `clipsContent` (Groups don't clip),
 *  `fills` / `strokes` (Groups don't paint). */
const GROUPISH_PROPERTY_KEYS = [
  "isMask",
  "maskType",
  "blendMode",
  "opacity",
  "visible",
  "effects",
  "constraints",
  "layoutAlign",
  "layoutGrow",
  "layoutPositioning",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
] as const;

function applyGroupishProperties(group: ImportBaseNode, meta: FigmaMetadata): void {
  const dst = group as unknown as Record<string, unknown>;
  // Mask first : without this, a Group whose first child was a mask
  // comes back as an unmasked group and Figma reports its bbox as the
  // children-union instead of the masked region.
  if (meta.isMask !== undefined) trySet(dst, "isMask", meta.isMask);
  if (meta.maskType) trySet(dst, "maskType", meta.maskType);
  if (meta.blendMode) trySet(dst, "blendMode", meta.blendMode);
  // Universal opacity / visible come from prim.opacity / prim.visible —
  // not from metadata.figma. Read them via the helper below.
  // Effects + layout-related keys.
  if (meta.effects && meta.effects.length > 0) {
    // Effects need normalisation (visible/blendMode required) — defer
    // to applyFigmaExtras' helper isn't worth the import cycle here ;
    // groups rarely have effects in practice. Best-effort assignment.
    trySet(dst, "effects", meta.effects);
  }
  if (meta.constraints) trySet(dst, "constraints", meta.constraints);
  if (meta.layoutAlign && meta.layoutAlign !== "INHERIT" && meta.layoutAlign !== "CENTER") {
    trySet(dst, "layoutAlign", meta.layoutAlign);
  }
  if (meta.layoutGrow === 1) trySet(dst, "layoutGrow", 1);
  if (meta.layoutPositioning === "ABSOLUTE") trySet(dst, "layoutPositioning", "ABSOLUTE");
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    const v = (meta as unknown as Record<string, unknown>)[key];
    if (typeof v === "number") trySet(dst, key, v);
  }
  for (const key of ["layoutSizingHorizontal", "layoutSizingVertical"] as const) {
    const v = (meta as unknown as Record<string, unknown>)[key];
    if (typeof v === "string") trySet(dst, key, v);
  }
  // Silence unused warnings.
  void GROUPISH_PROPERTY_KEYS;
}

/** Apply the captured paint (LSML `background` / `backgrounds[]`) onto a
 *  freshly-created `BooleanOperationNode`. Mirrors the equivalent block
 *  in `builders/frame.ts`, but kept inline here because the BO node is
 *  produced by `figma.union/subtract/intersect/exclude` instead of going
 *  through `buildFrame`. Strokes / effects / blendMode flow via
 *  `applyGroupishProperties` which already handles them. */
function applyBooleanOperationPaint(node: ImportBaseNode, prim: PrimitiveNode): void {
  if ((prim as { kind: string }).kind !== "frame") return;
  const frame = prim as FramePrimitive & {
    background?: string;
    backgrounds?: Fill[];
  };
  const figmaMeta = readFigmaMetadata(prim);
  const transforms = figmaMeta.gradientTransforms ?? [];
  const writable = node as unknown as { fills?: ImportPaint[] };
  if (frame.backgrounds && frame.backgrounds.length > 0) {
    try {
      writable.fills = frame.backgrounds
        .map((f, i) => fillToPaint(f, transforms[i] ?? null))
        .filter((p): p is ImportPaint => p !== null);
    } catch {
      // Tolerate.
    }
    return;
  }
  if (frame.background !== undefined) {
    const rgb = cssToRgb(frame.background);
    if (!rgb) return;
    const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
    if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
    try {
      writable.fills = [fill];
    } catch {
      // Tolerate.
    }
  }
}

function trySet(dst: Record<string, unknown>, key: string, value: unknown): void {
  try {
    dst[key] = value;
  } catch {
    // Real Figma rejects properties that aren't valid for GroupNode.
    // Silently skip — visual fidelity for that one key is forfeited
    // but the rest of the transfer succeeds.
  }
}
