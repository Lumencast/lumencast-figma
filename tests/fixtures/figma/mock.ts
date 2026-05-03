// Minimal Figma plugin API mock. Only the surface used by the export pipeline
// is implemented — node creation factories, plugin-data, traversal, image
// extraction. Add fields here as the plugin grows ; do not import the real
// `@figma/plugin-typings` from tests.

import type { PLUGIN_DATA_KEYS } from "../../../src/shared/constants";

type PluginDataKey = (typeof PLUGIN_DATA_KEYS)[keyof typeof PLUGIN_DATA_KEYS];

export interface MockPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE";
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  gradientStops?: {
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }[];
  gradientTransform?: number[][];
  imageHash?: string;
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
}

export interface MockStroke {
  type: "SOLID";
  color: { r: number; g: number; b: number };
  opacity?: number;
}

export interface MockImage {
  hash: string;
  bytes: Uint8Array;
  /** Detected at registration-time so the mock can return it via getBytesAsync. */
  mimeType: string;
}

interface BaseMockNode {
  type: string;
  id: string;
  name: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  pluginData?: Record<string, string>;
}

export interface MockTextNode extends BaseMockNode {
  type: "TEXT";
  characters: string;
  fontSize?: number;
  fontWeight?: number;
  fontName?: { family: string; style: string };
  fills?: MockPaint[];
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  lineHeight?: { unit: "PIXELS" | "PERCENT" | "AUTO"; value?: number };
  letterSpacing?: { unit: "PIXELS" | "PERCENT"; value: number };
  width: number;
  height: number;
}

export interface MockRectangleNode extends BaseMockNode {
  type: "RECTANGLE";
  width: number;
  height: number;
  fills?: MockPaint[];
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
  strokes?: MockStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
}

export interface MockEllipseNode extends BaseMockNode {
  type: "ELLIPSE";
  width: number;
  height: number;
  fills?: MockPaint[];
  strokes?: MockStroke[];
  strokeWeight?: number;
}

export interface MockVectorNode extends BaseMockNode {
  type: "VECTOR";
  width: number;
  height: number;
  fills?: MockPaint[];
  strokes?: MockStroke[];
  strokeWeight?: number;
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
}

export interface MockFrameNode extends BaseMockNode {
  type: "FRAME";
  width: number;
  height: number;
  fills?: MockPaint[];
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
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
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  children: MockSceneNode[];
}

export interface MockComponentNode extends Omit<MockFrameNode, "type"> {
  type: "COMPONENT";
}

export interface MockInstanceNode extends Omit<MockFrameNode, "type"> {
  type: "INSTANCE";
  mainComponent: MockComponentNode | null;
}

export interface MockGroupNode extends BaseMockNode {
  type: "GROUP";
  width: number;
  height: number;
  children: MockSceneNode[];
}

export type MockSceneNode =
  | MockTextNode
  | MockRectangleNode
  | MockEllipseNode
  | MockVectorNode
  | MockFrameNode
  | MockComponentNode
  | MockInstanceNode
  | MockGroupNode;

interface ImageRegistry {
  byHash: Map<string, MockImage>;
}

export interface MockFigmaApi {
  currentPage: { selection: MockSceneNode[] };
  ui: {
    postMessage(msg: unknown): void;
    onmessage: ((msg: unknown) => void) | null;
  };
  showUI(html: string, options?: unknown): void;
  closePlugin(): void;
  on(event: string, handler: () => void): void;
  notify(message: string): void;
  getImageByHash(hash: string): MockImageHandle | null;
  /** Test-only — register an image so mappers can resolve fills' imageHash. */
  __registerImage(image: MockImage): void;
}

export interface MockImageHandle {
  hash: string;
  getBytesAsync(): Promise<Uint8Array>;
}

export function createMockFigma(): MockFigmaApi {
  const images: ImageRegistry = { byHash: new Map() };
  const noop = (): void => undefined;
  const api: MockFigmaApi = {
    currentPage: { selection: [] },
    ui: {
      postMessage: noop,
      onmessage: null,
    },
    showUI: noop,
    closePlugin: noop,
    on: noop,
    notify: noop,
    getImageByHash(hash) {
      const img = images.byHash.get(hash);
      if (!img) return null;
      return {
        hash,
        getBytesAsync: () => Promise.resolve(img.bytes),
      };
    },
    __registerImage(image) {
      images.byHash.set(image.hash, image);
    },
  };
  return api;
}

/** Equip every node with `getSharedPluginData` / `setSharedPluginData` for the
 *  `lumencast` namespace. The mock stores values on `node.pluginData`. */
export function equipPluginData<T extends BaseMockNode>(node: T): T {
  const host = node as unknown as {
    pluginData?: Record<string, string>;
    getSharedPluginData(ns: string, key: PluginDataKey): string;
    setSharedPluginData(ns: string, key: PluginDataKey, value: string): void;
  };
  host.getSharedPluginData = function (ns: string, key: PluginDataKey): string {
    if (ns !== "lumencast") return "";
    return this.pluginData?.[key] ?? "";
  };
  host.setSharedPluginData = function (ns: string, key: PluginDataKey, value: string): void {
    if (ns !== "lumencast") return;
    if (!this.pluginData) this.pluginData = {};
    this.pluginData[key] = value;
  };
  return node;
}

/** Recursively equip plugin-data on the node and its children. */
export function equipTree<T extends MockSceneNode>(node: T): T {
  equipPluginData(node);
  if ("children" in node) {
    for (const child of node.children) equipTree(child);
  }
  return node;
}
