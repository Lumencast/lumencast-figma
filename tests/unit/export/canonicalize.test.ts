import { describe, it, expect } from "vitest";
import {
  canonicalize,
  sealBundle,
  SCENE_VERSION_PLACEHOLDER,
} from "../../../src/export/canonicalize";

describe("canonicalize (JCS)", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it("emits no whitespace", () => {
    const s = canonicalize({ a: [1, 2, { b: "x" }] });
    expect(s).toBe('{"a":[1,2,{"b":"x"}]}');
  });

  it("escapes control chars and quote marks", () => {
    expect(canonicalize('a"b')).toBe('"a\\"b"');
    expect(canonicalize("\n")).toBe('"\\n"');
    expect(canonicalize("")).toBe('"\\u0001"');
  });

  it("normalizes -0 to 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("omits undefined object props (matches JSON.stringify)", () => {
    expect(canonicalize({ a: 1, b: undefined, c: 2 } as Record<string, unknown>)).toBe(
      '{"a":1,"c":2}',
    );
  });

  it("re-arranging input object keys produces identical canonical bytes", () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });
});

describe("sealBundle (LSML §3.2 placeholder protocol)", () => {
  it("computes scene_version from the placeholderized canonical form", async () => {
    const bundle = {
      lsml: "1.1",
      scene_id: "demo",
      scene_version: "anything",
      layout: { kind: "frame", size: { w: 100, h: 100 }, children: [] },
    };
    const r = await sealBundle(bundle);
    expect(r.sceneVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.bundle.scene_version).toBe(r.sceneVersion);

    // Independent verification : reverse the protocol.
    const verifyBundle = { ...r.bundle, scene_version: SCENE_VERSION_PLACEHOLDER };
    const verifyCanonical = canonicalize(verifyBundle);
    const expectedHashHex = await import("../../../src/export/hash").then((m) =>
      m.sha256OfText(verifyCanonical),
    );
    expect(r.sceneVersion).toBe(`sha256:${expectedHashHex}`);
  });

  it("two bundles with identical content (different scene_version) have identical sealed scene_versions", async () => {
    const a = await sealBundle({
      lsml: "1.1",
      scene_id: "x",
      scene_version: "sha256:111...",
      layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] },
    });
    const b = await sealBundle({
      lsml: "1.1",
      scene_id: "x",
      scene_version: "sha256:222...",
      layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] },
    });
    expect(a.sceneVersion).toBe(b.sceneVersion);
  });
});
