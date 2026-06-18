// REST import entry — pull a Figma frame and produce a genuine LSML 1.2 bundle.
//
// `importFigmaFrame(fileKey, nodeId)`:
//   1. pulls the document subtree via the REST client (structure),
//   2. resolves the file's imageRef → CDN URL map,
//   3. adapts the REST tree to the main-thread shape `src/mapping` consumes and
//      wires a REST-backed `getImageByHash` surface,
//   4. runs the UNCHANGED export pipeline `buildBundle` — which maps the tree
//      and resolves the real image bytes through the existing gated asset path
//      (raster-allowlist / SVG sanitizer #N) — yielding the genuine bundle.
//
// This replaces the toy fixture: the bundle carries the full structure and the
// real bytes, not substituted swatches (ADR ZabCanvas 002 §3.3, RC1).

import { buildBundle, type BuildBundleResult } from "../export/bundle";
import { adaptNode, createRestImageSurface, type AdaptedNode } from "./adapter";
import { createFigmaRestClient, type CreateClientOptions, type FigmaRestClient } from "./client";

export interface ImportFigmaFrameOptions extends CreateClientOptions {
  /** Inject a pre-built client (tests). When omitted, one is created from the
   *  env token + global fetch. */
  client?: FigmaRestClient;
  /** Override scene id ; defaults to the frame name slug. */
  sceneId?: string;
}

export interface ImportFigmaFrameResult extends BuildBundleResult {
  /** The adapted (main-thread-shaped) root — exposed for the structural-diff
   *  harness (RC2), which compares it against the ground-truth reference. */
  adaptedRoot: AdaptedNode;
}

export async function importFigmaFrame(
  fileKey: string,
  nodeId: string,
  opts: ImportFigmaFrameOptions = {},
): Promise<ImportFigmaFrameResult> {
  const client = opts.client ?? createFigmaRestClient(opts);

  // 1 + 2. Structure and the imageRef → URL map, in parallel.
  const [restRoot, imageMap] = await Promise.all([
    client.getNode(fileKey, nodeId),
    client.getImageFills(fileKey),
  ]);

  // 3. Adapt REST → mapper surface.
  const adaptedRoot = adaptNode(restRoot);
  const api = createRestImageSurface(client, imageMap);

  // 4. Run the unchanged export pipeline. `buildBundle` maps the tree and
  // resolves image bytes through the registry's gated finalize path.
  const built = await buildBundle({
    api,
    root: adaptedRoot as unknown as Parameters<typeof buildBundle>[0]["root"],
    ...(opts.sceneId !== undefined ? { sceneId: opts.sceneId } : {}),
  });

  return { ...built, adaptedRoot };
}

export { createFigmaRestClient, FigmaRestError } from "./client";
export { adaptNode, createRestImageSurface } from "./adapter";
export type { AdaptedNode } from "./adapter";
export type { RestNode, RestNodesResponse, RestImagesResponse } from "./types";
