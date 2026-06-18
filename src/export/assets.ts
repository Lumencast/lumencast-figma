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

import type { ExportedAsset } from "../main/messages";
import type { ShapePrimitive } from "~shared/lsml-types";
import { bytesToDataUri } from "./base64";
import { emitSanitizedSvgDataUri, looksLikeSvg, sanitizeSvg, SanitizeError } from "./svg-sanitize";
import {
  decomposeSvg,
  DecomposeError,
  fitDecomposedToBox,
  type DecomposedSvg,
} from "./svg-decompose";

interface FigmaImageHandle {
  hash: string;
  getBytesAsync(): Promise<Uint8Array>;
}

/** Raster MIME allowlist for the `data:` URI path. Bounded to formats a CEF
 *  host renders as an image and that carry no executable surface. SVG is
 *  deliberately excluded: an inline `data:image/svg+xml` can carry
 *  `<script>` / event-handler attributes that execute in the host (Bastion
 *  VETO, XSS). The downstream `data:image/*` gate does NOT save us — `data:`
 *  is host-less and `image/svg+xml` matches `image/*` — so the bound is
 *  enforced HERE, at the source, before any `data:` URI is emitted. */
const RASTER_DATA_URI_EXTS = new Set(["png", "jpg", "gif", "webp"]);

interface FigmaApiSurface {
  getImageByHash(hash: string): FigmaImageHandle | null;
}

