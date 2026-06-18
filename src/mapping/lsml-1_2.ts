// LSML 1.2 transcription helpers (ADR 002 §3.2 / §3.3).
//
// The four zero-loss families that 1.1 could only stash in `metadata.figma.*`
// are lowered here into core, rendable 1.2 constructs :
//   - `blendMode`     — Figma `node.blendMode` → CSS `mix-blend-mode` enum.
//   - `mask`          — a Figma mask layer → typed `LSMLMask` (never SVG text).
//   - image-fill      — a Figma `ImagePaint` → `{ kind: "image"; src; objectFit }`.
//   - gradient transform — a Figma 2×3 paint matrix → the 6-float SVG form.
//
// These are pure mappers : closed allowlists, omit-on-miss (Bastion T4),
// no value echoed. The host/scheme allowlist gate on image-fill `src` /
// `mask.source`-image `src` lives DOWNSTREAM (compiler + runtime,
// `host-allow.ts`) — the mapper only emits the typed fields and a coherent
// `assets.allowedHosts` (Bastion T6).

import type { BlendMode, GradientTransform, ImageFill, ObjectFit } from "~shared/lsml-types";
import { asNumber, asString } from "./figma-mixed";

/** Figma `BlendMode` (uppercase, host enum) → LSML `mix-blend-mode` keyword.
 *  Closed map ; `PASS_THROUGH` and `NORMAL` (the no-ops) and any unknown
 *  value return null so the caller omits the field (T4). Figma exposes a few
 *  modes CSS has no exact keyword for (`LINEAR_BURN`, `LINEAR_DODGE`) — those
 *  fold to their nearest CSS equivalent (`color-burn` / `color-dodge`), which
 *  is how Figma itself renders them in non-Figma contexts. */
const FIGMA_BLEND_TO_CSS: Record<string, BlendMode> = {
  MULTIPLY: "multiply",
  SCREEN: "screen",
  OVERLAY: "overlay",
  DARKEN: "darken",
  LIGHTEN: "lighten",
  COLOR_DODGE: "color-dodge",
  LINEAR_DODGE: "color-dodge",
  COLOR_BURN: "color-burn",
  LINEAR_BURN: "color-burn",
  HARD_LIGHT: "hard-light",
  SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
};

/** Map a raw Figma `node.blendMode` to a 1.2 `blendMode` keyword, or null
 *  when it should be omitted (`PASS_THROUGH` / `NORMAL` / unknown). */
export function mapBlendMode(raw: unknown): BlendMode | null {
  const s = asString(raw);
  if (!s || s === "PASS_THROUGH" || s === "NORMAL") return null;
  return FIGMA_BLEND_TO_CSS[s] ?? null;
}

/** Figma `maskType` → LSML mask channel. `ALPHA` and `LUMINANCE` map
 *  directly ; Figma's `VECTOR` / `OUTLINE` masks are geometric (the mask
 *  shape's path), which we read as an alpha mask of the shape coverage. */
export function mapMaskType(raw: unknown): "alpha" | "luminance" {
  const s = asString(raw);
  return s === "LUMINANCE" ? "luminance" : "alpha";
}

/** Sanitise a Figma node id to the safe SVG-id token class the runtime ref
 *  resolver accepts (`mask.tsx` `safeIdRef`, `[A-Za-z0-9_:-]+`). A Figma id
 *  like `817:1991` is already within the class (the `:` is allowed), so it is
 *  preserved verbatim. A character outside the class (defensive : Figma ids are
 *  numeric+`:`, but a synthetic/mock id could differ) → null, no id emitted. */
export function safeIdRef(figmaNodeId: string): string | null {
  return /^[A-Za-z0-9_:-]+$/.test(figmaNodeId) ? figmaNodeId : null;
}

/** Deterministic, stable, unique `id` for a shape primitive referenced by a
 *  shape-source mask (ADR 002 A2.1 #K) : `"fig-" + safeIdRef(figmaNodeId)`.
 *  Same frame → same id every run ; distinct Figma nodes → distinct ids (the
 *  Figma id is unique by construction). Returns null when the source id is not
 *  a safe token (the mask then stays unlowered, no broken ref emitted). */
export function stableShapeId(figmaNodeId: string): string | null {
  const safe = safeIdRef(figmaNodeId);
  return safe === null ? null : `fig-${safe}`;
}

/** Figma image `scaleMode` → CSS `object-fit`. Closed map ; an unknown mode
 *  returns null so the caller omits `objectFit` (CSS default `fill` applies).
 *  `CROP` is a panned/zoomed cover in Figma → `cover`. `TILE` has no
 *  object-fit equivalent (it's a repeat) — omitted ; the raw mode stays in
 *  `metadata.figma.imagePaint.scaleMode` for round-trip. */
export function mapScaleModeToObjectFit(raw: unknown): ObjectFit | null {
  switch (asString(raw)) {
    case "FILL":
      return "cover";
    case "FIT":
      return "contain";
    case "CROP":
      return "cover";
    default:
      return null;
  }
}

