// Structural-diff checker (ADR ZabCanvas 002 RC2 — "diff structurel NUL").
//
// Compares the Figma REST tree (the ground truth) against the LSML 1.2 bundle
// `importFigmaFrame` produces, and emits EVERY divergence. Zero divergences =
// the structural-diff=0 invariant holds. The checker is the instrument that
// drives the adapter/mapper fixes and is reused by the final-proof harness
// (#67): give it the REST root (`client.getNode`) and the bundle layout, and it
// returns a typed list of mismatches.
//
// ── How the two trees are walked ───────────────────────────────────────────
// REST and LSML carry the SAME source order (the mapper preserves child order),
// so we walk them in PARALLEL by child index. A few LSML constructs change the
// node count relative to REST — the walker accounts for them so a legitimate
// 1:1 structural mapping reports clean:
//
//   * image masks are CONSUMED — a REST `isMask` node with a visible IMAGE fill
//     becomes a `mask:{source:{kind:"image"}}` on its following siblings and is
//     dropped from the LSML children. The walker skips such a REST node and
//     records the expected mask on the next sibling instead.
//
// ── Position space ─────────────────────────────────────────────────────────
// REST positions are ABSOLUTE (`absoluteBoundingBox`). The LSML `position` is
// absolute under a COORD-SYSTEM parent (FRAME / COMPONENT / INSTANCE / SECTION)
// but PARENT-RELATIVE under a transparent GROUP / BOOLEAN_OPERATION — mirroring
// the mapper's coord-system rule (traverse.ts `COORD_SYSTEM_TYPES`). The walker
// carries the LSML parent's absolute origin and adds it back ONLY when the
// parent is a group, recovering an absolute position to compare against REST.
//
// ── Text content ───────────────────────────────────────────────────────────
// LSML text content is carried by a literal bind (`bind.value = "__lit…"`)
// resolved through the bundle `defaults` map, not an inline `characters` field.
// The checker resolves it via the `defaults` passed in `DiffOptions`.
//
// ── What is checked (per node) ─────────────────────────────────────────────
//   - presence / hierarchy: a REST node with no LSML counterpart (or vice
//     versa), or a differing nesting depth → `missing` / `extra`.
//   - position x/y and size w/h (tolerance ~0.5px) → `position` / `size`.
//   - visibility (`visible:false`) → `visibility`.
//   - mask: a REST `isMask` node whose mask is absent in LSML → `mask`.
//   - image fill: a REST IMAGE paint absent/converted in LSML → `image-fill`.
//   - blend mode, gradient, stroke present in REST but absent in LSML.
//   - text characters / font family, vector geometry presence.
//
// The checker is deliberately TOLERANT of extra LSML metadata: it only flags a
// REST property that FAILED to round-trip, never an LSML-only enrichment.

import type { RestNode, RestPaint } from "./types";

export type DiffKind =
  | "missing" // REST node has no LSML counterpart
  | "extra" // LSML node has no REST counterpart
  | "type" // primitive kind/category disagrees
  | "position" // x/y differ beyond tolerance
  | "size" // w/h differ beyond tolerance
  | "visibility" // visible flag differs
  | "mask" // REST isMask node's mask not represented in LSML
  | "image-fill" // REST IMAGE paint not represented in LSML
  | "blend" // REST blendMode not represented in LSML
  | "gradient" // REST gradient paint not represented in LSML
  | "stroke" // REST stroke not represented in LSML
  | "text" // characters / font family differ
  | "geometry"; // vector path present in REST, absent in LSML

export interface Divergence {
  kind: DiffKind;
  /** Figma node id the divergence is anchored on. */
  figmaId: string;
  /** Source layer name (REST) for human triage. */
  name: string;
  /** Dotted path of child indices from the root (e.g. "root.1.0"). */
  path: string;
  expected: unknown;
  actual: unknown;
  note?: string;
}

/** A minimal structural view of an LSML 1.2 layout node — the fields the diff
 *  reads. The bundle's nodes carry more (binds, styles…) which we ignore. */