export interface AssetRegistry {
  /** Returns the canonical `assets/<sha256>.<ext>` path for a Figma image hash.
   *  Multiple calls with the same hash return the same path. */
  registerImageHash(hash: string): string;
  /** Returns a placeholder that `finalize` rewrites to a `data:image/<mime>;
   *  base64,<bytes>` URI. Used for 1.2 image-fill / mask-image `src`, where
   *  the AssetUrl schema (LSML 1.2 §5) forbids a relative `assets/<sha>` path
   *  and only admits `https:` or a bounded `data:image/*` payload. A data:
   *  URI carries no remote host, so `assets.allowedHosts` stays `[]`-coherent
   *  (Bastion T6). The same hash also registered via `registerImageHash`
   *  (e.g. an image-primitive) keeps its local `assets/<sha>` path — the two
   *  placeholders are distinct. */
  registerImageHashAsDataUri(hash: string): string;
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

interface PendingDataUriEntry {
  figmaHash: string;
  /** Placeholder returned synchronously to the mapper. Rewritten to a
   *  `data:image/<mime>;base64,<bytes>` URI at finalize-time. */
  placeholder: string;
  /** Resolved later. */
  resolvedDataUri?: string;
  /** N1 (ADR 002 #M): a decomposable SVG asset resolves NOT to a data: URI but
   *  to native LSML geometry — the referencing image-fill/mask is replaced by
   *  these shapes (0 data:URI, 0 surface). Mutually exclusive with
   *  `resolvedDataUri`: a given SVG either decomposes (N1) or is sanitized (N2),
   *  never both (A3.4). */
  resolvedDecompose?: DecomposedSvg;
}

/** Pre-allocate a placeholder asset path from the Figma hash so the bundle
 *  can be assembled before bytes are fetched. We use the figma hash itself
 *  as the placeholder ; finalize() rewrites paths to sha256-based ones. */
const ASSET_DIR = "assets";

/** Distinct namespace for data-URI placeholders so the rewrite walker never
 *  confuses an image-fill `src` (→ data:) with an image-primitive `assets/`
 *  path that happens to share the same Figma hash. */
const DATA_URI_PREFIX = "__asset-data:";

interface CreateOptions {
  api: FigmaApiSurface;
  /** Optional sink for omit-on-miss diagnostics. Called when a `data:` URI
   *  asset is rejected (non-raster MIME, or no fetchable bytes) so the
   *  caller can surface a warning. The referencing fill/mask is dropped.
   *  `severity` defaults to "warn"; an SVG that could not be sanitized is
   *  surfaced as "error" (Bastion #N §7) to feed the authoring gate. */
  onDiagnostic?: (code: string, message: string, severity?: "warn" | "error") => void;
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
  /** Map of data-URI placeholder → decomposed native geometry (N1, ADR 002
   *  #M), populated by `finalize`. The walker replaces the referencing
   *  image-fill/mask with these shapes (0 data:URI). A placeholder present
   *  here is NEVER present in `rewrites` — N1 and N2 are mutually exclusive. */
  decompositions(): Record<string, DecomposedSvg>;
}

export function createAssetRegistry(opts: CreateOptions): CreatedRegistry {
  const byHash = new Map<string, PendingEntry>();
  const dataUriByHash = new Map<string, PendingDataUriEntry>();

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

    registerImageHashAsDataUri(hash) {
      let entry = dataUriByHash.get(hash);
      if (!entry) {
        const placeholder = `${DATA_URI_PREFIX}${hash}`;
        entry = { figmaHash: hash, placeholder };
        dataUriByHash.set(hash, entry);
      }
      return entry.placeholder;
    },

    rewrites() {
      const out: Record<string, string> = {};
      for (const e of byHash.values()) {
        if (e.resolvedPath) out[e.pendingPath] = e.resolvedPath;
      }
      for (const e of dataUriByHash.values()) {
        if (e.resolvedDataUri) out[e.placeholder] = e.resolvedDataUri;
      }
      return out;
    },

    decompositions() {
      const out: Record<string, DecomposedSvg> = {};
      for (const e of dataUriByHash.values()) {
        if (e.resolvedDecompose) out[e.placeholder] = e.resolvedDecompose;
      }
      return out;
    },

    async finalize(): Promise<ExportedAsset[]> {
      // Resolve data-URI image-fill / mask sources : fetch the bytes once,
      // inline as `data:image/<mime>;base64,…`. Runs in parallel with the
      // local-asset path resolution below.
      await Promise.all(
        Array.from(dataUriByHash.values()).map(async (entry) => {
          const handle = opts.api.getImageByHash(entry.figmaHash);
          if (!handle) return;
          const bytes = await handle.getBytesAsync();
          // SVG path. The choke-point order is N1 → N2 → error (ADR 002 A3.4),
          // gravé here:
          //
          //   N1 (#M, PREFERRED): a purely geometric SVG is DECOMPOSED into
          //   native LSML `shape` primitives — 0 image, 0 `data:` URI, 0 SVG
          //   markup, 0 surface. The referencing image-fill/mask is replaced by
          //   the geometry at rewrite time (see `applyAssetPathRewrites`).
          //
          //   N2 (#N, FALLBACK): if a single element/attribute is not
          //   decomposable (text, filter, raster, …), N1 throws and we fall
          //   through to the geometry-only sanitizer, which parses-then-rebuilds
          //   a typed allowlisted document and re-embeds it via the SINGLE
          //   emitter `emitSanitizedSvgDataUri` (the only path to
          //   `data:image/svg+xml`). N1 NEVER produces a partial decomposition:
          //   it is all-or-nothing, so the SVG is either fully native or fully
          //   sanitized — never a half-render (A3.4).
          //
          //   ERROR: if BOTH N1 and N2 fail (DTD/entity, parse failure, empty
          //   rebuild, DoS bound), the asset is OMITTED with an `error`-severity
          //   diagnostic (§7) so the authoring gate (#I) refuses the bundle —
          //   never a silent drop, never a raw-byte SVG data: URI.
          if (looksLikeSvg(bytes)) {
            let decomposed: DecomposedSvg | null = null;
            try {
              decomposed = decomposeSvg(bytes); // N1
            } catch (n1Err) {
              if (!(n1Err instanceof DecomposeError)) throw n1Err;
              // N1 declined → fall through to N2 (sanitizer).
            }
            if (decomposed) entry.resolvedDecompose = decomposed;
            // N2 (sanitize) is ALSO computed when N1 succeeds, but ONLY to back
            // the mask channel: the shape-mask ref channel (#K) is not yet
            // landed on this side (LSMLMask.source has no shape-id target),
            // so a decomposable SVG referenced by a *mask* falls back to the
            // sanitized data: URI until #K. An image-FILL always uses N1
            // geometry (0 data:URI). When N1 fails, N2 is the sole path; if it
            // too fails, the asset is omitted with an `error` diagnostic so the
            // authoring gate (#I) refuses the bundle (A3.4 case 3) — never a
            // silent drop, never a raw-byte SVG data: URI.
            try {
              entry.resolvedDataUri = emitSanitizedSvgDataUri(sanitizeSvg(bytes));
            } catch (err) {
              if (decomposed) return; // N1 covers the fill case; mask absent → fine
              const reason = err instanceof SanitizeError ? err.message : String(err);
              opts.onDiagnostic?.(
                "asset-svg-unsanitizable",
                `Image fill/mask SVG source omitted: not decomposable and could not ` +
                  `sanitize (${reason}); referencing fill/mask dropped. Authoring gate ` +
                  `must refuse the bundle.`,
                "error",
              );
            }
            return;
          }
          const ext = sniffImageExtension(bytes);
          // Bound the `data:` URI to the raster allowlist BEFORE inlining.
          // A non-raster (SVG, unknown/binary) is omitted, not emitted —
          // `resolvedDataUri` stays undefined, the referencing fill/mask is
          // dropped at rewrite time, and no placeholder leaks into the
          // bundle (Bastion VETO: no `data:image/svg+xml` / executable SVG,
          // no `data:application/octet-stream`).
          if (!RASTER_DATA_URI_EXTS.has(ext)) {
            opts.onDiagnostic?.(
              "asset-data-uri-omitted",
              `Image fill/mask source omitted: non-raster payload (sniffed "${ext}") ` +
                `cannot be emitted as a data: URI; referencing fill/mask dropped.`,
            );
            return;
          }
          entry.resolvedDataUri = bytesToDataUri(bytes, extToMime(ext));
        }),
      );
      // Fetch every image's bytes in parallel. Sequential awaits in a
      // for-of loop multiplied per-image latency — on a scene with 100
      // images at ~200ms each, the export blocks for ~20s just on byte
      // fetches. Promise.all keeps the total close to the latency of
      // the slowest single fetch (Figma serves them in parallel).
      const entries = Array.from(byHash.values());
      const results = await Promise.all(
        entries.map(async (entry): Promise<ExportedAsset | null> => {
          const handle = opts.api.getImageByHash(entry.figmaHash);
          if (!handle) return null;
          const bytes = await handle.getBytesAsync();
          const ext = sniffImageExtension(bytes);
          // Figma's `imageHash` is itself a content-addressed hash of
          // the image bytes (Figma uses SHA-1 internally). Reuse it as
          // the asset filename instead of re-hashing with SHA-256 :
          //   - The "same bytes → same path" property is preserved.
          //   - Pure-JS SHA-256 over MBs of image data freezes the
          //     plugin for tens of seconds in the QuickJS sandbox.
          //   - Figma's de-dup ensures one imageHash per unique image,
          //     so the asset directory stays content-addressed.
          const finalName = `${ASSET_DIR}/${entry.figmaHash}.${ext}`;
          entry.resolvedPath = finalName;
          return {
            name: finalName,
            mimeType: extToMime(ext),
            bytes,
          };
        }),
      );
      return results.filter((r): r is ExportedAsset => r !== null);
    },
  };
  return reg;
}

