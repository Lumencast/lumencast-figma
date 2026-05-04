// Figma RECTANGLE with image fill → LSML `image` (§4.5).
//
// The image bytes are referenced by Figma `imageHash`. The mapping layer asks
// the export pipeline (`registerImageHash`) for the content-addressed asset
// path, which it uses as the static `src` ; if the layer name carries a
// `[bind:src=...]`, that wins instead.
//
// `alt` is required by §13. The layer name (with `[bind:...]` stripped) is the
// default value ; designers can override by setting `lumencast.alt` plugin
// data (deferred to v0.2 — kept simple here).

import type { ImagePrimitive } from "~shared/lsml-types";
import { parseLayerName } from "../export/bindings";
import { extractUniversal } from "./universal";
import { PLUGIN_DATA_KEYS, PLUGIN_DATA_NAMESPACE } from "~shared/constants";
import { asArray, asNumber } from "./figma-mixed";
import { withFigmaMetadata } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import type { FigmaPaint } from "./color";
import type { MappingContext, MappingResult } from "./types";

interface MockImageNode {
  type: "RECTANGLE";
  id: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  getSharedPluginData?(namespace: string, key: string): string;
}

export interface ImageMapOptions {
  parentRotation?: number;
  parentX?: number;
  parentY?: number;
}

export function mapImage(
  node: MockImageNode,
  ctx: MappingContext,
  opts?: ImageMapOptions,
): MappingResult | null {
  const fillsArr = asArray<FigmaPaint>(node.fills);
  if (!fillsArr) return null;
  const imagePaint = fillsArr.find(
    (p) => p.type === "IMAGE" && typeof p.imageHash === "string" && p.imageHash !== "",
  );
  if (!imagePaint) return null;

  const parsed = parseLayerName(node.name, { primitiveKind: "image" });
  const hash = imagePaint.imageHash as string;

  // LSML §4.5 + schema : `bind.src` is required. Either the layer name
  // declares it explicitly, or we synthesise a literal leaf path that
  // resolves to the content-addressed asset URL via `defaults`.
  let bind: { src: string };
  let defaults: Record<string, unknown> | undefined;
  const declaredSrc = parsed.bind?.["src"];
  if (typeof declaredSrc === "string") {
    bind = { src: declaredSrc };
  } else {
    // Roundtrip stability — re-imported nodes carry the original __lit path.
    const preserved = readPluginData(node, PLUGIN_DATA_KEYS.litBindSrc);
    const litPath = preserved ?? synthLiteralPath(node.id);
    const assetPath = ctx.registerImageHash?.(hash);
    bind = { src: litPath };
    if (assetPath) {
      defaults = { [litPath]: assetPath };
    } else {
      ctx.warn("ASSET_EXTRACTION_FAILED", `Failed to register image hash ${hash}`, node.id);
      defaults = { [litPath]: "" };
    }
  }

  const w = asNumber(node.width) ?? 0;
  const h = asNumber(node.height) ?? 0;
  const prim: ImagePrimitive = {
    kind: "image",
    bind,
    alt: parsed.displayName || "",
    size: { w: roundTo3(w), h: roundTo3(h) },
    ...extractUniversal(node, { parentRotation: opts?.parentRotation ?? 0 }),
  };

  // Map Figma scaleMode → LSML fit. Figma defaults to FILL.
  const fit = scaleModeToFit(imagePaint.scaleMode);
  if (fit) prim.fit = fit;

  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  // Universal `position` (LSML §5.4) — relative to parent's coordinate
  // origin. Honoured by frame parents in absolute mode.
  const px = asNumber(node.x) ?? 0;
  const py = asNumber(node.y) ?? 0;
  const parentX = opts?.parentX ?? 0;
  const parentY = opts?.parentY ?? 0;
  const relX = roundTo3(px - parentX);
  const relY = roundTo3(py - parentY);
  if (relX !== 0 || relY !== 0) prim.position = { x: relX, y: relY };

  // Stash the source layer name so the import side can restore it verbatim.
  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim);

  const out: { node: ImagePrimitive; defaults?: Record<string, unknown>; assetRefs: string[] } = {
    node: prim,
    assetRefs: [hash],
  };
  if (defaults) out.defaults = defaults;
  return out;
}

function synthLiteralPath(id: string): string {
  return `__lit.image.${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function readPluginData(node: MockImageNode, key: string): string | null {
  if (typeof node.getSharedPluginData !== "function") return null;
  const v = node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, key);
  return v === "" ? null : v;
}

function scaleModeToFit(mode: FigmaPaint["scaleMode"] | undefined): ImagePrimitive["fit"] | null {
  switch (mode) {
    case "FILL":
      return "cover";
    case "FIT":
      return "contain";
    case "CROP":
      return "cover";
    case "TILE":
      return null; // Not representable in LSML 1.1 ; we drop it.
    default:
      return null;
  }
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { MockImageNode };
