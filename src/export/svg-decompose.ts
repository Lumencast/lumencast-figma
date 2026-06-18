// SVG-asset geometry decomposition — Niveau 1 (ADR 002 Amendment 3 #M).
//
// An SVG-as-asset is an IMAGE paint whose bytes are SVG. The PREFERRED handling
// (A3.2) is to NOT keep it as an image at all: a purely geometric SVG
// (paths / rect / circle / ellipse / polygon / line + flat/linear/radial fills)
// has no reason to be a raster — it is re-expressed as NATIVE LSML `shape`
// primitives (`geometry:"path"` + `paths[]`, §4.6). The output is TYPED
// geometry: zero SVG markup, zero `data:image/svg+xml`, zero `data:` URI, zero
// attack surface. The N2 sanitizer (`svg-sanitize.ts`) is the FALLBACK for the
// irreducible remainder only.
//
// Discipline (A3.4 invariant): decomposition is ALL-OR-NOTHING. If a SINGLE
// element / attribute is outside the decomposable set (text, filter, raster
// `<image>`, pattern, non-linear paint, foreign namespace, …) this module
// throws `DecomposeError` and the caller falls through to N2 — never a partial
// decomposition that would silently drop the rest.
//
// SECURITY: this module REUSES the audited zero-dep XML parser from
// `svg-sanitize.ts` (DTD/entity rejection §4, anti-DoS bounds §5) — there is
// exactly one SVG parser in the codebase. It produces ONLY typed LSML values
// (numbers re-parsed through the shared finite-clamp helpers, colours through
// the shared paint validator) — never a raw string passthrough, never SVG
// markup, never a brand that could reach the `data:image/svg+xml` emitter.

import type {
  Fill,
  GradientStop,
  GradientTransform,
  ShapePathEntry,
  ShapePrimitive,
} from "~shared/lsml-types";
import {
  bytesToString,
  clampFinite,
  fmt,
  isElement,
  parseXml,
  prefixOf,
  reemitPathData,
  reemitScalar,
  splitNumericArgs,
  validatePaintColor,
  type XmlElement,
} from "./svg-sanitize";

/** Thrown when the document carries ANYTHING outside the decomposable set.
 *  The caller catches this and falls through to N2 (`sanitizeSvg`). It is NOT
 *  an authoring error on its own — only the combined N1+N2 failure is (#N §7). */
export class DecomposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecomposeError";
  }
}

/** The result of decomposing one SVG asset: a flat list of native LSML shape
 *  primitives (in document/paint order, back-to-front) and the source viewBox
 *  so the caller can fit the shapes into the host image-fill's box. */
export interface DecomposedSvg {
  /** Native shapes in paint order (index 0 painted first / lowest). */
  shapes: ShapePrimitive[];
  /** Source coordinate box `[minX, minY, width, height]`. Defaults to the
   *  `width`/`height` attributes, or a unit box when neither is present. */
  viewBox: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// Decomposable element set. ANY element outside this set aborts decomposition
// (→ N2). Deliberately NARROWER than the N2 sanitizer allowlist: N1 only
// accepts what it can faithfully re-express as native geometry.
//   - text / tspan      → font-dependent glyphs, not vectorised → N2
//   - image             → embedded raster → N2
//   - filter / fe*      → effects not in LSML 1.2 → N2
//   - pattern           → tiling not expressible as a shape → N2
//   - use / symbol      → external/internal ref expansion → N2
//   - mask / clipPath   → coverage model beyond a flat shape → N2 (A3.2)
// ---------------------------------------------------------------------------

const GEOMETRY_ELEMENTS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);
const CONTAINER_ELEMENTS = new Set(["svg", "g"]);
const DEFS_ELEMENTS = new Set(["defs", "linearGradient", "radialGradient", "stop"]);
// Purely descriptive — ignored, never a reason to bail.
const IGNORABLE_ELEMENTS = new Set(["title", "desc", "metadata"]);

// Presentation attributes N1 understands on a geometry/group element. An
// attribute outside this set on a kept element aborts decomposition (it could
// change the render in a way native geometry would silently lose).
const KNOWN_GEOMETRY_ATTRS = new Set([
  // structural / identity
  "id",
  "transform",
  // paint
  "fill",
  "stroke",
  "stroke-width",
  "fill-rule",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  // per-element geometry
  "d",
  "x",
  "y",
  "width",
  "height",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  // root-only
  "viewBox",
  "xmlns",
  "version",
  "preserveAspectRatio",
  // stroke cosmetics that do not change geometry topology — tolerated, dropped
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
]);

