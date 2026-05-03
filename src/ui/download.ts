// Trigger browser-side downloads of the produced bundle.
//
// The plugin sandbox can't write files. The iframe UI does it instead via
// anchor + Blob. v0.1.0 emitted the `.lsml` and each asset as separate
// downloads ; v0.1.2 packs everything into a single self-contained
// `.lsmlz` ZIP archive (LSML scene + sibling `assets/` directory).
// One file = one drag, one re-import, one signed artefact.

import { packArchive } from "./archive";
import { LSML_ARCHIVE_EXTENSION } from "~shared/constants";
import type { ExportResult } from "../main/messages";

export interface DownloadOptions {
  /** Stable scene id — used to derive both the archive filename and the
   *  internal `<scene_id>.lsml` entry. */
  sceneId: string;
  /** UTF-8 canonical bytes of the sealed bundle. */
  bundleBytes: string;
  assets: ExportResult["assets"];
}

export function downloadExport(opts: DownloadOptions): void {
  const archive = packArchive({
    sceneId: opts.sceneId,
    canonical: opts.bundleBytes,
    assets: opts.assets.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      // `a.bytes` arrives via postMessage as Uint8Array — wrap in a fresh
      // copy so fflate sees a plain ArrayBuffer-backed view.
      bytes: new Uint8Array(a.bytes),
    })),
  });
  triggerBlobDownload(archive, `${opts.sceneId}${LSML_ARCHIVE_EXTENSION}`);
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
