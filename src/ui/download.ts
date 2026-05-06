// Trigger browser-side downloads of the produced bundle.
//
// The plugin sandbox can't write files. The iframe UI does it instead via
// anchor + Blob. v0.1.0 emitted the `.lsml` and each asset as separate
// downloads ; v0.1.2 packs everything into a single self-contained
// `.lsmlz` ZIP archive (LSMLZ/1 spec — `lumencast-protocol/spec/LSMLZ-1.md`).
// One file = one drag, one re-import, one signed artefact.

import {
  packArchive,
  LSMLZ_FILE_EXTENSION,
  LSMLZ_MEDIA_TYPE,
} from "@lumencast/archive";
import type { ExportResult } from "../main/messages";

export interface DownloadOptions {
  /** Stable scene id — used to derive both the archive filename and the
   *  internal `<scene_id>.lsml` entry. */
  sceneId: string;
  /** UTF-8 canonical bytes of the sealed bundle. */
  bundleBytes: string;
  assets: ExportResult["assets"];
  /** Optional authoring diagnostics (raw Figma snapshot, mapping trace).
   *  Written under `_debug/` per LSMLZ §3.3. Readers ignore this prefix. */
  debug?: { rawFigma?: string; mappingTrace?: string };
}

export function downloadExport(opts: DownloadOptions): void {
  const debug = opts.debug
    ? Object.fromEntries(
        Object.entries({
          "raw-figma.json": opts.debug.rawFigma,
          "mapping-trace.json": opts.debug.mappingTrace,
        }).filter(([, v]) => v !== undefined) as [string, string][],
      )
    : undefined;
  const bytes = packArchive({
    sceneId: opts.sceneId,
    canonical: opts.bundleBytes,
    assets: opts.assets.map((a) => ({
      // The mapping side already produced `assets/<hash>.<ext>` paths in
      // `a.name` (it's the bundle-relative ref, not the local filename).
      // `a.bytes` arrives via postMessage as Uint8Array — wrap in a fresh
      // copy so the underlying ArrayBuffer is plain (Figma host-objects
      // can backfill exotic backing buffers).
      path: a.name,
      bytes: new Uint8Array(a.bytes),
    })),
    ...(debug && Object.keys(debug).length > 0 ? { debug } : {}),
  });
  // Wrap in a Blob with the canonical LSMLZ media type for the download.
  // Slice() guarantees a fresh ArrayBuffer backing for the Blob constructor.
  const blob = new Blob([bytes.slice().buffer], { type: LSMLZ_MEDIA_TYPE });
  triggerBlobDownload(blob, `${opts.sceneId}${LSMLZ_FILE_EXTENSION}`);
}

/** Download an arbitrary text payload — used for the post-import trace
 *  artefact (`<scene>-import-trace.json`). Same anchor-click pattern as
 *  the .lsmlz download ; the iframe owns DOM affordances the plugin
 *  sandbox lacks. */
export function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  triggerBlobDownload(blob, filename);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Slight defer so the click registers before revoke ; some browsers cancel
  // the download otherwise.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