/** Walk an LSML primitive tree and rewrite `src` paths from placeholder to
 *  sha256-based forms. Mutates in place — returns the same node for chain.
 *
 *  When `decompositions` is supplied (ADR 002 #M / N1), an image-fill / mask
 *  whose `src` references a DECOMPOSED placeholder is replaced by NATIVE LSML
 *  geometry instead of being rewritten to a `data:` URI: the image-fill is
 *  removed from its `fills[]`/`backgrounds[]` and the decomposed shapes are
 *  injected as children of the host node, scaled to the host's box. This is
 *  the 0-data:URI, 0-surface path (A3.2). */
export function applyAssetPathRewrites<T extends object>(
  node: T,
  rewrites: Record<string, string>,
  decompositions: Record<string, DecomposedSvg> = {},
): T {
  walk(node, rewrites, decompositions);
  return node;
}

/** A placeholder that N1 resolved to native geometry. */
function decomposedRef(v: unknown, decomp: Record<string, DecomposedSvg>): DecomposedSvg | null {
  return typeof v === "string" && v.startsWith(DATA_URI_PREFIX) ? (decomp[v] ?? null) : null;
}

/** The host node's box, for fitting decomposed shapes. A shape/frame exposes
 *  `size`; default to the source viewBox extent when absent. */
function hostBox(obj: Record<string, unknown>): { w: number; h: number } | null {
  const size = obj.size;
  if (size !== null && typeof size === "object" && !Array.isArray(size)) {
    const w = (size as Record<string, unknown>).w;
    const h = (size as Record<string, unknown>).h;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) return { w, h };
  }
  return null;
}

/** Build the native shape children for a decomposed SVG, fitting the source
 *  viewBox onto the host box (object-fit: fill — the default for a shape/frame
 *  image paint). The fit is an affine `translate(-minX,-minY)` then
 *  `scale(box.w/vbW, box.h/vbH)`, BAKED into the shapes' path data + gradient
 *  transforms by `fitDecomposedToBox` (all geometry math stays in the
 *  decomposer). When the host box is unknown, shapes keep source coordinates. */
function decomposedChildren(
  d: DecomposedSvg,
  box: { w: number; h: number } | null,
): ShapePrimitive[] {
  return fitDecomposedToBox(d, box).shapes;
}

/** True if `v` is a data-URI placeholder that `finalize` did NOT resolve
 *  (i.e. omitted because the payload is non-raster / unfetchable). A resolved
 *  placeholder has an entry in `rewrites`; an omitted one does not, and is a
 *  rejected asset whose referencing fill/mask must be dropped — never leaked
 *  into the bundle. */