// ---------------------------------------------------------------------------
// Inherited presentation context propagated down the tree (SVG inheritance).
// All values already validated/normalised through the shared #N helpers.
// ---------------------------------------------------------------------------

interface PaintContext {
  /** Composed 2×3 affine matrix from the root to the current element. */
  ctm: Matrix;
  fill?: string; // validated CSS colour OR `url(#id)` (resolved later) OR "none"
  stroke?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  opacity?: number; // group/element opacity, multiplied down
  fillRule?: "NONZERO" | "EVENODD";
}

/** A 2×3 affine matrix `[a, b, c, d, e, f]` mapping `(x,y) → (a·x+c·y+e,
 *  b·x+d·y+f)`. Used both to bake group transforms into path data and to emit
 *  the LSML gradient `transform`. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Decompose SVG bytes into native LSML shapes, or throw `DecomposeError` if
 *  the document is not entirely reducible to native geometry (→ caller N2). */
export function decomposeSvg(bytes: Uint8Array): DecomposedSvg {
  if (bytes.length === 0) throw new DecomposeError("empty SVG input");
  // REUSE the audited parser: DTD/entity rejection + anti-DoS bounds are shared
  // with N2. parseXml throws SanitizeError on a malformed / DTD document; we
  // translate that into a DecomposeError so the caller treats it as "N1 could
  // not decompose" (and N2 will independently reject it too).
  let root: XmlElement;
  try {
    root = parseXml(bytesToString(bytes));
  } catch (err) {
    throw new DecomposeError(`parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (prefixOf(root.name) !== null)
    throw new DecomposeError("root <svg> carries a namespace prefix");

  const gradients = new Map<string, XmlElement>();
  collectGradientDefs(root, gradients);

  const viewBox = readViewBox(root);
  const shapes: ShapePrimitive[] = [];
  const rootCtx: PaintContext = { ctm: IDENTITY, fill: "#000000" };
  walkGeometry(root, mergeContext(rootCtx, root), shapes, gradients);

  if (shapes.length === 0) {
    throw new DecomposeError("no geometry survived decomposition");
  }
  return { shapes, viewBox };
}

/** Fit a decomposed SVG's geometry onto a host box (object-fit: fill). The fit
 *  is `scale(box.w/vbW, box.h/vbH)` after `translate(-minX, -minY)`, BAKED into
 *  each shape's path data + gradient transform — all geometry math stays here.
 *  Returns a NEW `DecomposedSvg` with the host box as its viewBox extent. When
 *  `box` is null (host size unknown) the shapes are returned unchanged. A shape
 *  whose path cannot be re-transformed (it never should after decomposition)
 *  throws `DecomposeError`. */
export function fitDecomposedToBox(
  d: DecomposedSvg,
  box: { w: number; h: number } | null,
): DecomposedSvg {
  const [minX, minY, vbW, vbH] = d.viewBox;
  if (!box || vbW <= 0 || vbH <= 0) return d;
  const sx = box.w / vbW;
  const sy = box.h / vbH;
  if (sx === 1 && sy === 1 && minX === 0 && minY === 0) return d;
  // translate(-minX,-minY) then scale(sx,sy) → matrix [sx,0,0,sy,-minX·sx,-minY·sy].
  const fit: Matrix = [sx, 0, 0, sy, -minX * sx, -minY * sy];
  const shapes = d.shapes.map((shape) => fitShape(shape, fit));
  return { shapes, viewBox: [0, 0, box.w, box.h] };
}

function fitShape(shape: ShapePrimitive, fit: Matrix): ShapePrimitive {
  const out: ShapePrimitive = { ...shape };
  if (out.pathData !== undefined) {
    const baked = transformPathData(out.pathData, fit);
    if (baked === null) throw new DecomposeError("fit transform failed on pathData");
    out.pathData = baked;
  }
  if (out.paths) {
    out.paths = out.paths.map((p) => {
      const baked = transformPathData(p.data, fit);
      if (baked === null) throw new DecomposeError("fit transform failed on subpath");
      return p.windingRule ? { data: baked, windingRule: p.windingRule } : { data: baked };
    });
  }
  if (out.fills) {
    out.fills = out.fills.map((f) => fitFill(f, fit));
  }
  return out;
}

function fitFill(f: Fill, fit: Matrix): Fill {
  if (f.kind === "linear-gradient" || f.kind === "radial-gradient") {
    const base: Matrix = f.transform ? (f.transform.slice() as Matrix) : IDENTITY;
    const composed = multiply(fit, base);
    if (isIdentity(composed)) {
      const { transform: _drop, ...rest } = f;
      return rest as Fill;
    }
    return { ...f, transform: composed.slice() as GradientTransform };
  }
  return f;
}

// ---------------------------------------------------------------------------
// Pass 1 — index gradient defs by id (anywhere in the tree).
// ---------------------------------------------------------------------------

function collectGradientDefs(el: XmlElement, out: Map<string, XmlElement>): void {
  if (el.local === "linearGradient" || el.local === "radialGradient") {
    const id = attr(el, "id");
    if (id) out.set(id, el);
  }
  for (const c of el.children) {
    if (isElement(c)) collectGradientDefs(c, out);
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — walk geometry, abort (throw) on anything non-decomposable.
// ---------------------------------------------------------------------------

function walkGeometry(
  el: XmlElement,
  ctx: PaintContext,
  out: ShapePrimitive[],
  gradients: Map<string, XmlElement>,
): void {
  for (const child of el.children) {
    if (!isElement(child)) continue; // stray text between geometry → ignored
    if (prefixOf(child.name) !== null) {
      throw new DecomposeError(`foreign-namespace element <${child.name}> is not decomposable`);
    }
    const tag = child.local;

    if (IGNORABLE_ELEMENTS.has(tag)) continue;
    // defs / gradient subtree already indexed in pass 1 — skip, do not paint.
    if (DEFS_ELEMENTS.has(tag)) continue;

    if (CONTAINER_ELEMENTS.has(tag)) {
      assertKnownAttrs(child);
      walkGeometry(child, mergeContext(ctx, child), out, gradients);
      continue;
    }

    if (GEOMETRY_ELEMENTS.has(tag)) {
      assertKnownAttrs(child);
      const merged = mergeContext(ctx, child);
      const shape = geometryToShape(tag, child, merged, gradients);
      if (shape) out.push(shape);
      continue;
    }

    // Anything else (text, image, filter, pattern, use, symbol, clipPath,
    // mask, …) is NOT decomposable → abort to N2 (A3.4 all-or-nothing).
    throw new DecomposeError(`element <${tag}> is not decomposable to native geometry`);
  }
}

/** Reject a kept element that carries ANY attribute N1 does not understand —
 *  an unknown attribute could alter the render (e.g. `clip-path`, `mask`,
 *  `filter`, `style`) in a way native geometry would silently lose. (A3.4) */
function assertKnownAttrs(el: XmlElement): void {
  for (const a of el.attrs) {
    if (prefixOf(a.name) !== null) {
      throw new DecomposeError(`foreign-namespace attribute ${a.name} on <${el.local}>`);
    }
    const name = a.name.toLowerCase();
    if (name === "style" || name === "class") {
      throw new DecomposeError(`<${el.local}> carries ${name} — not decomposable`);
    }
    if (!KNOWN_GEOMETRY_ATTRS.has(name)) {
      throw new DecomposeError(`<${el.local}> attribute ${a.name} is not decomposable`);
    }
  }
}

// ---------------------------------------------------------------------------
// Element → LSML shape.
// ---------------------------------------------------------------------------

function geometryToShape(
  tag: string,
  el: XmlElement,
  ctx: PaintContext,
  gradients: Map<string, XmlElement>,
): ShapePrimitive | null {
  // Every primitive lowers to a `geometry:"path"` shape whose `d` already has
  // the cumulative transform BAKED IN. This keeps the LSML flat: there is no
  // group nesting to honour at render time — the matrix lives in the path.
  const subpaths = primitiveToPaths(tag, el, ctx.ctm);
  if (subpaths.length === 0) return null; // degenerate (e.g. r<=0) → drop shape

  const shape: ShapePrimitive = { kind: "shape", geometry: "path" };
  if (subpaths.length === 1 && subpaths[0]) {
    shape.pathData = subpaths[0].data;
    if (subpaths[0].windingRule) shape.paths = subpaths; // keep windingRule fidelity
    if (shape.paths) delete shape.pathData;
  }
  if (!shape.pathData && !shape.paths) {
    shape.paths = subpaths;
  } else if (subpaths.length > 1) {
    shape.paths = subpaths;
    delete shape.pathData;
  }

  const fills = resolveFills(el, ctx, gradients);
  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
    shape.fill = fills[0].color;
  } else if (fills.length > 0) {
    shape.fills = fills;
  }

  const stroke = resolveStroke(ctx);
  if (stroke) shape.stroke = stroke;

  if (ctx.opacity !== undefined && ctx.opacity !== 1) shape.opacity = ctx.opacity;

  return shape;
}

/** Convert a single primitive into 1+ subpaths with the CTM baked into the
 *  emitted path `d`. The path data is produced through `reemitPathData` (the
 *  shared #N tokeniser) so it is guaranteed to be a finite, bounded, valid
 *  `d` string — never a raw passthrough. */
function primitiveToPaths(tag: string, el: XmlElement, ctm: Matrix): ShapePathEntry[] {
  let rawD: string | null;
  let winding: "NONZERO" | "EVENODD" | undefined;

  switch (tag) {
    case "path": {
      rawD = attr(el, "d");
      winding = readFillRule(el);
      break;
    }
    case "rect":
      rawD = rectToPathData(el);
      break;
    case "circle":
      rawD = circleToPathData(el);
      break;
    case "ellipse":
      rawD = ellipseToPathData(el);
      break;
    case "line":
      rawD = lineToPathData(el);
      break;
    case "polyline":
      rawD = polyToPathData(el, false);
      break;
    case "polygon":
      rawD = polyToPathData(el, true);
      winding = readFillRule(el);
      break;
    default:
      throw new DecomposeError(`internal: unhandled geometry <${tag}>`);
  }
  if (rawD === null) return [];

  const baked = bakeTransformIntoPath(rawD, ctm);
  if (baked === null) {
    // A path we cannot tokenise/transform safely (e.g. arc under a non-uniform
    // matrix, or an un-tokenisable `d`) is NOT decomposable → bail to N2.
    throw new DecomposeError(`path data not decomposable under transform`);
  }
  const entry: ShapePathEntry = { data: baked };
  if (winding) entry.windingRule = winding;
  return [entry];
}

// ---------------------------------------------------------------------------
// Primitive → path `d` (in the element's own coordinate space, pre-transform).
// ---------------------------------------------------------------------------

function rectToPathData(el: XmlElement): string | null {
  const x = num(el, "x", 0);
  const y = num(el, "y", 0);
  const w = num(el, "width", NaN);
  const h = num(el, "height", NaN);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  let rx = numOrNull(el, "rx");
  let ry = numOrNull(el, "ry");
  // Emit ONLY M/L/A/Z (no H/V) so the path survives a later axis-aligned fit
  // transform unambiguously (bakeTransformIntoPath does not track the current
  // point needed to lower H/V).
  if (rx === null && ry === null) {
    return `M ${g(x)} ${g(y)} L ${g(x + w)} ${g(y)} L ${g(x + w)} ${g(y + h)} L ${g(x)} ${g(y + h)} Z`;
  }
  // Per SVG: a missing rx/ry mirrors the other; both clamp to half the side.
  if (rx === null) rx = ry;
  if (ry === null) ry = rx;
  rx = Math.min(rx!, w / 2);
  ry = Math.min(ry!, h / 2);
  if (rx <= 0 || ry <= 0) {
    return `M ${g(x)} ${g(y)} L ${g(x + w)} ${g(y)} L ${g(x + w)} ${g(y + h)} L ${g(x)} ${g(y + h)} Z`;
  }
  // Rounded rectangle via four arcs (sweep=1, clockwise).
  return [
    `M ${g(x + rx)} ${g(y)}`,
    `L ${g(x + w - rx)} ${g(y)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(x + w)} ${g(y + ry)}`,
    `L ${g(x + w)} ${g(y + h - ry)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(x + w - rx)} ${g(y + h)}`,
    `L ${g(x + rx)} ${g(y + h)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(x)} ${g(y + h - ry)}`,
    `L ${g(x)} ${g(y + ry)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(x + rx)} ${g(y)}`,
    "Z",
  ].join(" ");
}

function circleToPathData(el: XmlElement): string | null {
  const cx = num(el, "cx", 0);
  const cy = num(el, "cy", 0);
  const r = num(el, "r", NaN);
  if (!Number.isFinite(r) || r <= 0) return null;
  return ellipseArc(cx, cy, r, r);
}

function ellipseToPathData(el: XmlElement): string | null {
  const cx = num(el, "cx", 0);
  const cy = num(el, "cy", 0);
  const rx = num(el, "rx", NaN);
  const ry = num(el, "ry", NaN);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0) return null;
  return ellipseArc(cx, cy, rx, ry);
}

/** Two-arc ellipse outline (start at the right vertex). Closed. */
function ellipseArc(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M ${g(cx + rx)} ${g(cy)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(cx - rx)} ${g(cy)}`,
    `A ${g(rx)} ${g(ry)} 0 0 1 ${g(cx + rx)} ${g(cy)}`,
    "Z",
  ].join(" ");
}

function lineToPathData(el: XmlElement): string | null {
  const x1 = num(el, "x1", 0);
  const y1 = num(el, "y1", 0);
  const x2 = num(el, "x2", 0);
  const y2 = num(el, "y2", 0);
  return `M ${g(x1)} ${g(y1)} L ${g(x2)} ${g(y2)}`;
}

function polyToPathData(el: XmlElement, close: boolean): string | null {
  const raw = attr(el, "points");
  if (!raw) return null;
  const nums = splitNumericArgs(raw);
  if (nums === null || nums.length < 4 || nums.length % 2 !== 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    parts.push(`${i === 0 ? "M" : "L"} ${g(nums[i]!)} ${g(nums[i + 1]!)}`);
  }
  if (close) parts.push("Z");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Transform baking: re-tokenise a `d` and apply the CTM to absolute coords.
// ---------------------------------------------------------------------------

/** Apply `ctm` to a `d` string and re-emit normalised path data. Absolute
 *  M/L/H/V/C/S/Q/T/A/Z are handled (H/V are lowered to absolute L). A relative
 *  command, or an elliptical arc under a rotation/skew matrix (its axis
 *  rotation would need recomputing), returns null → not decomposable (bail to
 *  N2). When `ctm` is identity, the path is re-emitted through the shared
 *  `reemitPathData` (validation/bounds only). */
function bakeTransformIntoPath(rawD: string, ctm: Matrix): string | null {
  if (isIdentity(ctm)) {
    return reemitPathData(rawD);
  }
  // Validate the tokens first (also bounds them) before we transform.
  if (reemitPathData(rawD) === null) return null;
  return transformPathData(rawD, ctm);
}

const PATH_TOKEN_RE = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

function transformPathData(rawD: string, m: Matrix): string | null {
  const tokens: (string | number)[] = [];
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(rawD)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) {
      const n = parseFloat(match[2]);
      if (!Number.isFinite(n)) return null;
      tokens.push(n);
    }
  }
  const out: string[] = [];
  let i = 0;
  // Track the current absolute point so H/V can be lowered to L under any
  // matrix (an H/V does not stay axis-aligned under rotation/skew).
  let curX = 0;
  let curY = 0;
  const pt = (x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const uniformScale = m[1] === 0 && m[2] === 0; // axis-aligned scale/translate

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (typeof cmd !== "string") return null; // numbers must follow a command
    switch (cmd) {
      case "M":
      case "L":
      case "T": {
        const [x] = readNums(tokens, i, 2);
        if (x === null) return null;
        i += 2;
        curX = x[0]!;
        curY = x[1]!;
        const [tx, ty] = pt(x[0]!, x[1]!);
        out.push(`${cmd} ${g(tx)} ${g(ty)}`);
        break;
      }
      case "H": {
        const [x] = readNums(tokens, i, 1);
        if (x === null) return null;
        i += 1;
        curX = x[0]!;
        const [tx, ty] = pt(curX, curY);
        out.push(`L ${g(tx)} ${g(ty)}`); // lowered to absolute L
        break;
      }
      case "V": {
        const [x] = readNums(tokens, i, 1);
        if (x === null) return null;
        i += 1;
        curY = x[0]!;
        const [tx, ty] = pt(curX, curY);
        out.push(`L ${g(tx)} ${g(ty)}`);
        break;
      }
      case "C": {
        const r = readNums(tokens, i, 6);
        if (r[0] === null) return null;
        i += 6;
        const a = r[0]!;
        const p1 = pt(a[0]!, a[1]!);
        const p2 = pt(a[2]!, a[3]!);
        const p3 = pt(a[4]!, a[5]!);
        curX = a[4]!;
        curY = a[5]!;
        out.push(`C ${g(p1[0])} ${g(p1[1])} ${g(p2[0])} ${g(p2[1])} ${g(p3[0])} ${g(p3[1])}`);
        break;
      }
      case "S":
      case "Q": {
        const r = readNums(tokens, i, 4);
        if (r[0] === null) return null;
        i += 4;
        const a = r[0]!;
        const p1 = pt(a[0]!, a[1]!);
        const p2 = pt(a[2]!, a[3]!);
        curX = a[2]!;
        curY = a[3]!;
        out.push(`${cmd} ${g(p1[0])} ${g(p1[1])} ${g(p2[0])} ${g(p2[1])}`);
        break;
      }
      case "A":
        // Elliptical arc. Safe under an AXIS-ALIGNED matrix (no rotation/skew,
        // m[1]==m[2]==0): rx scales by |a|, ry by |d|, the x-axis-rotation and
        // large-arc flag are unchanged, and the sweep flag flips iff the matrix
        // mirrors exactly one axis (det < 0). Any rotation/skew → bail to N2
        // (the arc's axis rotation would need recomputing).
        if (!uniformScale) return null;
        {
          const r = readNums(tokens, i, 7);
          if (r[0] === null) return null;
          i += 7;
          const a = r[0]!;
          const nrx = Math.abs(m[0]) * a[0]!;
          const nry = Math.abs(m[3]) * a[1]!;
          const mirror = m[0] * m[3] < 0; // exactly one axis flipped
          const arcSweep = a[4]!;
          const sweep = mirror ? (arcSweep === 1 ? 0 : 1) : arcSweep;
          curX = a[5]!;
          curY = a[6]!;
          const end = pt(a[5]!, a[6]!);
          out.push(
            `A ${g(nrx)} ${g(nry)} ${g(a[2]!)} ${g(a[3]!)} ${g(sweep)} ${g(end[0])} ${g(end[1])}`,
          );
        }
        break;
      case "Z":
      case "z":
        out.push("Z");
        break;
      default:
        // Relative command (lowercase) or unknown — not safely bakeable.
        return null;
    }
  }
  return out.length > 0 ? out.join(" ") : null;
}

