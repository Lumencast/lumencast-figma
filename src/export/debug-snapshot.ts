// Recursive snapshot of a Figma SceneNode subtree, serialised to plain JSON.
//
// Goal : capture exactly what the host node tree looks like immediately
// before `mapTree` consumes it, so a `.lsmlz` archive can include a
// `_debug/raw-figma.json` artefact for offline diagnosis.
//
// Constraints :
//   - Figma node properties can return `figma.mixed` (a Symbol) when a
//     property is heterogeneous across child ranges. JSON.stringify chokes
//     on Symbols. We use asNumber/asString/asObject/asArray guards from
//     mapping/figma-mixed.ts to coerce them to undefined cleanly.
//   - Some properties (like `fillGeometry`, `vectorPaths`) are arrays of
//     `{ data, windingRule }` — we deep-clone them to plain objects to
//     strip any Symbol-keyed metadata.
//   - We only walk down into containers (FRAME / GROUP / COMPONENT /
//     INSTANCE / SECTION / BOOLEAN_OPERATION). Other types are leaves.
//   - Output is deterministic-ish (object key order driven by our explicit
//     property list, not by the host node's enumeration).

import { asArray, asBoolean, asNumber, asObject, asString } from "../mapping/figma-mixed";

/** Loose interface — we duck-type the host SceneNode for Symbol-safe reads. */
interface AnyNode {
  type: string;
  id: string;
  name: string;
  [k: string]: unknown;
}

interface SnapshotNode {
  type: string;
  id: string;
  name: string;
  visible?: boolean;
  // Layout
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  /** Figma's raw 2x3 affine transform `[[m00, m01, tx], [m10, m11, ty]]`
   *  captured for diagnostic purposes (flip detection, exact pose). */
  relativeTransform?: number[][];
  opacity?: number;
  layoutMode?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  layoutWrap?: string;
  layoutAlign?: string;
  layoutGrow?: number;
  layoutPositioning?: string;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  // Frame / shape
  clipsContent?: boolean;
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  cornerSmoothing?: number;
  fills?: unknown;
  fillGeometry?: unknown;
  strokes?: unknown;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeJoin?: string;
  strokeCap?: string;
  strokeMiterLimit?: number;
  dashPattern?: number[];
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  vectorPaths?: unknown;
  // Effects + blend + mask
  effects?: unknown;
  blendMode?: string;
  isMask?: boolean;
  maskType?: string;
  // Constraints
  constraints?: { horizontal?: string; vertical?: string };
  // Text
  characters?: string;
  fontSize?: number;
  fontWeight?: number;
  fontName?: { family?: string; style?: string };
  textCase?: string;
  textAutoResize?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: { unit?: string; value?: number };
  letterSpacing?: { unit?: string; value?: number };
  paragraphSpacing?: number;
  paragraphIndent?: number;
  textTruncation?: string;
  maxLines?: number;
  // Instance
  mainComponentId?: string | null;
  mainComponentName?: string | null;
  // Recursive
  children?: SnapshotNode[];
  // Any remaining diagnostic info we didn't recognise.
  _other?: Record<string, unknown>;
}

const RECURSIVE_TYPES = new Set([
  "DOCUMENT",
  "PAGE",
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
  "BOOLEAN_OPERATION",
]);

/** Snapshot a Figma SceneNode subtree. Safe against figma.mixed Symbols
 *  and circular host references — we read named props only and never
 *  enumerate the node. */
