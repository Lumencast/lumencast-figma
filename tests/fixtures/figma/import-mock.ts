// In-memory Figma create-API mock for the import pipeline.
//
// Each `createX()` returns a node implementing the relevant Import*Node
// surface and exposing setters / appendChild as needed by builders.
// Re-export uses the existing src/mapping mock surface, so the same nodes
// can flow back through the export pipeline for byte-stable roundtrip
// testing.

import type {
  ImportFigmaApi,
  ImportImageHandle,
  ImportTextNode,
  ImportShapeNode,
  ImportFrameNode,
  ImportInstanceNode,
  ImportPaint,
  ImportStroke,
  ImportBaseNode,
} from "../../../src/import/figma-api";
import { sha256Hex } from "../../../src/export/sha256-pure";
import { equipPluginData } from "./mock";

interface NodeStore {
  appended: BuiltNode[];
  /** Sequential id counter so every created node gets a unique id. */
  nextId: number;
  /** Sequential image hash counter — produces deterministic hashes per
   *  invocation order in the test (`img-0`, `img-1`, ...). */
  nextImageHash: number;
}

export interface BuiltNode {
  type: string;
  id: string;
  name: string;
  /** Set by appendChild on a parent (or by figma.group). Used by the
   *  group-conversion post-pass. */
  parent?: BuiltNode;
  /** Detach from parent. Mirrors Figma's `node.remove()`. */
  remove?(): void;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  fills?: ImportPaint[];
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
  strokes?: ImportStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: "NO_WRAP" | "WRAP";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  characters?: string;
  fontSize?: number;
  fontWeight?: number;
  fontName?: { family: string; style: string };
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  children: BuiltNode[];
  pluginData?: Record<string, string>;
  mainComponent?: {
    type: "COMPONENT";
    id: string;
    name: string;
    width: number;
    height: number;
    children: never[];
  } | null;
}

export interface ImportMock extends ImportFigmaApi {
  /** Test-only — the appended top-level nodes (one per importBundle call). */
  appended(): BuiltNode[];
}

function attachPluginData<T extends BuiltNode>(node: T): T {
  // The builders write plugin data via setSharedPluginData. We back that
  // with the same equipPluginData helper used on export-side mocks so the
  // resulting node is round-trippable.
  return equipPluginData(node as never) as T;
}