/** Minimal Figma `ImagePaint` surface needed to build a 1.2 image-fill. */
export interface FigmaImagePaintLike {
  type?: string;
  imageHash?: string | null;
  scaleMode?: unknown;
  opacity?: unknown;
  visible?: unknown;
  /** Per-paint blend mode (#L, LSML 1.2 §4.3). */
  blendMode?: unknown;
}

/** Lower a Figma `ImagePaint` to a 1.2 `{ kind:"image" }` fill (LSML 1.2
 *  §4.1). The `src` is resolved by `registerSrc(hash)` to a gated AssetUrl —
 *  a `data:image/*;base64` URI in this mapper (host-less, T6-coherent).
 *  `objectFit` comes from the Figma `scaleMode` (closed enum, omit-on-miss,
 *  T4). Returns null for an invisible paint or one with no usable image hash. */
export function imagePaintToFill(
  paint: FigmaImagePaintLike,
  registerSrc: (hash: string) => string,
): ImageFill | null {
  if (paint.type !== "IMAGE") return null;
  if (paint.visible === false) return null;
  const hash = paint.imageHash;
  if (typeof hash !== "string" || hash === "") return null;
  const src = registerSrc(hash);
  const fill: ImageFill = { kind: "image", src };
  const objectFit = mapScaleModeToObjectFit(paint.scaleMode);
  if (objectFit) fill.objectFit = objectFit;
  const opacity = asNumber(paint.opacity);
  if (opacity !== undefined && opacity !== 1) fill.opacity = opacity;
  // #L (LSML 1.2 §4.3) — per-paint blend, mapped through the same closed table
  // as the node-level blend. A no-op / unknown mode omits the field.
  const blendMode = mapBlendMode(paint.blendMode);
  if (blendMode) fill.blendMode = blendMode;
  return fill;
}

/** Convert a Figma 2×3 affine matrix into the 6-float SVG `gradientTransform`
 *  form `[a, b, c, d, e, f]` (LSML 1.2 §4.2).
 *
 *  Figma stores the matrix row-major as `[[r0c0, r0c1, r0c2], [r1c0, r1c1,
 *  r1c2]]`, i.e. `[[a, c, e], [b, d, f]]` in SVG terms. SVG `matrix(a, b, c,
 *  d, e, f)` is column-major, so the flat 6-tuple is
 *  `[r0c0, r1c0, r0c1, r1c1, r0c2, r1c2]`.
 *
 *  Returns null when the matrix is absent, malformed, the identity (no
 *  transform to carry), or carries a non-finite component (T4 : a malformed
 *  transform is dropped, never emitted as a free value). */
export function matrixToGradientTransform(
  t: number[][] | null | undefined,
): GradientTransform | null {
  if (!t || t.length !== 2) return null;
  const r0 = t[0];
  const r1 = t[1];
  if (!r0 || !r1 || r0.length !== 3 || r1.length !== 3) return null;
  const a = r0[0];
  const c = r0[1];
  const e = r0[2];
  const b = r1[0];
  const d = r1[1];
  const f = r1[2];
  for (const v of [a, b, c, d, e, f]) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
  }
  const tuple: GradientTransform = [
    a as number,
    b as number,
    c as number,
    d as number,
    e as number,
    f as number,
  ];
  // The identity carries no information — omit it so plain authored
  // gradients keep `angle_deg` alone (non-regression) and don't gain a
  // redundant `transform` field.
  if (isIdentity(tuple)) return null;
  return tuple;
}

function isIdentity(t: GradientTransform): boolean {
  return t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && t[4] === 0 && t[5] === 0;
}

/** True when a primitive node (or any descendant) carries a 1.2 construct :
 *  a `blendMode`, a `mask`, an image-fill in `fills`/`backgrounds`, or a
 *  gradient `transform`. Drives the conditional `lsml: "1.2"` version bump —
 *  a layout with none of these stays `lsml: "1.1"`, byte-identical to before. */
export function layoutUsesLsml12(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => layoutUsesLsml12(n));
  const obj = node as Record<string, unknown>;
  if (obj["blendMode"] !== undefined) return true;
  if (obj["mask"] !== undefined) return true;
  // `fills[]` / `backgrounds[]` : any image-fill discriminant, or a gradient
  // carrying a 1.2 `transform`, makes the bundle 1.2.
  if (fillArrayUses12(obj["fills"]) || fillArrayUses12(obj["backgrounds"])) return true;
  for (const key of Object.keys(obj)) {
    // Don't descend into the `metadata` channel — its `figma.*` stash may
    // legitimately hold uppercase Figma blend names etc. that are NOT 1.2
    // core fields.
    if (key === "metadata") continue;
    if (layoutUsesLsml12(obj[key])) return true;
  }
  return false;
}

function fillArrayUses12(fills: unknown): boolean {
  if (!Array.isArray(fills)) return false;
  for (const f of fills) {
    if (f === null || typeof f !== "object") continue;
    const fo = f as Record<string, unknown>;
    if (fo["kind"] === "image") return true;
    if (
      (fo["kind"] === "linear-gradient" || fo["kind"] === "radial-gradient") &&
      Array.isArray(fo["transform"])
    ) {
      return true;
    }
  }
  return false;
}
