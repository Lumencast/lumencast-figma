// Trigger browser-side downloads of the produced bundle + assets.
//
// The plugin sandbox can't write files. The iframe UI does it instead via
// anchor + Blob. For the .lsml bundle and each asset, we synthesise a
// download click sequentially. Modern browsers throttle multiple downloads
// from a single user gesture ; we preserve the gesture by chaining requests
// from the click handler directly.

import type { ExportResult } from "../main/messages";

export interface DownloadOptions {
  /** Filename for the .lsml bundle, e.g. `scoreboard.lsml`. */
  filename: string;
  /** UTF-8 canonical bytes of the bundle. */
  bundleBytes: string;
  assets: ExportResult["assets"];
}

export function downloadExport(opts: DownloadOptions): void {
  // Bundle first.
  triggerBlobDownload(
    new Blob([opts.bundleBytes], { type: "application/lsml+json" }),
    opts.filename,
  );
  // Each asset under assets/<sha256>.<ext>. The browser saves to the user's
  // default download dir ; the user moves them next to the .lsml manually for
  // v0.1. v0.2 will switch to a single .zip download.
  for (const asset of opts.assets) {
    triggerBlobDownload(
      // The asset.bytes comes via postMessage as Uint8Array — wrap it in a
      // fresh ArrayBuffer copy to avoid potential transfer issues.
      new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }),
      asset.name.replace(/^assets\//, ""),
    );
  }
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
