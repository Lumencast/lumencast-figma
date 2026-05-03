// Public entry point of the export pipeline.
//
// Use `runExport({ api, root })` from `src/main/index.ts` — it builds the
// bundle, validates it, and returns the result the UI needs to write the
// .lsml + assets/ to disk.

import type { ExportResult, PluginWarning } from "../main/messages";
import { buildBundle } from "./bundle";
import { validateBundle } from "./validate";

interface FigmaApiSurface {
  getImageByHash(hash: string): { hash: string; getBytesAsync(): Promise<Uint8Array> } | null;
}

interface RootNode {
  type: string;
  id: string;
  name: string;
  width?: number;
  height?: number;
  children?: unknown[];
}

export interface RunExportOptions {
  api: FigmaApiSurface;
  root: RootNode;
  sceneId?: string;
}

export interface RunExportError extends Error {
  code: "BUNDLE_VALIDATION_FAILED";
  errors: { path: string; message: string }[];
}

export async function runExport(
  opts: RunExportOptions,
): Promise<ExportResult & { canonical: string }> {
  const built = await buildBundle(opts);

  const v = validateBundle(built.bundle);
  if (!v.ok) {
    const e = new Error("Bundle validation failed") as RunExportError;
    e.code = "BUNDLE_VALIDATION_FAILED";
    e.errors = v.errors.map((err) => ({ path: err.path, message: err.message }));
    throw e;
  }

  const result: ExportResult & { canonical: string } = {
    bundle: built.bundle,
    assets: built.assets,
    warnings: built.warnings as PluginWarning[],
    hash: built.sceneVersion,
    canonical: built.canonical,
  };
  return result;
}

export { buildBundle } from "./bundle";
export { validateBundle } from "./validate";
export { canonicalize, sealBundle } from "./canonicalize";
