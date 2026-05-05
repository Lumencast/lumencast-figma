// Walk an LSML primitive tree, dispatching to per-primitive builders, and
// append child nodes to their parent containers.
//
// v0.2 : every build call is wrapped in try/catch. When a primitive trips
// Figma's API (font not loaded, bad pathData, sizing constraint, etc.),
// we log the error with the primitive's kind + name + path, surface it
// as a warning, and continue with the rest of the tree. Without this
// the whole import bails on the first bad primitive and the user sees
// only the partial subtree that was already built. The console trace is
// the diagnostic source — copy-paste it back when fidelity regresses.

import type { PrimitiveNode } from "~shared/lsml-types";
import type { ImportBaseNode, ImportFigmaApi, ImportFrameNode } from "./figma-api";
import { buildText } from "./builders/text";
import { buildImage } from "./builders/image";
import { buildShape } from "./builders/shape";
import { buildFrame } from "./builders/frame";
import { buildStack } from "./builders/stack";
import { buildInstance } from "./builders/instance";
import type { BuildContext, PendingGroupConversion } from "./builders/types";

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
  // No per-node console.warn : `ctx.trace?.push` already records the
  // same path/kind/action info structurally. On large bundles (8000+
  // primitives), per-node logging adds 15-20s of pure overhead in
  // Figma's plugin sandbox. The error path below still logs.
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
        // Track children references appended here so the post-build
        // group conversion (when applicable) doesn't depend on a late
        // `frame.children` read. We collect each successfully-built &
        // appended child explicitly. `appendSafely` is patched below to
        // accept this collector via the snapshot parameter — fall back
        // to no-snapshot when not needed.
        const childSnapshot: ImportBaseNode[] = [];
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          appendSafely(
            node,
            () => buildPrimitive(child, api, ctx, `${path}.children[${i}]`),
            ctx,
            `${path}.children[${i}]`,
            childSnapshot,
          );
        }
        // Re-resize AFTER children are appended. Some children
        // (especially absolutely-positioned ones extending outside the
        // frame's bbox) trigger Figma's auto-grow when clipsContent
        // wasn't honored on the initial appendChild — even with our
        // explicit clipsContent setter run before. Re-applying prim.size
        // here clamps the frame back to its source dimensions. Without
        // this, frames like `bg-texture` (source 1637×345 with overflow
        // children) re-import as 2205×858 = children-union bbox.
        const fp = prim as { size?: { w: number; h: number } };
        if (fp.size) {
          try {
            (node as unknown as { resize(w: number, h: number): void }).resize(fp.size.w, fp.size.h);
          } catch {
            // Tolerate.
          }
          // Queue a SECOND resize to run AFTER the post-pass figma.group
          // conversions, which can re-trigger Figma's auto-grow at
          // every ancestor frame (the converted Group's bbox propagates
          // up the chain). Without this, bg-texture gets stretched
          // from its declared 1637×345 to the children's union bbox
          // (~2205×858) at import time.
          if (ctx.frameResizeQueue) {
            ctx.frameResizeQueue.push({ node, w: fp.size.w, h: fp.size.h });
          }
        }
        // Queue this frame for group conversion AFTER children are
        // appended — the snapshot is now complete and will be used by
        // `figma.group()` in the post-pass instead of re-reading
        // `frame.children` (which has been observed to return empty in
        // dynamic-page mode for placeholders deep in the import tree,
        // even after reconcileAppend mounts the root to currentPage).
        const figmaMeta = ((prim as { metadata?: Record<string, unknown> }).metadata?.["figma"] ??
          {}) as { sourceType?: string };
        if (
          figmaMeta.sourceType === "GROUP" ||
          figmaMeta.sourceType === "BOOLEAN_OPERATION"
        ) {
          const entry: PendingGroupConversion = {
            frame: node,
            sourceType: figmaMeta.sourceType,
            children: childSnapshot,
          };
          ctx.groupConversions.push(entry);
          // Diagnostic : surface zero-children GROUP placeholders into
          // the trace archive. The user expects 3 vectors per Calque_1-2
          // ; if the snapshot is empty, the appendChild path silently
          // failed for every child of this placeholder. Surfacing it as
          // a structured warning makes the failure visible in
          // `_debug/import-trace.json` instead of silently disappearing
          // when the post-pass early-returns on `children.length === 0`.
          if (childSnapshot.length === 0 && prim.children.length > 0) {
            ctx.warn(
              "GROUP_PLACEHOLDER_EMPTY",
              `GROUP placeholder at ${path} has 0 appended children but the LSML primitive declared ${prim.children.length}. The post-pass will skip its conversion ; the source children are lost.`,
            );
          }
        }
        result = node;
        break;
      }
      case "stack": {
        const node = buildStack(prim, api, ctx);
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          appendSafely(node, () => buildPrimitive(child, api, ctx, `${path}.children[${i}]`), ctx, `${path}.children[${i}]`);
        }
        // Re-resize the stack after children are appended. For HUG axes
        // this is a no-op (Figma keeps the auto-derived dim) ; for FIXED
        // axes it re-asserts the captured size in case any child append
        // triggered an unexpected layout recalculation.
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
        // grid / media / repeat / vendor — Phase 3 v0.1 surfaces them as a warning
        // and creates an empty placeholder frame so the tree shape survives.
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
    // The primitive itself failed to build (not a child). We can't
    // recover — there's no node to return — so we record the error in
    // the trace and re-throw. The caller (appendSafely) catches and
    // pushes an IMPORT_BUILD_FAILED warning into the result archive.
    // No console output : the trace entry is the persistent record.
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

/** Build + append one child, swallowing per-child failures. The parent
 *  keeps the children that succeeded ; the failed one becomes an
 *  IMPORT_BUILD_FAILED warning carrying the path + error message.
 *  When `snapshot` is provided, every successfully-appended child is
 *  pushed onto it — used by GROUP placeholders to remember the children
 *  references at append time so the post-pass `figma.group()` doesn't
 *  rely on a late `frame.children` read. */
function appendSafely(
  parent: { appendChild(child: ImportBaseNode): void },
  build: () => ImportBaseNode,
  ctx: BuildContext,
  path: string,
  snapshot?: ImportBaseNode[],
): void {
  let child: ImportBaseNode;
  try {
    child = build();
  } catch (err) {
    // The build call already pushed a `build-failed` trace entry for
    // the child itself ; we just record the warning here so the UI
    // surfaces a count and the path is preserved in the warnings list.
    // The full stack trace lives in the trace entry pushed above.
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warn("IMPORT_BUILD_FAILED", `Could not build primitive at ${path} : ${msg}`);
    return;
  }
  try {
    parent.appendChild(child);
    // Append succeeded — record into the GROUP-placeholder snapshot
    // when the parent is queued for later group conversion. This sits
    // INSIDE the success branch so failed appends never pollute the
    // snapshot with orphan child references.
    if (snapshot) snapshot.push(child);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warn("IMPORT_APPEND_FAILED", `Could not append child at ${path} : ${msg}`);
    ctx.trace?.push({
      path,
      kind: child.type,
      action: "append-failed",
      error: msg,
    });
  }
}
