// LSML image → Figma RECTANGLE with image fill.

import type { ImagePrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportShapeNode } from "../figma-api";
import { PLUGIN_DATA_KEYS, PLUGIN_DATA_NAMESPACE } from "~shared/constants";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import type { BuildContext } from "./types";

export function buildImage(
  prim: ImagePrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportShapeNode {
  const node = api.createRectangle();
  node.name = deriveName(prim);
  node.resize(prim.size.w, prim.size.h);

  // Resolve the asset path. The bind.src LeafPath usually starts with
  // `__lit.image.*` (synthesised) and points at `assets/<sha256>.<ext>` in
  // defaults. We then look up the Figma image hash in ctx.assetMap.
  let assetPath: string | null = null;
  const path = prim.bind.src;
  if (path) {
    const fromDefaults = ctx.defaults[path];
    if (typeof fromDefaults === "string") assetPath = fromDefaults;
  }

  // Preserve the synthesised `__lit.image.*` path for byte-stable roundtrip.
  if (path && path.startsWith("__lit.")) {
    node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_KEYS.litBindSrc, path);
  }

  if (assetPath !== null && ctx.assetMap[assetPath] !== undefined) {
    const fill: ImportPaint = {
      type: "IMAGE",
      imageHash: ctx.assetMap[assetPath]!,
      scaleMode: prim.fit === "contain" ? "FIT" : "FILL",
    };
    node.fills = [fill];
  } else {
    ctx.warn(
      "ASSET_MISSING",
      `Image at bind.src "${prim.bind.src}" has no resolvable asset bytes ; rendered as a transparent rectangle.`,
    );
    node.fills = [];
  }

  applyUniversal(node, prim);

  const figmaMeta = readFigmaMetadata(prim);
  if (figmaMeta.position) {
    (node as unknown as { x?: number; y?: number }).x = figmaMeta.position.x;
    (node as unknown as { x?: number; y?: number }).y = figmaMeta.position.y;
  }

  return node;
}

function deriveName(prim: ImagePrimitive): string {
  const path = prim.bind.src;
  if (path && !path.startsWith("__lit.")) {
    return `[bind:src=${path}] ${prim.alt || "Image"}`;
  }
  return prim.alt || "Image";
}