export function createImportMock(): ImportMock {
  const store: NodeStore = { appended: [], nextId: 0, nextImageHash: 0 };

  const mkBase = (type: string): BuiltNode => {
    const id = `imp:${store.nextId++}`;
    return attachPluginData({
      type,
      id,
      name: type,
      children: [],
      pluginData: {},
    });
  };

  const wrapText = (n: BuiltNode): ImportTextNode => {
    const text = n as unknown as ImportTextNode & BuiltNode;
    text.characters = "";
    text.resize = (w, h) => {
      n.width = w;
      n.height = h;
    };
    return text;
  };

  const wrapShape = (n: BuiltNode): ImportShapeNode => {
    const shape = n as unknown as ImportShapeNode & BuiltNode;
    shape.resize = (w, h) => {
      n.width = w;
      n.height = h;
    };
    return shape;
  };

  const wrapFrame = (n: BuiltNode): ImportFrameNode => {
    const frame = n as unknown as ImportFrameNode & BuiltNode;
    frame.resize = (w, h) => {
      n.width = w;
      n.height = h;
    };
    frame.appendChild = (child: ImportBaseNode) => {
      const c = child as unknown as BuiltNode;
      // Detach from previous parent if any (mock only — real Figma does
      // this implicitly when re-parenting).
      if (c.parent && c.parent.children) {
        const i = c.parent.children.indexOf(c);
        if (i >= 0) c.parent.children.splice(i, 1);
      }
      n.children.push(c);
      c.parent = n;
    };
    n.remove = () => {
      if (n.parent && n.parent.children) {
        const i = n.parent.children.indexOf(n);
        if (i >= 0) n.parent.children.splice(i, 1);
        delete n.parent;
      }
    };
    return frame;
  };

  const wrapInstance = (n: BuiltNode): ImportInstanceNode => {
    const inst = n as unknown as ImportInstanceNode & BuiltNode;
    inst.resize = (w, h) => {
      n.width = w;
      n.height = h;
    };
    return inst;
  };

  // Shared synthesis path for figma.group + the four boolean-op flavours.
  // Each one creates a synthetic container node, MOVES the given children
  // into it, and inserts it into the parent at the requested index. Used
  // by the post-build conversion pass to validate group / BO reconstruction
  // without a live Figma sandbox. The optional `booleanOperation` arg
  // tags BOOLEAN_OPERATION nodes so downstream assertions can detect the
  // op flavour the same way Figma's API exposes it.
  const wrapAsContainer = (
    type: "GROUP" | "BOOLEAN_OPERATION",
    name: string,
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
    booleanOperation?: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE",
  ): ImportBaseNode => {
    const containerNode = wrapFrame(mkBase(type));
    containerNode.name = name;
    const containerBuilt = containerNode as unknown as BuiltNode;
    if (booleanOperation) {
      (containerBuilt as { booleanOperation?: string }).booleanOperation =
        booleanOperation;
    }
    const parentNode = parent as unknown as BuiltNode;
    for (const child of nodes) {
      const c = child as unknown as BuiltNode;
      if (c.parent && c.parent.children) {
        const i = c.parent.children.indexOf(c);
        if (i >= 0) c.parent.children.splice(i, 1);
      }
      containerBuilt.children.push(c);
      c.parent = containerBuilt;
    }
    if (index !== undefined && index <= parentNode.children.length) {
      parentNode.children.splice(index, 0, containerBuilt);
    } else {
      parentNode.children.push(containerBuilt);
    }
    containerBuilt.parent = parentNode;
    return containerNode as unknown as ImportBaseNode;
  };

  const api: ImportMock = {
    createText: () => wrapText(mkBase("TEXT")),
    createRectangle: () => wrapShape(mkBase("RECTANGLE")),
    createEllipse: () => wrapShape(mkBase("ELLIPSE")),
    createVector: () => wrapShape(mkBase("VECTOR")),
    createFrame: () => wrapFrame(mkBase("FRAME")),
    createInstancePlaceholder: () => {
      const node = mkBase("INSTANCE");
      // The placeholder must look like a Figma INSTANCE for the export-side
      // mapper — give it a fake mainComponent.
      node.mainComponent = {
        type: "COMPONENT",
        id: "imp-main",
        name: "Imported Instance",
        width: 0,
        height: 0,
        children: [],
      };
      return wrapInstance(node);
    },
    loadFontAsync: () => Promise.resolve(),
    createImage: (bytes): ImportImageHandle => {
      // Figma's real `createImage` returns a deterministic hash derived from
      // the bytes (SHA-1, internally). Mirror that here so byte-stable
      // round-trip on the same content always produces the same asset
      // filename. We use SHA-256 (40-hex truncation = 20 bytes ≈ Figma SHA-1
      // length) ; the algorithm differs but the determinism is the property
      // the tests assert on.
      const hash = sha256Hex(bytes).slice(0, 40);
      return { hash };
    },
    appendToPage: (node) => {
      store.appended.push(node as unknown as BuiltNode);
    },
    group: (nodes, parent, index) =>
      wrapAsContainer("GROUP", "Group", nodes, parent, index),
    union: (nodes, parent, index) =>
      wrapAsContainer("BOOLEAN_OPERATION", "Union", nodes, parent, index, "UNION"),
    subtract: (nodes, parent, index) =>
      wrapAsContainer("BOOLEAN_OPERATION", "Subtract", nodes, parent, index, "SUBTRACT"),
    intersect: (nodes, parent, index) =>
      wrapAsContainer("BOOLEAN_OPERATION", "Intersect", nodes, parent, index, "INTERSECT"),
    exclude: (nodes, parent, index) =>
      wrapAsContainer("BOOLEAN_OPERATION", "Exclude", nodes, parent, index, "EXCLUDE"),
    appended: () => store.appended,
  };

  return api;
}
