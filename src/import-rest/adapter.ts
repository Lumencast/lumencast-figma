// REST → mapper-surface adapter.
//
// `src/mapping` consumes the in-sandbox main-thread Figma shape: a node tree
// with `x/y/width/height`, `fills[]` carrying `imageHash`/`scaleMode`/
// `gradientStops`/`gradientTransform`, node-level `blendMode`, `visible`, and
// `children`. The bitmaps are resolved via a `FigmaApiSurface.getImageByHash`.
//
// The Figma REST node JSON is a DIFFERENT shape: it has `absoluteBoundingBox`
// instead of `x/y`, `fills[].imageRef` instead of `imageHash`,
// `gradientHandlePositions` instead of a `gradientTransform` matrix, and
// `fillGeometry[].path` instead of `.data`. The bitmaps are not in-band — they
// are referenced by `imageRef` and resolved to bytes via a CDN URL.
//
// This module performs that normalization WITHOUT touching `src/mapping`:
//   1. `adaptNode` rewrites a REST subtree to the main-thread shape, preserving
//      absolute positions, hierarchy, sizes, and `visible` exactly (the
//      structural-diff=0 invariant of ADR 002 RC2).
//   2. `createRestImageSurface` returns a `getImageByHash`-compatible surface
//      whose handles download the real bytes via the REST client. The asset
//      registry (`src/export/assets.ts`) then runs the SAME finalize path —
//      raster-allowlist / SVG sanitizer (#N) — over those bytes. This module
//      never produces a `data:` URI itself: it only supplies raw bytes to the
//      existing gated path (Bastion: no allowlist bypass).

import type { FigmaRestClient } from "./client";
import type { RestNode, RestPaint, RestVector } from "./types";

/** Main-thread-shaped paint the mapper reads. Field names match the plugin
 *  API (`imageHash`, `gradientTransform`), not REST (`imageRef`,
 *  `gradientHandlePositions`). */
interface AdaptedPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  color?: { r: number; g: number; b: number };
  gradientStops?: { position: number; color: { r: number; g: number; b: number; a: number } }[];
  gradientTransform?: number[][];
  imageHash?: string;
  scaleMode?: string;
}

/** Main-thread-shaped node the mapper walks. A structural mirror of the REST
 *  node with positions/sizes hoisted out of `absoluteBoundingBox` and paints
 *  normalized. `children` recurses. Extra fields the mapper may read
 *  (cornerRadius, strokeWeight, characters, style) pass through. */
export interface AdaptedNode {
  type: string;
  id: string;
  name: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: AdaptedPaint[];
  strokes?: { type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number }[];
  strokeWeight?: number;
  cornerRadius?: number;
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  fillGeometry?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  /** Figma mask semantics — a node with `isMask:true` masks its following
   *  siblings. Read by the mapper's `applyImageMaskGroups` (traverse.ts). REST
   *  exposes these on the node exactly as the plugin API does. */
  isMask?: boolean;
  maskType?: string;
  /** BOOLEAN_OPERATION operator (UNION / SUBTRACT / …) — the mapper reads it to
   *  decide the union fallback vs a real boolean node. */
  booleanOperation?: string;
  characters?: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  fontWeight?: number;
  textAlignHorizontal?: string;
  children?: AdaptedNode[];
  /** Set by `getSharedPluginData` shim — the REST path carries no plugin data,
   *  so every lookup returns "". */
  getSharedPluginData?: (ns: string, key: string) => string;
  [k: string]: unknown;
}

/** Convert Figma REST gradient handle positions to the 2×3 affine matrix the
 *  plugin API exposes as `paint.gradientTransform`. Figma's handles are three
 *  points in 0..1 object space: P0 (start/center), P1 (end of main axis), P2
 *  (end of cross axis). The gradient transform maps the unit square's basis
 *  onto these handles: column 0 = (P1 − P0), column 1 = (P2 − P0), translation
 *  = P0. Row-major `[[a, c, e], [b, d, f]]` to match `matrixToGradientTransform`
 *  (mapping/lsml-1_2.ts), which reads `t[0] = [a, c, e]`, `t[1] = [b, d, f]`. */
function handlesToGradientTransform(handles: RestVector[] | undefined): number[][] | undefined {
  if (!handles || handles.length < 3) return undefined;
  const p0 = handles[0];
  const p1 = handles[1];
  const p2 = handles[2];
  if (!p0 || !p1 || !p2) return undefined;
  const a = p1.x - p0.x;
  const b = p1.y - p0.y;
  const c = p2.x - p0.x;
  const d = p2.y - p0.y;
  return [
    [a, c, p0.x],
    [b, d, p0.y],
  ];
}

function adaptPaint(paint: RestPaint): AdaptedPaint {
  const out: AdaptedPaint = { type: paint.type };
  if (paint.visible !== undefined) out.visible = paint.visible;
  if (paint.opacity !== undefined) out.opacity = paint.opacity;
  if (paint.blendMode !== undefined) out.blendMode = paint.blendMode;
  if (paint.color) out.color = { r: paint.color.r, g: paint.color.g, b: paint.color.b };
  if (paint.gradientStops) {
    out.gradientStops = paint.gradientStops.map((s) => ({
      position: s.position,
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
    }));
  }
  const gt = handlesToGradientTransform(paint.gradientHandlePositions);
  if (gt) out.gradientTransform = gt;
  // REST `imageRef` IS the content hash the surface resolves to bytes — feed it
  // through as `imageHash` so the mapper registers it via the gated
  // `registerImageHashAsDataUri` path (no bypass).
  if (typeof paint.imageRef === "string" && paint.imageRef !== "") out.imageHash = paint.imageRef;
  if (paint.scaleMode !== undefined) out.scaleMode = paint.scaleMode;
  return out;
}

