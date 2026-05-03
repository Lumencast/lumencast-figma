// File-API picker for `.lsmlz` archives or loose `.lsml` + sibling assets.
//
// The plugin sandbox can't read files. The iframe UI does it via a hidden
// <input type="file" multiple>. v0.1.2 onwards, the picker prefers a single
// `.lsmlz` archive (one drag, one file) but stays permissive on the legacy
// flow (pick the `.lsml` + every asset image manually) for compatibility
// with bundles produced by older plugin versions or hand-authored.

import { isArchive, unpackArchive } from "./archive";

export interface PickedImport {
  /** UTF-8 contents of the .lsml bundle. */
  lsmlBytes: string;
  /** `assets/<hash>.<ext>` → bytes. */
  assets: { path: string; bytes: Uint8Array }[];
}

/** Open a file picker, return the selected `.lsmlz` (preferred) or
 *  loose `.lsml` + asset files. Resolves null when the user cancels. */
export async function pickImport(): Promise<PickedImport | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".lsmlz,.lsml,application/lsml+zip,application/lsml+json,.json,image/*";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener(
      "change",
      async () => {
        try {
          const files = Array.from(input.files ?? []);
          if (files.length === 0) {
            resolve(null);
            return;
          }

          // Prefer `.lsmlz` if present — single-file archive flow.
          const archiveFile = files.find((f) => /\.lsmlz$/i.test(f.name));
          if (archiveFile) {
            const buf = new Uint8Array(await archiveFile.arrayBuffer());
            if (!isArchive(buf)) {
              reject(new Error(`${archiveFile.name} does not have a valid ZIP header.`));
              return;
            }
            resolve(unpackArchive(buf));
            return;
          }

          // Legacy / hand-authored flow : a single `.lsml` (or `.json`) file
          // plus zero-or-more sibling assets.
          const lsml = files.find((f) => /\.lsml(\.json)?$|\.json$/i.test(f.name));
          if (!lsml) {
            reject(
              new Error(
                "No .lsmlz archive or .lsml file selected. Pick a single .lsmlz, or a .lsml plus its sibling images.",
              ),
            );
            return;
          }
          // If the picked file is actually a zipped artefact mis-extensioned
          // (some users rename), peek the magic bytes and unpack it.
          const lsmlBuf = new Uint8Array(await lsml.arrayBuffer());
          if (isArchive(lsmlBuf)) {
            resolve(unpackArchive(lsmlBuf));
            return;
          }

          const lsmlText = new TextDecoder("utf-8").decode(lsmlBuf);
          const assetFiles = files.filter((f) => f !== lsml);
          const assets = await Promise.all(
            assetFiles.map(async (f) => {
              const bytes = new Uint8Array(await f.arrayBuffer());
              return { path: `assets/${f.name}`, bytes };
            }),
          );
          resolve({ lsmlBytes: lsmlText, assets });
        } catch (err) {
          reject(err);
        } finally {
          input.remove();
        }
      },
      { once: true },
    );

    input.click();
  });
}
