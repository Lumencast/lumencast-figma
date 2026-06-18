// Representative Figma REST response sub-tree for the cover `817:3`, used by
// the mock-only import-rest tests (NO live Figma call). It mirrors the SHAPE of
// `GET /v1/files/:key/nodes` — `absoluteBoundingBox`, `fills[].imageRef`,
// `gradientHandlePositions`, `fillGeometry[].path`, omitted `visible` when true
// — and exercises every promoted family the adapter must preserve:
//   - an image-fill rectangle with node-level blend (Ruby20, hard-light),
//   - a HIDDEN rectangle (`visible: false`) — must lower to visible:false,
//   - a linear-gradient panel (handle positions → matrix),
//   - a vector with fillGeometry (the logo path),
//   - a group holding an image-fill node (the masked 3d render).
//
// Positions/sizes are taken from the ground-truth structure reference so the
// structural-diff assertions pin the real coordinates.

import type {
  RestNode,
  RestNodesResponse,
  RestImagesResponse,
} from "../../../src/import-rest/types";

export const FILE_KEY = "gtCekQzHW0eBqx4ATVRAAw";
export const NODE_ID = "817:3";

const ruby20: RestNode = {
  id: "817:84",
  name: "Ruby20-06 2",
  type: "RECTANGLE",
  absoluteBoundingBox: { x: -46, y: -30, width: 2542, height: 1424 },
  blendMode: "HARD_LIGHT",
  cornerRadius: 24,
  fills: [{ type: "IMAGE", imageRef: "ref-ruby20", scaleMode: "FILL" }],
};

const ruby20Hidden: RestNode = {
  id: "817:85",
  name: "Ruby20-06 1",
  type: "RECTANGLE",
  visible: false, // hidden in Figma — must survive as visible:false (RC2)
  absoluteBoundingBox: { x: 1781, y: 512, width: 1855, height: 1039 },
  fills: [{ type: "IMAGE", imageRef: "ref-ruby20", scaleMode: "FILL" }],
};

const gradientPanel: RestNode = {
  id: "817:200",
  name: "WP Gradient panel",
  type: "RECTANGLE",
  absoluteBoundingBox: { x: 0, y: 500, width: 800, height: 200 },
  fills: [
    {
      type: "GRADIENT_LINEAR",
      // P0 = (0,0), P1 = (0,1) main axis, P2 = (1,0) cross axis → a 90° rotate.
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 0.2, b: 0.4, a: 1 } },
        { position: 1, color: { r: 0.1, g: 0.1, b: 0.5, a: 1 } },
      ],
    },
  ],
};

const logoVector: RestNode = {
  id: "817:1163",
  name: "Vector",
  type: "VECTOR",
  absoluteBoundingBox: { x: 170, y: 308, width: 550, height: 100 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  fillGeometry: [{ path: "M0 0 H550 V100 H0 Z", windingRule: "NONZERO" }],
};

const maskGroup: RestNode = {
  id: "817:1991",
  name: "Mask group",
  type: "GROUP",
  absoluteBoundingBox: { x: 2443.9, y: 1387.9, width: 1228.9, height: 1228.9 },
  children: [
    {
      id: "817:1993",
      name: "Ellipse mask",
      type: "ELLIPSE",
      absoluteBoundingBox: { x: 2616.5, y: 1471.4, width: 1515.1, height: 1515.1 },
      fills: [{ type: "IMAGE", imageRef: "ref-ellipse", scaleMode: "FILL" }],
    },
    {
      id: "817:1994",
      name: "Wavy shape",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 2443.9, y: 1387.9, width: 1228.9, height: 1228.9 },
      blendMode: "HARD_LIGHT",
      fills: [{ type: "IMAGE", imageRef: "ref-render3d", scaleMode: "FILL" }],
    },
  ],
};

export const coverRestRoot: RestNode = {
  id: NODE_ID,
  name: "Cover",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
  children: [ruby20, ruby20Hidden, gradientPanel, logoVector, maskGroup],
};

/** A 1×1 PNG — the "real bytes" the surface resolves for every imageRef. */
export const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

export function nodesResponse(): RestNodesResponse {
  return { name: "Cover file", nodes: { [NODE_ID]: { document: coverRestRoot } } };
}

export function imagesResponse(): RestImagesResponse {
  return {
    error: false,
    status: 200,
    meta: {
      images: {
        "ref-ruby20": "https://s3-alpha-sig.figma.com/img/ruby20.png",
        "ref-ellipse": "https://s3-alpha-sig.figma.com/img/ellipse.png",
        "ref-render3d": "https://s3-alpha-sig.figma.com/img/render3d.png",
      },
    },
  };
}
