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
import { withFigmaMetadata, type FigmaMetadata } from "./figma-metadata";
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

  // Per-image-paint extras (LSML 1.1 §17.4 / x-figma.authoring/1).
  // Figma's IMAGE paint carries blendMode + opacity + scalingFactor + rotation
  // + filters + imageTransform alongside the imageHash. LSML's `image` only
  // has fit/size/bind.src, so without this metadata we lose the visual
  // composition (e.g. mix-blend-hard-light against a coloured layer
  // underneath produces the source's vivid red ; default NORMAL blend
  // collapses to a yellower / brighter render).
  const paintMeta = capturePaintExtras(imagePaint);
  if (paintMeta && Object.keys(paintMeta).length > 0) {
    withFigmaMetadata(prim, { imagePaint: paintMeta });
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim, {
    localPosition: prim.position ?? { x: 0, y: 0 },
  });

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

/** Extract the non-default fields of an IMAGE paint into the import-friendly
 *  shape stashed under `metadata.figma.imagePaint`. Skips defaults so plain
 *  images don't carry noise. Returns null when nothing is worth preserving.
 *
 *  Also reused by `mapFrame` / `mapStack` to capture IMAGE fills used as
 *  frame/stack backgrounds (avatar circles, hero banners, etc.). LSML's
 *  frame `backgrounds` field doesn't model image paints — we round-trip
 *  them via `metadata.figma.imageBackgrounds[]` which carries `src` plus
 *  the same surface as the image-primitive imagePaint metadata. */
export function capturePaintExtras(
  paint: FigmaPaint,
): NonNullable<FigmaMetadata["imagePaint"]> | null {
  const out: NonNullable<FigmaMetadata["imagePaint"]> = {};
  const blend = (paint as unknown as { blendMode?: unknown }).blendMode;
  if (typeof blend === "string" && blend !== "PASS_THROUGH" && blend !== "NORMAL") {
    out.blendMode = blend as NonNullable<typeof out.blendMode>;
  }
  if (typeof paint.opacity === "number" && paint.opacity !== 1) {
    out.opacity = paint.opacity;
  }
  if (paint.visible === false) out.visible = false;
  const scaling = (paint as unknown as { scalingFactor?: unknown }).scalingFactor;
  if (typeof scaling === "number" && scaling !== 1) out.scalingFactor = scaling;
  const rotation = (paint as unknown as { rotation?: unknown }).rotation;
  if (typeof rotation === "number" && rotation !== 0) out.rotation = rotation;
  const filters = (paint as unknown as { filters?: Record<string, unknown> }).filters;
  if (filters && typeof filters === "object") {
    const f: NonNullable<typeof out.filters> = {};
    for (const key of [
      "exposure",
      "contrast",
      "saturation",
      "temperature",
      "tint",
      "highlights",
      "shadows",
    ] as const) {
      const v = filters[key];
      if (typeof v === "number" && v !== 0) f[key] = v;
    }
    if (Object.keys(f).length > 0) out.filters = f;
  }
  // scaleMode : LSML's image.fit collapses CROP → cover (same as FILL),
  // but Figma honours imageTransform ONLY in CROP mode. Capture the raw
  // mode whenever it isn't the default FILL so the import side can
  // restore CROP and let the imageTransform actually take effect.
  const scaleMode = (paint as unknown as { scaleMode?: unknown }).scaleMode;
  if (
    typeof scaleMode === "string" &&
    (scaleMode === "FILL" || scaleMode === "FIT" || scaleMode === "CROP" || scaleMode === "TILE") &&
    scaleMode !== "FILL"
  ) {
    out.scaleMode = scaleMode;
  }
  const imageTransform = (paint as unknown as { imageTransform?: unknown }).imageTransform;
  if (Array.isArray(imageTransform) && imageTransform.length === 2) {
    const cleaned: number[][] = [];
    for (const r of imageTransform) {
      if (!Array.isArray(r) || r.length !== 3) return Object.keys(out).length > 0 ? out : null;
      cleaned.push(r.map((c) => (typeof c === "number" ? c : 0)));
    }
    // Skip the identity matrix [[1,0,0],[0,1,0]].
    const isIdentity =
      cleaned[0]![0] === 1 &&
      cleaned[0]![1] === 0 &&
      cleaned[0]![2] === 0 &&
      cleaned[1]![0] === 0 &&
      cleaned[1]![1] === 1 &&
      cleaned[1]![2] === 0;
    if (!isIdentity) out.imageTransform = cleaned;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type { MockImageNode };
