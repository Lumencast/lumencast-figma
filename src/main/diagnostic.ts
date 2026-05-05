// Diagnostic dump : walks the selected node + descendants and emits a
// JSON file with every property the position-debug investigation cares
// about. The user runs this from the plugin menu after an import OR on
// the source structure ; we get a reproducible, structured snapshot of
// what Figma's plugin API actually reports — node.x, node.y, rotation,
// relativeTransform, absoluteTransform, absoluteBoundingBox, parent
// type/id/name, plus computed differences.
//
// Compare two dumps (source vs imported) to isolate exactly which
// property drifts and by how much.

interface DiagnosticEntry {
  id: string;
  name: string;
  type: string;
  depth: number;
  parent: { id: string; name: string; type: string } | null;
  x: number | string | undefined;
  y: number | string | undefined;
  width: number | string | undefined;
  height: number | string | undefined;
  rotation: number | string | undefined;
  relativeTransform: number[][] | string | undefined;
  absoluteTransform: number[][] | string | undefined;
  absoluteBoundingBox:
    | { x: number; y: number; width: number; height: number }
    | string
    | null
    | undefined;
  constraints: { horizontal?: string; vertical?: string } | string | undefined;
  layoutMode: string | undefined;
  layoutSizingHorizontal: string | undefined;
  layoutSizingVertical: string | undefined;
  childCount: number;
}

/** Coerce an unknown plugin API value into something JSON-serialisable.
 *  `figma.mixed` is a Symbol — turn it into "<mixed>". Host arrays /
 *  objects are walked recursively. Numbers / strings / booleans pass
 *  through. */
function sanitize(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "symbol") return "<mixed>";
  if (typeof v === "function") return "<function>";
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v as object)) {
    try {
      out[key] = sanitize((v as Record<string, unknown>)[key]);
    } catch {
      out[key] = "<unreadable>";
    }
  }
  return out;
}

function readNumber(node: unknown, key: string): number | string | undefined {
  try {
    const v = (node as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "symbol") return "<mixed>";
    return undefined;
  } catch (err) {
    return `<error: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

function readString(node: unknown, key: string): string | undefined {
  try {
    const v = (node as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

function readMatrix(node: unknown, key: string): number[][] | string | undefined {
  try {
    const v = (node as Record<string, unknown>)[key];
    if (typeof v === "symbol") return "<mixed>";
    const sanitized = sanitize(v);
    return sanitized as number[][];
  } catch (err) {
    return `<error: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

function describeNode(
  node: SceneNode,
  depth: number,
  parent: BaseNode | null,
): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    id: node.id,
    name: node.name,
    type: node.type,
    depth,
    parent: parent
      ? { id: parent.id, name: (parent as { name?: string }).name ?? "", type: parent.type }
      : null,
    x: readNumber(node, "x"),
    y: readNumber(node, "y"),
    width: readNumber(node, "width"),
    height: readNumber(node, "height"),
    rotation: readNumber(node, "rotation"),
    relativeTransform: readMatrix(node, "relativeTransform"),
    absoluteTransform: readMatrix(node, "absoluteTransform"),
    absoluteBoundingBox: undefined,
    constraints: undefined,
    layoutMode: readString(node, "layoutMode"),
    layoutSizingHorizontal: readString(node, "layoutSizingHorizontal"),
    layoutSizingVertical: readString(node, "layoutSizingVertical"),
    childCount: "children" in node && Array.isArray(node.children) ? node.children.length : 0,
  };
  try {
    const bbox = (node as { absoluteBoundingBox?: unknown }).absoluteBoundingBox;
    if (bbox && typeof bbox === "object") {
      const b = bbox as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
      if (
        typeof b.x === "number" &&
        typeof b.y === "number" &&
        typeof b.width === "number" &&
        typeof b.height === "number"
      ) {
        entry.absoluteBoundingBox = { x: b.x, y: b.y, width: b.width, height: b.height };
      } else {
        entry.absoluteBoundingBox = "<incomplete>";
      }
    } else if (bbox === null) {
      entry.absoluteBoundingBox = null;
    }
  } catch (err) {
    entry.absoluteBoundingBox = `<error: ${err instanceof Error ? err.message : String(err)}>`;
  }
  try {
    const c = (node as { constraints?: unknown }).constraints;
    if (c && typeof c === "object") {
      const cc = c as { horizontal?: unknown; vertical?: unknown };
      const out: { horizontal?: string; vertical?: string } = {};
      if (typeof cc.horizontal === "string") out.horizontal = cc.horizontal;
      if (typeof cc.vertical === "string") out.vertical = cc.vertical;
      entry.constraints = out;
    }
  } catch {
    // Swallow.
  }
  return entry;
}

function walk(
  node: SceneNode,
  depth: number,
  parent: BaseNode | null,
  out: DiagnosticEntry[],
): void {
  out.push(describeNode(node, depth, parent));
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child as SceneNode, depth + 1, node, out);
    }
  }
}

export interface DiagnosticDump {
  generatedAt: string;
  pluginVersion: string;
  rootSelection: string[];
  entries: DiagnosticEntry[];
}

/** Build a diagnostic dump for the current selection (or all top-level
 *  nodes on the current page when nothing is selected). Returns a JSON
 *  string ready to write to a file. */
export function buildDiagnosticDump(version: string): string {
  const selection = figma.currentPage.selection;
  const roots: readonly SceneNode[] = selection.length > 0 ? selection : figma.currentPage.children;
  const entries: DiagnosticEntry[] = [];
  for (const root of roots) {
    walk(root, 0, root.parent, entries);
  }
  const dump: DiagnosticDump = {
    generatedAt: new Date().toISOString(),
    pluginVersion: version,
    rootSelection: selection.map((n) => `${n.type} "${n.name}" (${n.id})`),
    entries,
  };
  return JSON.stringify(dump, null, 2);
}
