// SHA-256 helpers. Uses the global Web Crypto API (`crypto.subtle.digest`),
// which is available in both the Figma plugin sandbox and Node 20+. No
// additional dependencies, no eval, no node-only imports — same code path
// in production and tests.

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  // Take a fresh copy to ensure the underlying buffer is a plain ArrayBuffer
  // (Web Crypto's BufferSource type doesn't accept SharedArrayBuffer-backed
  // views in stricter typings).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const out = await sha256Bytes(bytes);
  let s = "";
  for (const b of out) {
    s += b.toString(16).padStart(2, "0");
  }
  return s;
}

export async function sha256OfText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}