export interface LsmlNode {
  kind: string;
  size?: { w: number; h: number };
  position?: { x: number; y: number };
  visible?: boolean;
  blendMode?: string;
  mask?: unknown;
  fills?: { kind?: string }[];
  backgrounds?: { kind?: string }[];
  strokes?: unknown[];
  geometry?: string;
  /** Path geometry payload (LSML 1.1 §4.6). One of `pathData` (single subpath)
   *  or `paths[]` (multi-subpath) carries the actual outline. An empty/absent
   *  pair on a `geometry:"path"` node means the vector lowered with NO geometry
   *  — it renders as its bounding box (RC4 fidelity defect). */
  pathData?: string;
  paths?: { data?: string }[];
  characters?: string;
  bind?: { src?: string; value?: string };
  metadata?: { figma?: { layerName?: string } };
  children?: LsmlNode[];
}

export interface DiffOptions {
  /** Position/size tolerance in px. Default 0.5 (sub-pixel rounding). */
  tolerancePx?: number;
  /** Bundle `defaults` map — resolves text/image literal binds (`__lit…`). */
  defaults?: Record<string, unknown>;
}

const DEFAULT_TOLERANCE = 0.5;

/** True for REST blend modes that actually composite (not the no-ops). */
function isRealBlend(mode: string | undefined): mode is string {
  return typeof mode === "string" && mode !== "PASS_THROUGH" && mode !== "NORMAL";
}

function visibleImageRefs(paints: RestPaint[] | undefined): RestPaint[] {
  if (!paints) return [];
  return paints.filter(
    (p) => p.type === "IMAGE" && p.visible !== false && typeof p.imageRef === "string",
  );
}

function gradientPaints(paints: RestPaint[] | undefined): RestPaint[] {
  if (!paints) return [];
  return paints.filter((p) => p.visible !== false && String(p.type).startsWith("GRADIENT"));
}

/** Every kind of image carrier on an LSML node: a standalone `image`
 *  primitive, an `image` fill, an image background, or an image mask. */
function lsmlHasImage(node: LsmlNode): boolean {
  if (node.kind === "image") return true;
  if (node.fills?.some((f) => f.kind === "image")) return true;
  if (node.backgrounds?.some((b) => b.kind === "image")) return true;
  return false;
}

function lsmlHasGradient(node: LsmlNode): boolean {
  const grad = (k?: string) => typeof k === "string" && k.endsWith("-gradient");
  if (node.fills?.some((f) => grad(f.kind))) return true;
  if (node.backgrounds?.some((b) => grad(b.kind))) return true;
  return false;
}

/** REST `absoluteBoundingBox` → absolute box, or null when the node has none
 *  (some GROUP/abstract nodes). */
