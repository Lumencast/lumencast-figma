// Walk an LSML primitive tree, dispatching to per-primitive builders, and
// append child nodes to their parent containers.

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
): ImportBaseNode {
  switch (prim.kind) {
    case "text":
      return buildText(prim, api, ctx);
    case "image":
      return buildImage(prim, api, ctx);
    case "shape":
      return buildShape(prim, api, ctx);
    case "frame": {
      const node = buildFrame(prim, api, ctx);
      for (const child of prim.children) {
        node.appendChild(buildPrimitive(child, api, ctx));
      }
      return node;
    }
    case "stack": {
      const node = buildStack(prim, api, ctx);
      for (const child of prim.children) {
        node.appendChild(buildPrimitive(child, api, ctx));
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
        `Primitive "${(prim as { kind: string }).kind}" is not yet supported on import ; rendered as an empty frame.`,
      );
      const placeholder: ImportFrameNode = api.createFrame();
      placeholder.name = `[unsupported:${(prim as { kind: string }).kind}]`;
      return placeholder;
    }
  }
}