function readNums(
  tokens: (string | number)[],
  start: number,
  count: number,
): [number[] | null, null] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const t = tokens[start + k];
    if (typeof t !== "number") return [null, null];
    out.push(t);
  }
  return [out, null];
}

// ---------------------------------------------------------------------------
// Fills (solid / linear / radial gradient).
// ---------------------------------------------------------------------------

function resolveFills(
  el: XmlElement,
  ctx: PaintContext,
  gradients: Map<string, XmlElement>,
): Fill[] {
  const fill = ctx.fill;
  if (!fill || fill === "none") return [];

  const opacity = ctx.fillOpacity;

  // url(#id) → gradient def.
  const ref = /^url\(#([A-Za-z_][\w.-]*)\)$/.exec(fill);
  if (ref) {
    const def = gradients.get(ref[1]!);
    if (!def) throw new DecomposeError(`fill references missing gradient #${ref[1]}`);
    return [gradientToFill(def, ctx, opacity)];
  }

  // A bare colour already validated by validatePaintColor in mergeContext.
  const solid: Fill = { kind: "solid", color: fill };
  if (opacity !== undefined && opacity !== 1) solid.opacity = opacity;
  return [solid];
}

function gradientToFill(def: XmlElement, ctx: PaintContext, opacity: number | undefined): Fill {
  const stops = readStops(def);
  if (stops.length === 0) throw new DecomposeError("gradient has no decomposable stops");

  const gradTransform = readGradientTransform(def);
  // The gradient is positioned in the element's user space; compose the
  // element CTM with the gradient's own transform so the emitted LSML
  // `transform` reproduces the source placement (§4.12, 6-float).
  const composed = gradTransform ? multiply(ctx.ctm, gradTransform) : ctx.ctm;
  const transform: GradientTransform | undefined = isIdentity(composed)
    ? undefined
    : (composed.slice() as GradientTransform);

  if (def.local === "linearGradient") {
    const f: Fill = { kind: "linear-gradient", stops };
    if (transform) f.transform = transform;
    if (opacity !== undefined && opacity !== 1) f.opacity = opacity;
    return f;
  }
  // radialGradient
  const f: Fill = { kind: "radial-gradient", stops };
  if (transform) f.transform = transform;
  if (opacity !== undefined && opacity !== 1) f.opacity = opacity;
  return f;
}

function readStops(def: XmlElement): GradientStop[] {
  const out: GradientStop[] = [];
  for (const c of def.children) {
    if (!isElement(c) || c.local !== "stop") continue;
    const rawOffset = attr(c, "offset");
    let offset = 0;
    if (rawOffset !== null) {
      const trimmed = rawOffset.trim();
      if (trimmed.endsWith("%")) {
        const p = Number(trimmed.slice(0, -1));
        if (!Number.isFinite(p)) throw new DecomposeError("gradient stop offset not finite");
        offset = p / 100;
      } else {
        const p = Number(trimmed);
        if (!Number.isFinite(p)) throw new DecomposeError("gradient stop offset not finite");
        offset = p;
      }
    }
    offset = Math.max(0, Math.min(1, offset));
    const rawColor = attr(c, "stop-color") ?? "#000000";
    const color = validatePaintColor(rawColor);
    if (color === null || color === "none") {
      throw new DecomposeError(`gradient stop-color "${rawColor}" not decomposable`);
    }
    const stop: GradientStop = { offset, color };
    const rawStopOpacity = attr(c, "stop-opacity");
    if (rawStopOpacity !== null) {
      const o = reemitScalar(rawStopOpacity);
      if (o === null) throw new DecomposeError("gradient stop-opacity not decomposable");
      const ov = Number(o.endsWith("%") ? Number(o.slice(0, -1)) / 100 : o);
      stop.opacity = Math.max(0, Math.min(1, ov));
    }
    out.push(stop);
  }
  return out;
}

function readGradientTransform(def: XmlElement): Matrix | null {
  const raw = attr(def, "gradientTransform");
  if (!raw) return null;
  const m = parseTransform(raw);
  if (m === null) throw new DecomposeError("gradientTransform not decomposable");
  return m;
}

// ---------------------------------------------------------------------------
// Stroke.
// ---------------------------------------------------------------------------

function resolveStroke(ctx: PaintContext): { color: string; width: number } | null {
  if (!ctx.stroke || ctx.stroke === "none") return null;
  if (ctx.stroke.startsWith("url(")) {
    // A gradient stroke is not expressible as the scalar LSML `stroke`. Bail.
    throw new DecomposeError("gradient stroke is not decomposable");
  }
  const width = ctx.strokeWidth ?? 1;
  return { color: ctx.stroke, width };
}

// ---------------------------------------------------------------------------
// Presentation-context inheritance.
// ---------------------------------------------------------------------------

function mergeContext(parent: PaintContext, el: XmlElement): PaintContext {
  const ctx: PaintContext = { ...parent };

  const tf = attr(el, "transform");
  if (tf) {
    const m = parseTransform(tf);
    if (m === null) throw new DecomposeError(`transform "${tf}" is not decomposable`);
    ctx.ctm = multiply(parent.ctm, m);
  }

  const fill = attr(el, "fill");
  if (fill !== null) ctx.fill = validatePaint(fill, "fill");

  const stroke = attr(el, "stroke");
  if (stroke !== null) ctx.stroke = validatePaint(stroke, "stroke");

  const sw = numOrNull(el, "stroke-width");
  if (sw !== null) ctx.strokeWidth = sw;

  const fo = numOrNull(el, "fill-opacity");
  if (fo !== null) ctx.fillOpacity = clamp01(fo);

  const so = numOrNull(el, "stroke-opacity");
  if (so !== null) ctx.strokeOpacity = clamp01(so);

  const op = numOrNull(el, "opacity");
  if (op !== null) {
    const v = clamp01(op);
    ctx.opacity = (parent.opacity ?? 1) * v;
  }

  const fr = readFillRule(el);
  if (fr) ctx.fillRule = fr;

  return ctx;
}

/** Validate a paint value through the shared #N validator. `url(#id)` is kept
 *  verbatim for later gradient resolution; `none`/colour pass through; anything
 *  else aborts decomposition. */
function validatePaint(raw: string, which: "fill" | "stroke"): string {
  const v = raw.trim();
  if (v === "none") return "none";
  if (/^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/.test(v)) return v.replace(/\s+/g, "");
  const valid = validatePaintColor(v);
  if (valid === null) throw new DecomposeError(`${which}="${raw}" is not decomposable`);
  return valid;
}

function readFillRule(el: XmlElement): "NONZERO" | "EVENODD" | undefined {
  const fr = attr(el, "fill-rule");
  if (fr === "evenodd") return "EVENODD";
  if (fr === "nonzero") return "NONZERO";
  return undefined;
}

// ---------------------------------------------------------------------------
// transform="…" → affine matrix. ONLY the affine SVG transform functions, each
// with finite bounded args (reusing the shared `splitNumericArgs`). Unknown
// function → null (caller aborts to N2).
// ---------------------------------------------------------------------------

function parseTransform(value: string): Matrix | null {
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let acc: Matrix = IDENTITY;
  let consumed = 0;
  let any = false;
  while ((m = re.exec(value)) !== null) {
    consumed = re.lastIndex;
    const fn = m[1]!;
    const args = splitNumericArgs(m[2]!);
    if (args === null) return null;
    for (const a of args) if (clampFinite(a) === null) return null;
    const mat = transformFn(fn, args);
    if (mat === null) return null;
    acc = multiply(acc, mat);
    any = true;
  }
  if (!any) return null;
  if (value.slice(consumed).trim().length > 0) return null; // trailing garbage
  return acc;
}

function transformFn(fn: string, a: number[]): Matrix | null {
  switch (fn) {
    case "matrix":
      return a.length === 6 ? (a.slice() as Matrix) : null;
    case "translate":
      if (a.length === 1) return [1, 0, 0, 1, a[0]!, 0];
      return a.length === 2 ? [1, 0, 0, 1, a[0]!, a[1]!] : null;
    case "scale":
      if (a.length === 1) return [a[0]!, 0, 0, a[0]!, 0, 0];
      return a.length === 2 ? [a[0]!, 0, 0, a[1]!, 0, 0] : null;
    case "rotate": {
      if (a.length !== 1 && a.length !== 3) return null;
      const rad = (a[0]! * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
      if (a.length === 1) return rot;
      // rotate(angle cx cy) = translate(cx,cy) · rotate · translate(-cx,-cy)
      const cx = a[1]!;
      const cy = a[2]!;
      return multiply(multiply([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
    }
    case "skewX": {
      if (a.length !== 1) return null;
      return [1, 0, Math.tan((a[0]! * Math.PI) / 180), 1, 0, 0];
    }
    case "skewY": {
      if (a.length !== 1) return null;
      return [1, Math.tan((a[0]! * Math.PI) / 180), 0, 1, 0, 0];
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// viewBox / numeric attribute helpers.
// ---------------------------------------------------------------------------

function readViewBox(root: XmlElement): [number, number, number, number] {
  const vb = attr(root, "viewBox");
  if (vb) {
    const nums = splitNumericArgs(vb);
    if (nums && nums.length === 4 && nums.every((n) => clampFinite(n) !== null)) {
      return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
    }
  }
  const w = numOrNull(root, "width");
  const h = numOrNull(root, "height");
  if (w !== null && h !== null && w > 0 && h > 0) return [0, 0, w, h];
  return [0, 0, 1, 1];
}

function attr(el: XmlElement, name: string): string | null {
  for (const a of el.attrs) {
    if (a.name === name) return a.value;
  }
  return null;
}

function num(el: XmlElement, name: string, dflt: number): number {
  const v = numOrNull(el, name);
  return v === null ? dflt : v;
}

function numOrNull(el: XmlElement, name: string): number | null {
  const raw = attr(el, name);
  if (raw === null) return null;
  const re = reemitScalar(raw);
  if (re === null) return null;
  // Percentages are not meaningful for the geometry scalars N1 reads.
  if (re.endsWith("%")) return null;
  const n = Number(re);
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Format a finite, bounded geometry coordinate. Reuses the shared clamp+fmt
 *  so the emitted path data carries only finite bounded tokens (#N spirit). */
function g(n: number): string {
  const c = clampFinite(n);
  if (c === null) throw new DecomposeError(`coordinate ${n} out of bounds`);
  return fmt(c);
}