function restBox(node: RestNode): { x: number; y: number; w: number; h: number } | null {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/**
 * Walk REST and LSML in parallel and collect divergences.
 *
 * @param restRoot  the REST document node (`client.getNode(...)`).
 * @param lsmlRoot  the LSML bundle's `layout` root.
 */
export function structuralDiff(
  restRoot: RestNode,
  lsmlRoot: LsmlNode,
  opts: DiffOptions = {},
): Divergence[] {
  const tol = opts.tolerancePx ?? DEFAULT_TOLERANCE;
  const defaults = opts.defaults ?? {};
  const out: Divergence[] = [];

  // Compare one REST node against its LSML counterpart. `originX/Y` is the
  // absolute origin to add to a GROUP-relative `lsml.position` (0 when the LSML
  // parent is a coord-system frame whose children are already absolute).
  // `expectMask` is true when a preceding `isMask` sibling should have stamped a
  // mask on this node (image-mask channel).
  function compare(
    rest: RestNode,
    lsml: LsmlNode | undefined,
    path: string,
    originX: number,
    originY: number,
    expectMask: boolean,
  ): void {
    const name = rest.name ?? "";
    if (!lsml) {
      out.push({
        kind: "missing",
        figmaId: rest.id,
        name,
        path,
        expected: rest.type,
        actual: undefined,
        note: "REST node has no LSML counterpart",
      });
      return;
    }

    const box = restBox(rest);
    const absX = originX + (lsml.position?.x ?? 0);
    const absY = originY + (lsml.position?.y ?? 0);

    // Position (absolute).
    if (box) {
      if (Math.abs(box.x - absX) > tol || Math.abs(box.y - absY) > tol) {
        out.push({
          kind: "position",
          figmaId: rest.id,
          name,
          path,
          expected: { x: round(box.x), y: round(box.y) },
          actual: { x: round(absX), y: round(absY) },
        });
      }
      // Size.
      const lw = lsml.size?.w ?? NaN;
      const lh = lsml.size?.h ?? NaN;
      if (Math.abs(box.w - lw) > tol || Math.abs(box.h - lh) > tol) {
        out.push({
          kind: "size",
          figmaId: rest.id,
          name,
          path,
          expected: { w: round(box.w), h: round(box.h) },
          actual: { w: round(lw), h: round(lh) },
        });
      }
    }

    // Visibility — REST omits `visible` when true.
    const restVisible = rest.visible !== false;
    const lsmlVisible = lsml.visible !== false;
    if (restVisible !== lsmlVisible) {
      out.push({
        kind: "visibility",
        figmaId: rest.id,
        name,
        path,
        expected: restVisible,
        actual: lsmlVisible,
      });
    }

    // Mask — a preceding `isMask` sibling must show up as a `mask` here.
    if (expectMask && lsml.mask === undefined) {
      out.push({
        kind: "mask",
        figmaId: rest.id,
        name,
        path,
        expected: "mask (from isMask sibling)",
        actual: undefined,
        note: "Figma mask group not represented in LSML",
      });
    }

    // Image fill — a REST IMAGE paint must survive as some image carrier.
    if (visibleImageRefs(rest.fills).length > 0 && !lsmlHasImage(lsml)) {
      out.push({
        kind: "image-fill",
        figmaId: rest.id,
        name,
        path,
        expected: "image fill (imageRef)",
        actual: lsml.kind,
        note: "REST IMAGE paint dropped or converted to a non-image fill",
      });
    }

    // Gradient.
    if (gradientPaints(rest.fills).length > 0 && !lsmlHasGradient(lsml)) {
      out.push({
        kind: "gradient",
        figmaId: rest.id,
        name,
        path,
        expected: "gradient fill",
        actual: lsml.kind,
      });
    }

    // Blend mode.
    if (isRealBlend(rest.blendMode) && lsml.blendMode === undefined && !maskConsumed(lsml)) {
      out.push({
        kind: "blend",
        figmaId: rest.id,
        name,
        path,
        expected: rest.blendMode,
        actual: undefined,
        note: "REST blendMode not represented (may be stashed in metadata for image nodes)",
      });
    }

    // Stroke.
    if (
      Array.isArray(rest.strokes) &&
      rest.strokes.length > 0 &&
      (!Array.isArray(lsml.strokes) || lsml.strokes.length === 0)
    ) {
      out.push({
        kind: "stroke",
        figmaId: rest.id,
        name,
        path,
        expected: `${rest.strokes.length} stroke(s)`,
        actual: lsml.strokes?.length ?? 0,
      });
    }

    // Text — content is on `characters` or resolved from a literal bind via
    // the bundle `defaults` map (`bind.value = "__lit…"`).
    if (typeof rest.characters === "string" && rest.characters !== "") {
      const lsmlText = resolveText(lsml);
      if (lsmlText !== rest.characters) {
        out.push({
          kind: "text",
          figmaId: rest.id,
          name,
          path,
          expected: rest.characters,
          actual: lsmlText,
        });
      }
    }

    // Vector geometry presence AND CONTENT (path-based shapes).
    //
    // RC4 blind-spot fix : a REST node carrying `fillGeometry` must lower to a
    // `geometry:"path"` shape whose path payload is actually PRESENT. The prior
    // check only asserted the `geometry:"path"` discriminator — a node with the
    // right discriminator but an EMPTY `pathData`/`paths[]` slipped through as
    // "diff=0" while rendering as its bounding box. We now also require a
    // non-empty outline, so "diff=0" genuinely means geometry fidelity.
    if (Array.isArray(rest.fillGeometry) && rest.fillGeometry.length > 0 && lsml.kind === "shape") {
      if (lsml.geometry !== "path") {
        out.push({
          kind: "geometry",
          figmaId: rest.id,
          name,
          path,
          expected: "geometry: path",
          actual: lsml.geometry ?? lsml.kind,
        });
      } else if (!lsmlHasPathContent(lsml)) {
        out.push({
          kind: "geometry",
          figmaId: rest.id,
          name,
          path,
          expected: `non-empty path (REST fillGeometry has ${rest.fillGeometry.length} subpath(s))`,
          actual: "empty pathData / paths[] (renders as bounding box)",
          note: "VECTOR lowered with geometry:path but NO outline — fidelity defect",
        });
      }
    }

    // Recurse. Children of a transparent GROUP / BOOLEAN_OPERATION store their
    // LSML position RELATIVE to this node's absolute origin; children of a
    // coord-system frame store absolute positions (origin 0).
    const childIsRelative = rest.type === "GROUP" || rest.type === "BOOLEAN_OPERATION";
    const childOriginX = childIsRelative ? absX : 0;
    const childOriginY = childIsRelative ? absY : 0;
    walkChildren(rest, lsml, path, childOriginX, childOriginY);
  }

  function resolveText(lsml: LsmlNode): string | undefined {
    if (typeof lsml.characters === "string") return lsml.characters;
    const ref = lsml.bind?.value;
    if (typeof ref === "string") {
      const v = defaults[ref];
      if (typeof v === "string") return v;
    }
    return undefined;
  }

  function walkChildren(
    rest: RestNode,
    lsml: LsmlNode,
    path: string,
    originX: number,
    originY: number,
  ): void {
    const restKids = rest.children ?? [];
    const lsmlKids = lsml.children ?? [];

    // An image-mask node (isMask + a visible IMAGE fill) is CONSUMED by the
    // mapper: it becomes a `mask` on its following siblings and is removed from
    // the LSML children. Whether the bundle actually consumed it is observable
    // from the child-count delta — if no node was consumed (the count matches),
    // the mask node still occupies an LSML slot AND the mask is missing on its
    // followers (both reported). This keeps index alignment correct in both the
    // pre-fix (mask dropped, nothing consumed) and post-fix (mask consumed)
    // states, so positions don't cascade into false mismatches.
    const restImageMasks = restKids.filter(
      (k) => k.isMask === true && visibleImageRefs(k.fills).length > 0,
    ).length;
    const consumeMasks = restKids.length - lsmlKids.length >= restImageMasks && restImageMasks > 0;

    let li = 0;
    let pendingMask = false;

    for (let ri = 0; ri < restKids.length; ri++) {
      const rk = restKids[ri]!;
      const isMaskNode = rk.isMask === true;
      const isImageMask = isMaskNode && visibleImageRefs(rk.fills).length > 0;

      if (isImageMask && consumeMasks) {
        // Consumed: no LSML slot; the mask is expected on the next sibling.
        pendingMask = true;
        continue;
      }

      const lk = lsmlKids[li];
      compare(rk, lk, `${path}.${ri}`, originX, originY, pendingMask);
      li++;
      // Figma masking: an isMask node masks ALL following siblings until the
      // next isMask. So `pendingMask` stays set for every follower once a mask
      // is active (the mask node itself isn't a "follower"). It only flips on
      // encountering a new isMask node.
      if (isMaskNode) pendingMask = true;
    }

    // Any leftover LSML children with no REST source.
    for (; li < lsmlKids.length; li++) {
      const lk = lsmlKids[li]!;
      out.push({
        kind: "extra",
        figmaId: lk.metadata?.figma?.layerName ?? `<lsml#${li}>`,
        name: lk.metadata?.figma?.layerName ?? lk.kind,
        path: `${path}.+${li}`,
        expected: undefined,
        actual: lk.kind,
        note: "LSML node has no REST counterpart",
      });
    }
  }

  // The root frame's children are absolute (coord-system), so origin = 0.
  compare(restRoot, lsmlRoot, "root", 0, 0, false);
  return out;
}

/** True when a `geometry:"path"` LSML node actually carries a renderable
 *  outline — a non-empty `pathData` string OR a `paths[]` with at least one
 *  entry whose `data` is non-empty. An empty pair means the vector lowered with
 *  no geometry and would paint as its bounding box (RC4). */
function lsmlHasPathContent(node: LsmlNode): boolean {
  if (typeof node.pathData === "string" && node.pathData.trim().length > 0) return true;
  if (Array.isArray(node.paths)) {
    return node.paths.some((p) => typeof p?.data === "string" && p.data.trim().length > 0);
  }
  return false;
}

/** An LSML node carrying a mask is the masked subject; its own blend may have
 *  been folded into the mask compositing — don't double-report blend on it. */
function maskConsumed(node: LsmlNode): boolean {
  return node.mask !== undefined;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Group divergences by kind for a compact summary line. */
export function summarizeDiff(divs: Divergence[]): Record<DiffKind, number> {
  const acc = {} as Record<DiffKind, number>;
  for (const d of divs) acc[d.kind] = (acc[d.kind] ?? 0) + 1;
  return acc;
}