function isOmittedDataUriPlaceholder(v: unknown, rewrites: Record<string, string>): boolean {
  return typeof v === "string" && v.startsWith(DATA_URI_PREFIX) && rewrites[v] === undefined;
}

/** True if an object node references an OMITTED data-URI placeholder and must
 *  be pruned. Covers the two LSML shapes that carry a data-URI `src`:
 *   - an image fill / background  `{ kind:"image", src }`            (direct `src`),
 *   - a mask                       `{ source:{ kind:"image", src }, … }` (nested).
 *  Pruning at the mask level (not just its `source`) avoids leaving a broken
 *  `{ type, op }` mask behind. A resolved (raster) placeholder is left for the
 *  in-place string rewrite below — only omitted ones trigger a drop. */
function referencesOmittedAsset(
  obj: Record<string, unknown>,
  rewrites: Record<string, string>,
): boolean {
  if (isOmittedDataUriPlaceholder(obj.src, rewrites)) return true;
  const source = obj.source;
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    return isOmittedDataUriPlaceholder((source as Record<string, unknown>).src, rewrites);
  }
  return false;
}

function walk(
  value: unknown,
  rewrites: Record<string, string>,
  decomp: Record<string, DecomposedSvg>,
): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    // Prune array entries (e.g. fills[] / backgrounds[]) that reference an
    // omitted data-URI placeholder, then recurse into survivors. Decomposed
    // image-fills are handled at the OWNING object level (below), not here —
    // the host node, not the fill, receives the geometry.
    for (let i = value.length - 1; i >= 0; i--) {
      const v = value[i];
      if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        referencesOmittedAsset(v as Record<string, unknown>, rewrites)
      ) {
        value.splice(i, 1);
        continue;
      }
      walk(v, rewrites, decomp);
    }
    return;
  }
  const obj = value as Record<string, unknown>;

  // N1 (ADR 002 #M): replace a decomposable image-fill / mask source on THIS
  // host node with native geometry before the generic rewrite/prune pass.
  injectDecomposedGeometry(obj, decomp);

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string" && rewrites[v]) {
      obj[key] = rewrites[v];
    } else if (v && typeof v === "object") {
      // Drop a non-array sub-object whose `src` references an omitted asset
      // (e.g. `mask.source`, `mask`). Removing the property prevents the
      // placeholder from surviving in the emitted LSML.
      if (referencesOmittedAsset(v as Record<string, unknown>, rewrites)) {
        delete obj[key];
        continue;
      }
      walk(v, rewrites, decomp);
    }
  }
}

/** N1 structural transform (ADR 002 A3.2). For the host node `obj`: any
 *  image-fill in `fills[]` / `backgrounds[]` whose `src` decomposed is REMOVED
 *  and the native shapes are appended to `obj.children`, fitted to the host box
 *  (the image-fill→shapes placement). All injected geometry is TYPED LSML —
 *  0 data:URI, 0 SVG markup.
 *
 *  ASSUMPTION (flagged for review): a decomposable SVG referenced by a `mask`
 *  is NOT injected here — the shape-mask ref channel (#K, `mask.source.kind:
 *  "shape"`) is not yet landed on this side (`LSMLMask.source` has no shape-id
 *  target). Such a mask keeps its image source, which `finalize` resolved to a
 *  SANITIZED `data:image/svg+xml` (N2) for exactly this reason — so the mask
 *  case is still 0-loss and surface-bounded, just not yet native. */
function injectDecomposedGeometry(
  obj: Record<string, unknown>,
  decomp: Record<string, DecomposedSvg>,
): void {
  if (Object.keys(decomp).length === 0) return;
  const box = hostBox(obj);

  for (const arrKey of ["fills", "backgrounds"] as const) {
    const arr = obj[arrKey];
    if (!Array.isArray(arr)) continue;
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = arr[i];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const d = decomposedRef((entry as Record<string, unknown>).src, decomp);
      if (!d) continue;
      arr.splice(i, 1); // remove the image-fill
      const kids = ensureChildren(obj);
      for (const shape of decomposedChildren(d, box)) kids.push(shape);
    }
    // An emptied fills/backgrounds array is left as-is ([]) — harmless and
    // consistent with the existing prune behaviour.
  }
}

function ensureChildren(obj: Record<string, unknown>): unknown[] {
  if (!Array.isArray(obj.children)) obj.children = [];
  return obj.children as unknown[];
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
    default:
      // Unknown / binary bytes. Only ever used for the stored-asset path
      // (a content-addressed file, NOT a data: URI) — the data: URI path is
      // bounded to `RASTER_DATA_URI_EXTS` and omits anything that lands here.
      return "application/octet-stream";
  }
}
