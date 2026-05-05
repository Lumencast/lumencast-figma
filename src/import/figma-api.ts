// Surface of the Figma plugin API the import pipeline calls.
//
// Production : `figma` itself implements this surface (TextNode, FrameNode,
// etc. via figma.createText / createFrame / createRectangle).
// Tests : a lightweight in-memory mock at tests/fixtures/figma/import-mock.ts.
//
// We type only the methods + setters used by the per-primitive builders.

export interface ImportRGB {
  r: number;
  g: number;
  b: number;
}

export interface ImportRGBA extends ImportRGB {
  a: number;
}

export type ImportPaint =
  | { type: "SOLID"; visible?: boolean; opacity?: number; color: ImportRGB }
  | {
      type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL";
      visible?: boolean;
      opacity?: number;
      gradientStops: { position: number; color: ImportRGBA }[];
      gradientTransform: number[][];
    }
  | {
      type: "IMAGE";
      visible?: boolean;
      opacity?: number;
      imageHash: string;
      scaleMode: "FILL" | "FIT" | "CROP" | "TILE";
    };

export interface ImportStroke {
  type: "SOLID";
  color: ImportRGB;
  opacity?: number;
}

/** Basic surface every created node exposes. */
export interface ImportBaseNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  setSharedPluginData(namespace: string, key: string, value: string): void;
}

export interface ImportTextNode extends ImportBaseNode {
  type: "TEXT";
  characters: string;
  fontSize?: number;
  fontWeight?: number;
  fills?: ImportPaint[];
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  resize(w: number, h: number): void;
  /** Range-styling setters used to restore multi-style / multi-color text
   *  captured under `metadata.figma.textSegments[]`. Marked optional so
   *  the legacy mock surface (which doesn't implement them) still compiles
   *  — the builder calls them defensively via `try { ... } catch {}`. */
  setRangeFontName?(start: number, end: number, fontName: { family: string; style: string }): void;
  setRangeFontSize?(start: number, end: number, value: number): void;
  setRangeFills?(start: number, end: number, paints: ImportPaint[]): void;
  setRangeTextCase?(start: number, end: number, value: string): void;
  setRangeTextDecoration?(start: number, end: number, value: string): void;
  setRangeLetterSpacing?(start: number, end: number, value: { unit: string; value: number }): void;
  setRangeLineHeight?(start: number, end: number, value: { unit: string; value?: number }): void;
  setRangeHyperlink?(start: number, end: number, value: { type: "URL"; value: string } | null): void;
}

export interface ImportShapeNode extends ImportBaseNode {
  type: "RECTANGLE" | "ELLIPSE" | "VECTOR";
  fills?: ImportPaint[];
  strokes?: ImportStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
  vectorPaths?: { data: string; windingRule: "NONZERO" | "EVENODD" }[];
  resize(w: number, h: number): void;
}

export interface ImportFrameNode extends ImportBaseNode {
  type: "FRAME";
  fills?: ImportPaint[];
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
  x?: number;
  y?: number;
  resize(w: number, h: number): void;
  appendChild(child: ImportBaseNode): void;
}

export interface ImportInstanceNode extends ImportBaseNode {
  type: "INSTANCE";
  x?: number;
  y?: number;
  resize(w: number, h: number): void;
}

/** A handle to a re-imported image (figma.createImage's return value). */
export interface ImportImageHandle {
  hash: string;
}

export interface FontReference {
  family: string;
  style: string;
}

export interface ImportFigmaApi {
  createText(): ImportTextNode;
  createRectangle(): ImportShapeNode;
  createEllipse(): ImportShapeNode;
  createVector(): ImportShapeNode;
  createFrame(): ImportFrameNode;
  /** Used to mount LSML `instance` primitives. We don't have a real Figma
   *  component to instantiate (the source bundle is logically remote), so
   *  the importer creates a placeholder FRAME with plugin data identifying
   *  it as an LSML instance reference. */
  createInstancePlaceholder(): ImportInstanceNode;
  /** Wraps figma.createImage(bytes). Returns a handle whose `.hash` is the
   *  Figma-side image hash, NOT the LSML sha256. */
  createImage(bytes: Uint8Array): ImportImageHandle;
  /** Wraps `figma.loadFontAsync`. MUST be awaited before setting
   *  `text.characters` on any TextNode that uses this font ; otherwise
   *  Figma throws `Cannot write to node with unloaded font "<family> <style>"`. */
  loadFontAsync(font: FontReference): Promise<void>;
  /** The current page's append entry-point (figma.currentPage.appendChild). */
  appendToPage(node: ImportBaseNode): void;
  /** Wraps `figma.group(nodes, parent, index?)`. Used by the post-build
   *  conversion pass to turn frames marked `metadata.figma.sourceType=GROUP`
   *  back into real Figma GroupNodes. Children must already be in the
   *  document ; figma.group MOVES them into a fresh group and inserts the
   *  group at the given index of `parent`. */
  group(
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
  ): ImportBaseNode;
  /** Wraps `figma.union(nodes, parent, index?)`. Same node-moving semantics
   *  as `figma.group` but produces a real `BooleanOperationNode` with the
   *  matching `booleanOperation`. Used by the flat-then-wrap path when the
   *  source was a `BOOLEAN_OPERATION` with that flavour. */
  union(
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
  ): ImportBaseNode;
  subtract(
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
  ): ImportBaseNode;
  intersect(
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
  ): ImportBaseNode;
  exclude(
    nodes: ImportBaseNode[],
    parent: ImportBaseNode & { appendChild(child: ImportBaseNode): void },
    index?: number,
  ): ImportBaseNode;
}
