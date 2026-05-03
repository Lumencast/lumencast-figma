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
import type { BuildContext } from "./builders/types";

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
  const tag = `${path}.${kind}${ariaOrName ? `[${ariaOrName.slice(0, 20)}]` : ""}`;
  console.warn("[lumencast] build →", tag);

  try {
    switch (prim.kind) {
      case "text":
        return buildText(prim, api, ctx);
      case "image":
        return buildImage(prim, api, ctx);
      case "shape":
        return buildShape(prim, api, ctx);
      case "frame": {
        const node = buildFrame(prim, api, ctx);
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          appendSafely(node, () => buildPrimitive(child, api, ctx, `${path}.children[${i}]`), ctx, `${path}.children[${i}]`);
        }
        return node;
      }
      case "stack": {
        const node = buildStack(prim, api, ctx);
        for (let i = 0; i < prim.children.length; i++) {
          const child = prim.children[i]!;
          appendSafely(node, () => buildPrimitive(child, api, ctx, `${path}.children[${i}]`), ctx, `${path}.children[${i}]`);
        }
        return node;
      }
      case "instance":
        return buildInstance(prim, api, ctx);
      default: {
        // grid / media / repeat / vendor — Phase 3 v0.1 surfaces them as a warning
        // and creates an empty placeholder frame so the tree shape survives.
        ctx.warn(
          "UNSUPPORTED_PRIMITIVE",
          `Primitive "${kind}" is not yet supported on import ; rendered as an empty frame.`,
        );
        const placeholder: ImportFrameNode = api.createFrame();
        placeholder.name = `[unsupported:${kind}]`;
        return placeholder;
      }
    }
  } catch (err) {
    // The primitive itself failed to build (not a child). We can't recover —
    // there's no node to return — but we log the error and re-throw so the
    // caller can decide. In practice the only callers are the two recursive
    // call sites above (frame / stack) which use `appendSafely`, so the
    // throw becomes a recoverable per-child failure.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lumencast] BUILD FAIL ${tag}: ${msg}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    throw err;
  }
}

/** Build + append one child, swallowing per-child failures. The parent
 *  keeps the children that succeeded ; the failed one becomes an
 *  IMPORT_BUILD_FAILED warning carrying the path + error message. */
function appendSafely(
  parent: { appendChild(child: ImportBaseNode): void },
  build: () => ImportBaseNode,
  ctx: BuildContext,
  path: string,
): void {
  let child: ImportBaseNode;
  try {
    child = build();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lumencast] APPEND skipped at ${path}: build failed — ${msg}`);
    ctx.warn("IMPORT_BUILD_FAILED", `Could not build primitive at ${path} : ${msg}`);
    return;
  }
  try {
    parent.appendChild(child);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lumencast] APPEND skipped at ${path}: appendChild failed — ${msg}`);
    ctx.warn("IMPORT_APPEND_FAILED", `Could not append child at ${path} : ${msg}`);
  }
}
