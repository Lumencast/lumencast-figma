import { describe, it, expect } from "vitest";
import { bytesToBase64, bytesToDataUri } from "../../../src/export/base64";

// Reference vectors from RFC 4648 §10 (the "f"/"fo"/"foo"… ladder exercises
// every padding remainder : 0, 1, 2 bytes left over).
const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));

describe("bytesToBase64 (sandbox base64, RFC 4648)", () => {
  it("matches the RFC 4648 test vectors", () => {
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("Zg==");
    expect(enc("fo")).toBe("Zm8=");
    expect(enc("foo")).toBe("Zm9v");
    expect(enc("foob")).toBe("Zm9vYg==");
    expect(enc("fooba")).toBe("Zm9vYmE=");
    expect(enc("foobar")).toBe("Zm9vYmFy");
  });

  it("round-trips arbitrary bytes through atob", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 64]);
    const b64 = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("bytesToDataUri prefixes the mime type", () => {
    const uri = bytesToDataUri(new Uint8Array([0x89, 0x50]), "image/png");
    expect(uri).toBe("data:image/png;base64,iVA=");
  });
});
