// Image-asset extraction.
//
// Mappers register Figma `imageHash` values via `registerImageHash`. The
// asset registry resolves each one to bytes via `figma.getImageByHash` (or
// the test mock), computes a content sha256, and emits the canonical asset
// path `assets/<sha256>.<ext>` referenced by the bundle.
//
// Bundles are content-addressed — even if Figma has its own dedup, we store
// by sha256 to be cross-platform stable. The bundle's `assets.allowedHosts`
// is set to ["*"] for the local sibling-directory case (see LSML §11.1) ;
// downstream tooling (Prism) replaces it with the real CDN host.

import { sha256Bytes } from "./hash";
import type { ExportedAsset } from "../main/messages";

interface FigmaImageHandle {
  hash: string;
  getBytesAsync(): Promise<Uint8Array>;
}

interface FigmaApiSurface {
  getImageByHash(hash: string): FigmaImageHandle | null;
}

export interface AssetRegistry {
  /** Returns the canonical `assets/<sha256>.<ext>` path for a Figma image hash.
   *  Multiple calls with the same hash return the same path. */
  registerImageHash(hash: string): string;
  /** Resolves all registered hashes to bytes + sha256 paths. */
  finalize(): Promise<ExportedAsset[]>;
}

interface PendingEntry {
  figmaHash: string;
  /** Path returned synchronously to the mapper. Filled in deterministically
   *  from the Figma hash so registration is order-independent ; sha256 is
   *  resolved at finalize-time and the path is rewritten in-place. */
  pendingPath: string;
  /** Resolved later. */
  resolvedPath?: string;
}

/** Pre-allocate a placeholder asset path from the Figma hash so the bundle
 *  can be assembled before bytes are fetched. We use the figma hash itself
 *  as the placeholder ; finalize() rewrites paths to sha256-based ones. */
const ASSET_DIR = "assets";

interface CreateOptions {
  api: FigmaApiSurface;
  /** When true (the default), placeholder paths are rewritten in the bundle
   *  by `applyAssetPathRewrites` after finalize. When false, the registry
   *  emits sha256-based paths up front (only safe if bytes can be fetched
   *  synchronously — currently never). */
  rewriteOnFinalize?: boolean;
}

export interface CreatedRegistry extends AssetRegistry {
  /** Map of placeholder path → final sha256 path, populated by `finalize`.
   *  The bundle assembler walks the tree and rewrites src fields. */
  rewrites(): Record<string, string>;
}

export function createAssetRegistry(opts: CreateOptions): CreatedRegistry {
  const byHash = new Map<string, PendingEntry>();

  const reg: CreatedRegistry = {
    registerImageHash(hash) {
      let entry = byHash.get(hash);
      if (!entry) {
        const pendingPath = `${ASSET_DIR}/${hash}`;
        entry = { figmaHash: hash, pendingPath };
        byHash.set(hash, entry);
      }
      return entry.pendingPath;
    },

    rewrites() {
      const out: Record<string, string> = {};
      for (const e of byHash.values()) {
        if (e.resolvedPath) out[e.pendingPath] = e.resolvedPath;
      }
      return out;
    },

    async finalize(): Promise<ExportedAsset[]> {
      const out: ExportedAsset[] = [];
      for (const entry of byHash.values()) {
        const handle = opts.api.getImageByHash(entry.figmaHash);
        if (!handle) {
          // Skip — caller should warn via mapping context.
          continue;
        }
        const bytes = await handle.getBytesAsync();
        const ext = sniffImageExtension(bytes);
        const hash = await hashBytesHex(bytes);
        const finalName = `${ASSET_DIR}/${hash}.${ext}`;
        entry.resolvedPath = finalName;
        out.push({
          name: finalName,
          mimeType: extToMime(ext),
          bytes,
        });
      }
      return out;
    },
  };
  return reg;
}

/** Walk an LSML primitive tree and rewrite `src` paths from placeholder to
 *  sha256-based forms. Mutates in place — returns the same node for chain. */
export function applyAssetPathRewrites<T extends object>(
  node: T,
  rewrites: Record<string, string>,
): T {
  walk(node, rewrites);
  return node;
}

function walk(value: unknown, rewrites: Record<string, string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, rewrites);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string" && rewrites[v]) {
      obj[key] = rewrites[v];
    } else if (v && typeof v === "object") {
      walk(v, rewrites);
    }
  }
}

async function hashBytesHex(bytes: Uint8Array): Promise<string> {
  const hash = await sha256Bytes(bytes);
  let s = "";
  for (const b of hash) {
    s += b.toString(16).padStart(2, "0");
  }
  return s;
}

/** Sniff PNG / JPEG / GIF / WebP magic bytes. Falls back to "bin" for the
 *  unknown formats LSML doesn't currently advertise. */
function sniffImageExtension(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x3f && bytes[2] === 0x78) {
    return "svg";
  }
  return "bin";
}

function extToMime(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
