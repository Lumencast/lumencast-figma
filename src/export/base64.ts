// Pure-JS base64 encoder for the Figma plugin sandbox.
//
// Why : the QuickJS-based plugin sandbox exposes neither `btoa` nor
// `Buffer`. The 1.2 image-fill / mask-image `src` is a gated `AssetUrl`
// (LSML 1.2 §5) — a relative `assets/<sha>.<ext>` path is *not* admissible
// there (only `https:` or a bounded `data:image/*` payload). The mapper's
// content-addressed local assets therefore lower to `data:image/<mime>;
// base64,<bytes>` for fill / mask sources, which carries no remote host and
// keeps `assets.allowedHosts: []` coherent (Bastion T6).
//
// Only genuine image-FILLS (an image inside a shape / frame) take this
// path ; image-as-node primitives keep their `bind.src` leaf-path → local
// `assets/<sha>.<ext>` model untouched.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode raw bytes to a base64 ASCII string (RFC 4648, with `=` padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      ALPHABET[(n >> 6) & 63]! +
      ALPHABET[n & 63]!;
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + "=";
  }
  return out;
}

/** Build a `data:<mime>;base64,<payload>` URI from bytes. */
export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