function noPluginData(): string {
  return "";
}

/** Adapt a REST node subtree to the main-thread shape `src/mapping` consumes.
 *  Positions, sizes, hierarchy, and `visible` are preserved exactly. */
export function adaptNode(node: RestNode): AdaptedNode {
  const box = node.absoluteBoundingBox ?? null;
  const out: AdaptedNode = {
    type: node.type,
    id: node.id,
    name: node.name,
    getSharedPluginData: noPluginData,
  };
  // `visible` defaults to true in REST (the field is omitted when visible).
  // Carry it explicitly so a hidden node lowers to `visible: false` (RC2).
  if (node.visible !== undefined) out.visible = node.visible;
  if (node.opacity !== undefined) out.opacity = node.opacity;
  if (node.rotation !== undefined) out.rotation = node.rotation;
  if (node.blendMode !== undefined) out.blendMode = node.blendMode;
  if (box) {
    out.x = box.x;
    out.y = box.y;
    out.width = box.width;
    out.height = box.height;
  }
  if (node.fills) out.fills = node.fills.map(adaptPaint);
  if (node.strokes) {
    out.strokes = node.strokes
      .filter((s) => s.type === "SOLID" && s.color)
      .map((s) => {
        const color = s.color as { r: number; g: number; b: number };
        const stroke: {
          type: "SOLID";
          color: { r: number; g: number; b: number };
          opacity?: number;
        } = { type: "SOLID", color: { r: color.r, g: color.g, b: color.b } };
        if (s.opacity !== undefined) stroke.opacity = s.opacity;
        return stroke;
      });
  }
  if (node.strokeWeight !== undefined) out.strokeWeight = node.strokeWeight;
  if (node.cornerRadius !== undefined) out.cornerRadius = node.cornerRadius;
  // Mask semantics — without these the mapper can't lower a Figma mask group
  // (RC2: `mask` channel). REST carries `isMask` / `maskType` on the node.
  if (node.isMask !== undefined) out.isMask = node.isMask;
  if (node.maskType !== undefined) out.maskType = node.maskType;
  if (node.booleanOperation !== undefined) out.booleanOperation = node.booleanOperation;
  // REST exposes flattened geometry as `fillGeometry[].path` ; the mapper reads
  // `fillGeometry[].data`. Rename the field, keep winding rule.
  if (node.fillGeometry) {
    out.fillGeometry = node.fillGeometry.map((g) => ({ data: g.path, windingRule: g.windingRule }));
    out.vectorPaths = out.fillGeometry;
  }
  if (node.characters !== undefined) out.characters = node.characters;
  if (node.style) {
    if (node.style.fontFamily) {
      out.fontName = {
        family: node.style.fontFamily,
        style: node.style.fontPostScriptName ?? "Regular",
      };
    }
    if (node.style.fontSize !== undefined) out.fontSize = node.style.fontSize;
    if (node.style.fontWeight !== undefined) out.fontWeight = node.style.fontWeight;
    if (node.style.textAlignHorizontal) out.textAlignHorizontal = node.style.textAlignHorizontal;
  }
  if (node.children) out.children = node.children.map(adaptNode);
  return out;
}

/** A lazily-resolving image handle compatible with the asset registry's
 *  `FigmaApiSurface`. `getBytesAsync` downloads the real bytes via the REST
 *  client (host-checked CDN). The bytes then flow through the registry's
 *  finalize() — the SAME raster-allowlist / SVG-sanitizer path used in the
 *  plugin export — so no asset bypasses the #N gate. */
export interface RestImageHandle {
  hash: string;
  getBytesAsync(): Promise<Uint8Array>;
}

export interface RestImageSurface {
  getImageByHash(hash: string): RestImageHandle | null;
}

/** Build a `getImageByHash` surface backed by REST. `imageMap` maps each
 *  `imageRef` (== the `imageHash` the adapter emitted) to a host-checked CDN
 *  URL. A hash absent from the map (Figma didn't render it) resolves to null —
 *  the registry then omits the referencing fill exactly as in the plugin path.
 *
 *  Bytes are cached per-hash so a hash referenced by multiple nodes downloads
 *  once. The download itself is deferred to `getBytesAsync` so the registry
 *  controls concurrency (Promise.all in finalize). */
export function createRestImageSurface(
  client: FigmaRestClient,
  imageMap: Record<string, string>,
): RestImageSurface {
  const cache = new Map<string, Promise<Uint8Array>>();
  return {
    getImageByHash(hash) {
      const url = imageMap[hash];
      if (typeof url !== "string" || url === "") return null;
      return {
        hash,
        getBytesAsync() {
          let p = cache.get(hash);
          if (!p) {
            p = client.getImageBytes(url);
            cache.set(hash, p);
          }
          return p;
        },
      };
    },
  };
}