export function snapshotFigmaNode(node: AnyNode, depth = 0): SnapshotNode {
  const out: SnapshotNode = {
    type: String(node.type),
    id: String(node.id),
    name: String(node.name ?? ""),
  };

  const visible = asBoolean(node["visible"]);
  if (visible !== undefined) out.visible = visible;

  // Layout — cast to a generic record to satisfy the strict-optional type.
  const dst = out as unknown as Record<string, unknown>;
  copyNumber(node, dst, "x");
  copyNumber(node, dst, "y");
  copyNumber(node, dst, "width");
  copyNumber(node, dst, "height");
  copyNumber(node, dst, "rotation");
  // relativeTransform is a 2x3 array of arrays — sanitizeArray strips Symbols.
  const rt = sanitizeArray(node["relativeTransform"]);
  if (rt && rt.length === 2) {
    out.relativeTransform = rt as number[][];
  }
  copyNumber(node, dst, "opacity");
  copyString(node, dst, "layoutMode");
  copyString(node, dst, "layoutSizingHorizontal");
  copyString(node, dst, "layoutSizingVertical");
  copyString(node, dst, "primaryAxisSizingMode");
  copyString(node, dst, "counterAxisSizingMode");
  copyString(node, dst, "primaryAxisAlignItems");
  copyString(node, dst, "counterAxisAlignItems");
  copyNumber(node, dst, "itemSpacing");
  copyNumber(node, dst, "counterAxisSpacing");
  copyNumber(node, dst, "paddingLeft");
  copyNumber(node, dst, "paddingRight");
  copyNumber(node, dst, "paddingTop");
  copyNumber(node, dst, "paddingBottom");
  copyString(node, dst, "layoutWrap");
  // Per-child auto-layout overrides
  copyString(node, dst, "layoutAlign");
  copyNumber(node, dst, "layoutGrow");
  copyString(node, dst, "layoutPositioning");
  copyNumber(node, dst, "minWidth");
  copyNumber(node, dst, "maxWidth");
  copyNumber(node, dst, "minHeight");
  copyNumber(node, dst, "maxHeight");

  // Frame / shape
  const clipsContent = asBoolean(node["clipsContent"]);
  if (clipsContent !== undefined) out.clipsContent = clipsContent;
  copyNumber(node, dst, "cornerRadius");
  copyNumber(node, dst, "topLeftRadius");
  copyNumber(node, dst, "topRightRadius");
  copyNumber(node, dst, "bottomLeftRadius");
  copyNumber(node, dst, "bottomRightRadius");
  copyNumber(node, dst, "cornerSmoothing");
  // fills / strokes / vectorPaths / fillGeometry — deep-clone to strip Symbols.
  const fills = sanitizeArray(node["fills"]);
  if (fills !== undefined) out.fills = fills;
  const fillGeometry = sanitizeArray(node["fillGeometry"]);
  if (fillGeometry !== undefined) out.fillGeometry = fillGeometry;
  const strokes = sanitizeArray(node["strokes"]);
  if (strokes !== undefined) out.strokes = strokes;
  copyNumber(node, dst, "strokeWeight");
  copyString(node, dst, "strokeAlign");
  copyString(node, dst, "strokeJoin");
  copyString(node, dst, "strokeCap");
  copyNumber(node, dst, "strokeMiterLimit");
  copyNumber(node, dst, "strokeTopWeight");
  copyNumber(node, dst, "strokeRightWeight");
  copyNumber(node, dst, "strokeBottomWeight");
  copyNumber(node, dst, "strokeLeftWeight");
  const dashPattern = asArray<unknown>(node["dashPattern"]);
  if (dashPattern) {
    const cleaned: number[] = [];
    for (const v of dashPattern) {
      const n = asNumber(v);
      if (n !== undefined) cleaned.push(n);
    }
    if (cleaned.length > 0) out.dashPattern = cleaned;
  }
  const vectorPaths = sanitizeArray(node["vectorPaths"]);
  if (vectorPaths !== undefined) out.vectorPaths = vectorPaths;

  // Effects + blend mode + mask
  const effects = sanitizeArray(node["effects"]);
  if (effects !== undefined && effects.length > 0) out.effects = effects;
  copyString(node, dst, "blendMode");
  const isMask = asBoolean(node["isMask"]);
  if (isMask !== undefined) out.isMask = isMask;
  copyString(node, dst, "maskType");

  // Constraints
  const constraints = asObject<{ horizontal?: unknown; vertical?: unknown }>(node["constraints"]);
  if (constraints) {
    const c: { horizontal?: string; vertical?: string } = {};
    const h = asString(constraints.horizontal);
    if (h !== undefined) c.horizontal = h;
    const v = asString(constraints.vertical);
    if (v !== undefined) c.vertical = v;
    if (c.horizontal || c.vertical) out.constraints = c;
  }

  // Text
  if (typeof node["characters"] === "string") out.characters = node["characters"];
  copyNumber(node, dst, "fontSize");
  copyNumber(node, dst, "fontWeight");
  const fontName = asObject<{ family?: unknown; style?: unknown }>(node["fontName"]);
  if (fontName) {
    const fn: { family?: string; style?: string } = {};
    const fam = asString(fontName.family);
    if (fam !== undefined) fn.family = fam;
    const sty = asString(fontName.style);
    if (sty !== undefined) fn.style = sty;
    out.fontName = fn;
  }
  copyString(node, dst, "textCase");
  copyString(node, dst, "textAutoResize");
  copyString(node, dst, "textAlignHorizontal");
  copyString(node, dst, "textAlignVertical");
  const lh = asObject<{ unit?: unknown; value?: unknown }>(node["lineHeight"]);
  if (lh) {
    const lhOut: { unit?: string; value?: number } = {};
    const u = asString(lh.unit);
    if (u !== undefined) lhOut.unit = u;
    const v = asNumber(lh.value);
    if (v !== undefined) lhOut.value = v;
    out.lineHeight = lhOut;
  }
  const ls = asObject<{ unit?: unknown; value?: unknown }>(node["letterSpacing"]);
  if (ls) {
    const lsOut: { unit?: string; value?: number } = {};
    const u = asString(ls.unit);
    if (u !== undefined) lsOut.unit = u;
    const v = asNumber(ls.value);
    if (v !== undefined) lsOut.value = v;
    out.letterSpacing = lsOut;
  }
  copyNumber(node, dst, "paragraphSpacing");
  copyNumber(node, dst, "paragraphIndent");
  copyString(node, dst, "textTruncation");
  copyNumber(node, dst, "maxLines");

  // Instance — `node.mainComponent` is a synchronous getter that throws
  // in `documentAccess: "dynamic-page"` mode (the API requires
  // `getMainComponentAsync` instead). The debug snapshot is best-effort
  // and is captured before any async pre-pass runs, so we tolerate the
  // throw and leave the field undefined rather than aborting the whole
  // snapshot. Mocks / non-dynamic-page surfaces still populate it.
  try {
    const mainComponent = asObject<{ id?: unknown; name?: unknown }>(node["mainComponent"]);
    if (mainComponent) {
      out.mainComponentId = asString(mainComponent.id) ?? null;
      out.mainComponentName = asString(mainComponent.name) ?? null;
    }
  } catch {
    // dynamic-page : skip silently.
  }

  // Children (only for known container types, and only when we have a real
  // array — never iterate over a Symbol).
  if (RECURSIVE_TYPES.has(out.type) && depth < 50) {
    const kids = asArray<AnyNode>(node["children"]);
    if (kids && kids.length > 0) {
      out.children = kids.map((c) => snapshotFigmaNode(c, depth + 1));
    }
  }

  return out;
}

function copyNumber(src: AnyNode, dst: Record<string, unknown>, key: string): void {
  const v = asNumber(src[key]);
  if (v !== undefined) dst[key] = v;
}

function copyString(src: AnyNode, dst: Record<string, unknown>, key: string): void {
  const v = asString(src[key]);
  if (v !== undefined) dst[key] = v;
}

/** Deep-clone an array-like host value into plain JSON-safe objects.
 *  Returns undefined when the input isn't actually an array — protects
 *  against figma.mixed (Symbol) and unset properties. */
function sanitizeArray(value: unknown): unknown[] | undefined {
  const arr = asArray<unknown>(value);
  if (!arr) return undefined;
  return arr.map(sanitizeValue);
}

function sanitizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "symbol") return "<figma.mixed>";
  if (typeof value === "function") return "<function>";
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  // Plain object — copy own string-keyed enumerable props only.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object)) {
    try {
      out[k] = sanitizeValue((value as Record<string, unknown>)[k]);
    } catch {
      out[k] = "<unreadable>";
    }
  }
  return out;
}
