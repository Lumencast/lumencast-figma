// Pure-JS SHA-256 (FIPS 180-4). No dependencies, no `crypto.subtle`.
//
// Why : the Figma plugin sandbox runs on a QuickJS-based JS engine that does
// NOT expose the Web Crypto API. `crypto.subtle.digest` throws
// `'crypto' is not defined`. The UI iframe DOES have crypto (it runs in
// Chromium), but the asset registry + scene_version sealing live on the
// main thread, so we need a sandbox-friendly implementation.
//
// This is a faithful adaptation of the FIPS 180-4 reference algorithm.
// Performance is not a concern — bundles hash <100 KB of canonical JSON
// and per-asset PNG payloads are usually <1 MB ; both run in <10 ms.
//
// Tested against `crypto.subtle.digest` and the NIST CAVP test vectors
// in tests/unit/export/sha256-pure.test.ts.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** SHA-256 of a Uint8Array → 32-byte Uint8Array. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  // Padding : append 0x80, then zeros until length ≡ 56 mod 64, then 8-byte
  // big-endian bit length.
  const padded = padMessage(bytes);

  const h = new Uint32Array(INITIAL_H);
  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    // Prepare message schedule.
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      w[i] =
        ((padded[j] ?? 0) << 24) |
        ((padded[j + 1] ?? 0) << 16) |
        ((padded[j + 2] ?? 0) << 8) |
        (padded[j + 3] ?? 0);
    }
    for (let i = 16; i < 64; i++) {
      const wi15 = w[i - 15] ?? 0;
      const wi2 = w[i - 2] ?? 0;
      const s0 = rotr(wi15, 7) ^ rotr(wi15, 18) ^ (wi15 >>> 3);
      const s1 = rotr(wi2, 17) ^ rotr(wi2, 19) ^ (wi2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }

    // Compression.
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const v = h[i] ?? 0;
    out[i * 4] = (v >>> 24) & 0xff;
    out[i * 4 + 1] = (v >>> 16) & 0xff;
    out[i * 4 + 2] = (v >>> 8) & 0xff;
    out[i * 4 + 3] = v & 0xff;
  }
  // Suppress unused warning — bitLen is used by padMessage.
  void bitLen;
  return out;
}

function padMessage(bytes: Uint8Array): Uint8Array {
  const L = bytes.length;
  const bitLen = L * 8;
  // After bytes, append 0x80, then zero bytes until total length ≡ 56 mod 64,
  // then 8 bytes for the bit length (big-endian).
  const padLenZeros = (56 - ((L + 1) % 64) + 64) % 64;
  const total = L + 1 + padLenZeros + 8;
  const out = new Uint8Array(total);
  out.set(bytes, 0);
  out[L] = 0x80;
  // 64-bit big-endian bit length. JS numbers are safe up to 2^53 — that's
  // ~9 PB of data, far more than any bundle.
  // High 32 bits :
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  out[total - 8] = (hi >>> 24) & 0xff;
  out[total - 7] = (hi >>> 16) & 0xff;
  out[total - 6] = (hi >>> 8) & 0xff;
  out[total - 5] = hi & 0xff;
  out[total - 4] = (lo >>> 24) & 0xff;
  out[total - 3] = (lo >>> 16) & 0xff;
  out[total - 2] = (lo >>> 8) & 0xff;
  out[total - 1] = lo & 0xff;
  return out;
}

const HEX = "0123456789abcdef";

export function sha256Hex(bytes: Uint8Array): string {
  const out = sha256(bytes);
  let s = "";
  for (const b of out) {
    s += HEX[(b >>> 4) & 0xf]! + HEX[b & 0xf]!;
  }
  return s;
}

/** UTF-8 encode + sha256 hex. */
export function sha256OfText(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}
