// SHA-256 façade. Delegates to the pure-JS implementation in
// `sha256-pure.ts` because the Figma plugin sandbox (QuickJS) does not
// expose the Web Crypto API — `crypto.subtle.digest` throws
// `'crypto' is not defined`. Tests + production share the same code path.
//
// The async signatures are preserved so callers don't have to change ;
// the underlying work is synchronous but cheap enough that no awaiter
// notices.

import {
  sha256 as sha256Sync,
  sha256Hex as sha256HexSync,
  sha256OfText as sha256OfTextSync,
} from "./sha256-pure";

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return sha256Sync(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return sha256HexSync(bytes);
}

export async function sha256OfText(text: string): Promise<string> {
  return sha256OfTextSync(text);
}
