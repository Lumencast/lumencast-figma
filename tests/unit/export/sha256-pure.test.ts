import { describe, it, expect } from "vitest";
import { sha256, sha256Hex, sha256OfText, utf8Encode } from "../../../src/export/sha256-pure";

// NIST CAVP-style known-answer tests — empty string and "abc" are the
// canonical SHA-256 KATs.
const KAT_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const KAT_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("sha256 pure-JS", () => {
  it("hashes empty input to the SHA-256 KAT", () => {
    expect(sha256Hex(new Uint8Array())).toBe(KAT_EMPTY);
  });

  it("hashes 'abc' to the SHA-256 KAT", () => {
    expect(sha256OfText("abc")).toBe(KAT_ABC);
  });

  it("matches Node's built-in crypto.subtle.digest at the 55-byte block boundary", async () => {
    // 55 bytes is the largest single-block input (one more byte forces a
    // second block of padding). Cross-check against Web Crypto.
    const bytes = utf8Encode("a".repeat(55));
    const ours = sha256Hex(bytes);
    const copy = new Uint8Array(bytes);
    const refBuf = await crypto.subtle.digest("SHA-256", copy.buffer);
    let reference = "";
    for (const b of new Uint8Array(refBuf)) reference += b.toString(16).padStart(2, "0");
    expect(ours).toBe(reference);
  });

  it("matches Node's built-in crypto.subtle.digest on a random 1024-byte buffer", async () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;

    const ours = sha256Hex(bytes);
    const referenceBuf = await crypto.subtle.digest("SHA-256", bytes.buffer);
    let reference = "";
    for (const b of new Uint8Array(referenceBuf)) {
      reference += b.toString(16).padStart(2, "0");
    }
    expect(ours).toBe(reference);
  });

  it("returns a 32-byte Uint8Array", () => {
    const out = sha256(new Uint8Array([1, 2, 3]));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32);
  });
});

describe("utf8Encode", () => {
  it("matches the global TextEncoder for ASCII", () => {
    const ref = new TextEncoder().encode("Hello, world");
    expect(utf8Encode("Hello, world")).toEqual(ref);
  });

  it("matches TextEncoder for 2-byte sequences (Latin-1 + BMP)", () => {
    const s = "café — Paris";
    expect(utf8Encode(s)).toEqual(new TextEncoder().encode(s));
  });

  it("matches TextEncoder for 3-byte sequences (CJK)", () => {
    const s = "東京 こんにちは";
    expect(utf8Encode(s)).toEqual(new TextEncoder().encode(s));
  });

  it("matches TextEncoder for 4-byte surrogate pairs (emoji)", () => {
    const s = "🌟 = U+1F31F + meta 🚀";
    expect(utf8Encode(s)).toEqual(new TextEncoder().encode(s));
  });
});
