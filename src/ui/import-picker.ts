// File-API-based picker for `.lsml` + sibling `assets/<sha256>.<ext>`.
// The plugin sandbox can't read files itself ; the iframe UI does it via a
// hidden <input type="file" multiple>. The user selects the .lsml plus all
// the asset files in one pick.

export interface PickedImport {
  /** UTF-8 contents of the .lsml file. */
  lsmlBytes: string;
  /** `assets/<sha256>.<ext>` → bytes. */
  assets: { path: string; bytes: Uint8Array }[];
}

/** Open a file picker, return the selected .lsml + matching asset bytes.
 *  Resolves null when the user cancels. */
export async function pickImport(): Promise<PickedImport | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".lsml,application/lsml+json,.json,image/*";
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
          const lsml = files.find((f) => /\.lsml(\.json)?$|\.json$/i.test(f.name));
          if (!lsml) {
            resolve(null);
            return;
          }
          const lsmlText = await lsml.text();
          const assetFiles = files.filter((f) => f !== lsml);
          const assets = await Promise.all(
            assetFiles.map(async (f) => {
              const bytes = new Uint8Array(await f.arrayBuffer());
              return { path: `assets/${f.name}`, bytes };
            }),
          );
          resolve({ lsmlBytes: lsmlText, assets });
        } finally {
          input.remove();
        }
      },
      { once: true },
    );

    input.click();
  });
}
