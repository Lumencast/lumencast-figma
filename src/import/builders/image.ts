// LSML image → Figma RECTANGLE with image fill.

import type { ImagePrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportShapeNode } from "../figma-api";
import { PLUGIN_DATA_KEYS, PLUGIN_DATA_NAMESPACE } from "~shared/constants";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import type { BuildContext } from "./types";

export function buildImage(
  prim: ImagePrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportShapeNode {
  const node = api.createRectangle();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? deriveName(prim);
  node.resize(prim.size.w, prim.size.h);

  // figma.createRectangle returns with a default black 1px stroke and no
  // effects ; clear them defensively so the IMAGE paint we install below
  // isn't visually polluted by a phantom border. Fills are replaced
  // wholesale a few lines down so we don't need to clear those.
  (node as unknown as { strokes?: unknown[] }).strokes = [];
  (node as unknown as { effects?: unknown[] }).effects = [];

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
    // metadata.figma.imagePaint.scaleMode wins over the LSML fit-derived
    // default — Figma honours `imageTransform` ONLY in CROP mode, so a
    // panned/zoomed source paint must round-trip with scaleMode=CROP or
    // its transform is silently ignored at re-import.
    const metaScaleMode = readFigmaMetadata(prim).imagePaint?.scaleMode;
    const scaleMode = metaScaleMode ?? (prim.fit === "contain" ? "FIT" : "FILL");
    const fill: ImportPaint = {
      type: "IMAGE",
      imageHash: ctx.assetMap[assetPath]!,
      scaleMode,
    };
    // Splice per-paint extras from `metadata.figma.imagePaint` (LSML 1.1
    // §17.4 / x-figma.authoring/1) so blendMode + scalingFactor + rotation
    // + filters + imageTransform survive the round-trip. Without this the
    // visual collapses to a default-blend render and the user's vivid red
    // (HARD_LIGHT against an underlying coloured layer) becomes a yellower
    // raw-image render.
    const ip = figmaMeta.imagePaint;
    if (ip) {
      const w = fill as unknown as Record<string, unknown>;
      if (ip.blendMode) w["blendMode"] = ip.blendMode;
      if (ip.opacity !== undefined) w["opacity"] = ip.opacity;
      if (ip.visible !== undefined) w["visible"] = ip.visible;
      if (ip.scalingFactor !== undefined) w["scalingFactor"] = ip.scalingFactor;
      if (ip.rotation !== undefined) w["rotation"] = ip.rotation;
      if (ip.filters) w["filters"] = ip.filters;
      if (ip.imageTransform) w["imageTransform"] = ip.imageTransform;
    }
    node.fills = [fill];
  } else {
    ctx.warn(
      "ASSET_MISSING",
      `Image at bind.src "${prim.bind.src}" has no resolvable asset bytes ; rendered as a transparent rectangle.`,
    );
    node.fills = [];
  }

  applyUniversal(node, prim);
  applyFigmaExtras(node, figmaMeta);

  // Position : universal prop (LSML 1.1 §5.4) with v0.1 metadata fallback.
  const pos = prim.position ?? figmaMeta.position;
  if (pos) {
    (node as unknown as { x?: number; y?: number }).x = pos.x;
    (node as unknown as { x?: number; y?: number }).y = pos.y;
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
