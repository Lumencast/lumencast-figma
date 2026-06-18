// Figma REST API response types — the minimal subset this module reads.
//
// These mirror the documented shape of `GET /v1/files/:key/nodes` and
// `GET /v1/files/:key/images`. The REST node JSON differs from the in-sandbox
// plugin `SceneNode` (e.g. `absoluteBoundingBox` vs `x/y/width/height`,
// `fills[].imageRef` vs `fills[].imageHash`, 0..1 RGBA colors) — the adapter
// (`adapter.ts`) normalizes REST → the main-thread shape `src/mapping` consumes.
//
// Only fields the mapper actually reads are typed ; unknown fields pass through
// `[k: string]: unknown` and are ignored. We deliberately do NOT depend on a
// third-party `@figma/rest-api-spec` package — the surface is small and pinning
// one extra dep would need an ADR (kept dep-free per ADR 002).

/** A 2-D color in Figma's 0..1 normalized space (REST + plugin share this). */
export interface RestColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A point on the Figma canvas in 0..1 object space (gradient handles). */
export interface RestVector {
  x: number;
  y: number;
}

export interface RestColorStop {
  position: number;
  color: RestColor;
}

/** A Figma REST paint. The discriminant `type` matches the plugin enum, but
 *  the field names differ: image paints carry `imageRef` (not `imageHash`),
 *  gradients carry `gradientHandlePositions` (not a `gradientTransform`
 *  matrix). The adapter rewrites these to the main-thread names. */
export interface RestPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE" | string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  /** SOLID. */
  color?: RestColor;
  /** GRADIENT_*. */
  gradientHandlePositions?: RestVector[];
  gradientStops?: RestColorStop[];
  /** IMAGE — content hash of the image fill ; resolved to bytes via the
   *  `images` map of `GET /v1/files/:key/images`. */
  imageRef?: string;
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE" | string;
}

export interface RestStroke {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: RestColor;
}

export interface RestRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RestVectorPath {
  windingRule: "NONZERO" | "EVENODD";
  path: string;
}

/** A Figma REST document node. Recursive via `children`. Fields beyond those
 *  the mapper reads are tolerated and ignored. */
export interface RestNode {
  id: string;
  name: string;
  type: string;
  /** Figma omits `visible` when true ; only emits `visible: false`. */
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  /** Absolute canvas-space box. The adapter derives `x/y/width/height` from
   *  this — REST has no relative `x/y`. */
  absoluteBoundingBox?: RestRect | null;
  fills?: RestPaint[];
  strokes?: RestStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
  fillGeometry?: RestVectorPath[];
  strokeGeometry?: RestVectorPath[];
  characters?: string;
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string | null;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: string;
    lineHeightPx?: number;
    letterSpacing?: number;
  };
  children?: RestNode[];
  [k: string]: unknown;
}

/** Envelope of `GET /v1/files/:key/nodes?ids=...`. */
export interface RestNodesResponse {
  name?: string;
  nodes: Record<
    string,
    {
      document: RestNode;
      [k: string]: unknown;
    }
  >;
}

/** Envelope of `GET /v1/files/:key/images` (imageRef → CDN URL). */
export interface RestImagesResponse {
  error?: boolean;
  status?: number;
  meta?: {
    images: Record<string, string>;
  };
}
