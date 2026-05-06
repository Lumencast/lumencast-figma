// `.lsmlz` archive packer / unpacker.
//
// `.lsmlz` is a ZIP archive containing :
//
//     <scene_id>.lsml         (UTF-8, no BOM ; the canonical bundle)
//     assets/<hash>.<ext>     (one entry per image referenced by the bundle)
//
// No manifest. The `.lsml` is self-describing — `scene_id`, `scene_version`,
// `assets.allowedHosts`, and the layout's `bind.src` references all live
// inside the bundle JSON. The archive is purely a transport / storage
// container so a single drag-and-drop carries the whole scene, including
// content-addressed images referenced by relative paths.
//
// Media type : `application/lsml+zip` (proposed ; aligns with
// `application/lsml+json` for the bare bundle per LSML §18.2).
//
// Compression : assets use DEFLATE (PNGs are already compressed, savings
// minimal but gz costs nothing) ; the `.lsml` JSON also DEFLATEs (5–15×
// per LSML §18.7). Caller-side perf is not a concern for typical scene
// sizes (<5 MB total).

import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";

import { LSML_FILE_EXTENSION } from "~shared/constants";

export interface ArchiveContents {
  /** The .lsml bundle bytes (UTF-8 string). */
  lsmlBytes: string;
  /** Per-asset bytes — keyed by the relative path inside the archive
   *  (`assets/<hash>.<ext>`). The bundle's `bind.src` resolves to these. */
  assets: { path: string; bytes: Uint8Array }[];
}

export interface ExportInput {
  sceneId: string;
  /** Canonical UTF-8 bytes of the sealed bundle (LSML §3.1 + §3.2). */
  canonical: string;
  /** Asset payloads emitted by the export pipeline. */
  assets: { name: string; mimeType: string; bytes: Uint8Array }[];
  /** Optional diagnostic artefacts. When present, written under
   *  `_debug/` inside the archive. Runtimes / re-importers MUST ignore
   *  the `_debug/` prefix (it's not part of the LSML 1.1 bundle spec). */
  debugArtefacts?: {
    /** Recursive snapshot of the source SceneNode tree. */
    rawFigma: string;
    /** Per-node decision trace from the walker. */
    mappingTrace: string;
  };
}

/** Pack an export into a single `.lsmlz` ZIP archive. Returns a Blob ready
 *  for download. */
export function packArchive(input: ExportInput): Blob {
  const lsmlName = `${input.sceneId}${LSML_FILE_EXTENSION}`;
  const entries: Record<string, Uint8Array> = {};
  entries[lsmlName] = strToU8(input.canonical);
  for (const asset of input.assets) {
    // asset.name already starts with `assets/` — keep as-is so the bundle's
    // relative refs resolve unchanged after unpack.
    entries[asset.name] = asset.bytes;
  }
  if (input.debugArtefacts) {
    entries["_debug/raw-figma.json"] = strToU8(input.debugArtefacts.rawFigma);
    entries["_debug/mapping-trace.json"] = strToU8(input.debugArtefacts.mappingTrace);
  }
  const zipped = zipSync(entries, { level: 6 });
  // Wrap in a fresh Uint8Array (with a plain ArrayBuffer backing) so the
  // Blob constructor's strict BlobPart typing accepts it.
  const blobBytes = new Uint8Array(zipped.length);
  blobBytes.set(zipped);
  return new Blob([blobBytes.buffer], { type: "application/lsml+zip" });
}

/** Unpack a `.lsmlz` archive into the raw inputs the import pipeline needs. */
export function unpackArchive(bytes: Uint8Array): ArchiveContents {
  const entries = unzipSync(bytes);

  // Locate the .lsml file. The convention is `<scene_id>.lsml` at the root,
  // but we accept any single `.lsml` / `.lsml.json` / `.json` entry to stay
  // permissive on hand-crafted archives.
  let lsmlBytes: string | null = null;
  let lsmlPath: string | null = null;
  for (const [path, content] of Object.entries(entries)) {
    if (/\.lsml$|\.lsml\.json$/i.test(path) && !path.startsWith("assets/")) {
      lsmlBytes = strFromU8(content);
      lsmlPath = path;
      break;
    }
  }
  if (lsmlBytes === null) {
    // Fall back : single .json file at the root.
    for (const [path, content] of Object.entries(entries)) {
      if (path.endsWith(".json") && !path.startsWith("assets/")) {
        lsmlBytes = strFromU8(content);
        lsmlPath = path;
        break;
      }
    }
  }
  if (lsmlBytes === null) {
    throw new Error(
      "Archive does not contain an .lsml entry — expected `<scene_id>.lsml` at the root.",
    );
  }

  const assets: { path: string; bytes: Uint8Array }[] = [];
  for (const [path, content] of Object.entries(entries)) {
    if (path === lsmlPath) continue;
    if (path.startsWith("assets/")) {
      assets.push({ path, bytes: content });
    }
  }

  return { lsmlBytes, assets };
}

/** Quick sniff to detect a `.lsmlz` (ZIP) vs a bare `.lsml` (JSON) — checks
 *  the ZIP magic-byte header `PK\x03\x04`. The `.lsml` JSON always starts
 *  with `{` (per LSML §18.5), so the two are unambiguous. */
export function isArchive(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
