// Adapter from Figma's plugin API to the import pipeline's ImportFigmaApi
// surface. Only the methods used by builders are mapped ; the rest is
// unimplemented (and shouldn't be called from the import path).

import type {
  ImportBaseNode,
  ImportFigmaApi,
  ImportFrameNode,
  ImportImageHandle,
  ImportInstanceNode,
  ImportShapeNode,
  ImportTextNode,
} from "../import/figma-api";

/** Cast a Figma node into the pipeline's import surface. The shapes overlap
 *  on the small subset of fields builders actually touch — the cast is safe
 *  because both the production Figma API and our type subset agree on those
 *  field names. Field-by-field. */
function asTextNode(n: TextNode): ImportTextNode {
  return n as unknown as ImportTextNode;
}
function asShapeNode<T extends RectangleNode | EllipseNode | VectorNode>(n: T): ImportShapeNode {
  return n as unknown as ImportShapeNode;
}
function asFrameNode(n: FrameNode): ImportFrameNode {
  return n as unknown as ImportFrameNode;
}
function asInstanceNode(n: FrameNode): ImportInstanceNode {
  // We use a FRAME with INSTANCE-shaped plugin data as the placeholder for
  // LSML §4.9 instances — see src/import/builders/instance.ts.
  return n as unknown as ImportInstanceNode;
}

export function createFigmaImportAdapter(): ImportFigmaApi {
  return {
    createText: () => asTextNode(figma.createText()),
    createRectangle: () => asShapeNode(figma.createRectangle()),
    createEllipse: () => asShapeNode(figma.createEllipse()),
    createVector: () => asShapeNode(figma.createVector()),
    createFrame: () => asFrameNode(figma.createFrame()),
    createInstancePlaceholder: () => {
      // Real Figma `INSTANCE` nodes can only be created via cloning a
      // COMPONENT. For LSML §4.9 instances we don't have a local COMPONENT
      // available — we use a FRAME with `lumencast.instance.*` plugin data
      // as the placeholder. The export-side mapper recognises the marker
      // and emits `kind: "instance"`.
      const frame = figma.createFrame();
      frame.name = "Imported Instance";
      return asInstanceNode(frame);
    },
    createImage: (bytes: Uint8Array): ImportImageHandle => {
      const img = figma.createImage(bytes);
      return { hash: img.hash };
    },
    loadFontAsync: (font) => figma.loadFontAsync(font),
    appendToPage: (node: ImportBaseNode) => {
      figma.currentPage.appendChild(node as unknown as SceneNode);
    },
  };
}
