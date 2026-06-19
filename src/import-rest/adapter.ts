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

/** Coord-system container types : a FRAME/COMPONENT/INSTANCE/SECTION redefines
 *  the coordinate origin for its descendants (a GROUP/BOOLEAN_OPERATION does
 *  NOT — its children stay in the outer frame's coord system). MUST match
 *  `COORD_SYSTEM_TYPES` in `src/mapping/traverse.ts`. */
const COORD_SYSTEM_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "INSTANCE",
  "SECTION",
  "COMPONENT_SET",
]);

/** Adapt a REST node subtree to the main-thread shape `src/mapping` consumes.
 *  Sizes, hierarchy, and `visible` are preserved exactly.
 *
 *  Position : REST exposes `absoluteBoundingBox` (frame-absolute), but the
 *  mapper (`src/mapping`) expects the PLUGIN convention — `x/y` relative to the
 *  closest coord-system (FRAME) ancestor — and subtracts the LSML-parent origin
 *  itself. So we convert here : subtract the nearest FRAME ancestor's absolute
 *  origin. Without this, nested frames carried absolute coords that the runtime
 *  re-accumulated through every containing block (logo landed ~1100px too low).
 *  `coordOrigin` is the absolute origin of that ancestor (root = 0,0). */
export function adaptNode(node: RestNode, coordOrigin: { x: number; y: number } = { x: 0, y: 0 }): AdaptedNode {
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
  // A transparent GROUP/BOOLEAN is NOT a rendered box : its rotation/mirror is
  // already baked into every descendant's `absoluteBoundingBox` (= our AABB
  // positions). Emitting it on the group frame too would DOUBLE-apply the
  // transform on top of those final positions — fine for a single rotation about
  // a shared centre (picto) but it drifts for nested mirrors about different
  // centres (texture tiles). So a group carries NO transform of its own ; its
  // matrix flows down the `groupChainTransform` chain and `extractUniversal`
  // decomposes the NET rotation/mirror onto each LEAF, about the leaf's own
  // centre, leaving the AABB position untouched. Net texture = identity (the two
  // mirrors cancel → tiles upright) ; net picto = 8.63° (the square tilts).
  const isTransparentGroup = node.type === "GROUP" || node.type === "BOOLEAN_OPERATION";
  // REST `rotation` is in RADIANS ; the mapper + LSML §5.4 use DEGREES (the
  // plugin's `node.rotation` is degrees) — convert (the picto's ~8.6° tilt).
  if (node.rotation !== undefined && !isTransparentGroup) {
    out.rotation = (node.rotation * 180) / Math.PI;
  }
  // A negative `relativeTransform` determinant means the node is MIRRORED ; carry
  // the flip — but only on real leaves (groups bake it into descendant AABBs and
  // pass it down the chain instead).
  const rt = (node as { relativeTransform?: number[][] }).relativeTransform;
  const r0 = rt?.[0];
  const r1 = rt?.[1];
  if (rt && r0 && r1 && r0.length >= 2 && r1.length >= 2) {
    // Matrix rows [[a c e],[b d f]] ; `?? 0` only satisfies noUncheckedIndexedAccess
    // (the length guard already proved a/b/c/d exist — a real 0 is preserved by `??`).
    const a = r0[0] ?? 0;
    const c = r0[1] ?? 0;
    const b = r1[0] ?? 0;
    const d = r1[1] ?? 0;
    const det = a * d - c * b;
    if (det < 0 && !isTransparentGroup) (out as { flipY?: boolean }).flipY = true;
    // Pass the local matrix so the mapper can compose the transparent-GROUP
    // chain (`groupChainTransform`) and decompose its NET onto each leaf.
    (out as { relativeTransform?: number[][] }).relativeTransform = rt;
    // Carry the LOCAL translation (origin in the parent's un-rotated space) when
    // present — the mapper uses it to place an image mask EXACTLY relative to a
    // sibling. AABB positions fold in rotation + AABB inflation and drift.
    if (r0.length >= 3 && r1.length >= 3) {
      (out as { relTranslation?: { x: number; y: number } }).relTranslation = {
        x: r0[2] ?? 0,
        y: r1[2] ?? 0,
      };
    }
  }
  if (node.blendMode !== undefined) out.blendMode = node.blendMode;
  // LAYER_BLUR → CSS `filter: blur()`. Without it the bg-shine glows render as
  // SHARP solid circles (130px-blurred in Figma) and, under the additive blend,
  // blow out the whole corner. Carry the radius through.
  const effects = (
    node as {
      effects?: {
        type?: string;
        visible?: boolean;
        radius?: number;
        color?: { r: number; g: number; b: number; a: number };
        offset?: { x: number; y: number };
        spread?: number;
      }[];
    }
  ).effects;
  const layerBlur = effects?.find((e) => e.type === "LAYER_BLUR" && e.visible !== false);
  if (layerBlur && typeof layerBlur.radius === "number" && layerBlur.radius > 0) {
    (out as { blur?: number }).blur = layerBlur.radius;
  }
  // DROP_SHADOW / INNER_SHADOW → structured shadow specs (the picto square's
  // depth + its orange/red inner rim were dropped — no shadow support). Colour
  // is emitted as a validated-on-render rgba() string ; geometry as numbers.
  const shadows = effects?.filter(
    (e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false,
  );
  if (shadows && shadows.length > 0) {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    (out as { shadow?: unknown[] }).shadow = shadows.map((e) => {
      const c = e.color;
      const color = c
        ? `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r3(c.a)})`
        : "rgba(0,0,0,0)";
      return {
        inset: e.type === "INNER_SHADOW",
        color,
        x: r3(e.offset?.x ?? 0),
        y: r3(e.offset?.y ?? 0),
        blur: r3(e.radius ?? 0),
        spread: r3(e.spread ?? 0),
      };
    });
  }
  let originX = box ? box.x : coordOrigin.x;
  let originY = box ? box.y : coordOrigin.y;
  if (box) {
    // `absoluteBoundingBox` is the AABB (post-rotation) ; the node's own `size`
    // is the UNROTATED box. In a rotated context the AABB is larger AND its
    // top-left is offset — but rotation PRESERVES the centre. Size from `size`
    // and anchor on the AABB centre. For a node with no rotation in its chain
    // `size == AABB` → no-op (logo/pills untouched).
    const sz = (node as { size?: { x?: number; y?: number } }).size;
    const w = typeof sz?.x === "number" ? sz.x : box.width;
    const h = typeof sz?.y === "number" ? sz.y : box.height;
    originX = box.x + box.width / 2 - w / 2;
    originY = box.y + box.height / 2 - h / 2;
    out.x = originX - coordOrigin.x;
    out.y = originY - coordOrigin.y;
    out.width = w;
    out.height = h;
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
    // REST exposes letterSpacing/lineHeight as flat fields ; the mapper expects
    // the plugin's discriminated-union shape ({ unit, value }). Without this the
    // 2.88px tracking on the BRANDING/Wellplayed text was dropped → letters
    // packed tight → the whole run drifted left (the "doubled text" diff).
    if (typeof node.style.letterSpacing === "number") {
      out.letterSpacing = { unit: "PIXELS", value: node.style.letterSpacing };
    }
    // REST line-height fields aren't on the narrow inline TypeStyle — read them
    // off a local widening cast.
    const ts = node.style as {
      lineHeightUnit?: string;
      lineHeightPx?: number;
      lineHeightPercentFontSize?: number;
    };
    if (ts.lineHeightUnit === "PIXELS" && typeof ts.lineHeightPx === "number") {
      out.lineHeight = { unit: "PIXELS", value: ts.lineHeightPx };
    } else if (
      (ts.lineHeightUnit === "FONT_SIZE_%" || ts.lineHeightUnit === "INTRINSIC_%") &&
      typeof ts.lineHeightPercentFontSize === "number"
    ) {
      out.lineHeight = { unit: "PERCENT", value: ts.lineHeightPercentFontSize };
    }
  }
  // Children's coord origin : a coord-system container (FRAME/etc.) redefines
  // the origin to its own absolute box ; a transparent GROUP/BOOLEAN keeps the
  // outer frame's origin (matches the mapper's transparent-group handling).
  const childOrigin =
    COORD_SYSTEM_TYPES.has(node.type) && box ? { x: originX, y: originY } : coordOrigin;
  if (node.children) out.children = node.children.map((c) => adaptNode(c, childOrigin));
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
