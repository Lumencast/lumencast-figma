import { describe, it, expect } from "vitest";
import { parseBundle, type ParseError } from "../../../src/import/parse";
import { sealBundle } from "../../../src/export/canonicalize";

async function makeSealed(overrides: Record<string, unknown> = {}): Promise<string> {
  const draft = {
    $schema: "https://lumencast.dev/schema/lsml/1.1/schema.json",
    lsml: "1.1" as const,
    scene_id: "demo",
    scene_version: "sha256:placeholder",
    layout: { kind: "frame", size: { w: 100, h: 100 }, children: [] },
    ...overrides,
  };
  const r = await sealBundle(draft as never);
  return r.canonical;
}

describe("parseBundle", () => {
  it("accepts a freshly sealed bundle and verifies scene_version", async () => {
    const canonical = await makeSealed();
    const bundle = await parseBundle(canonical);
    expect(bundle.lsml).toBe("1.1");
    expect(bundle.scene_id).toBe("demo");
  });

  it("accepts a Uint8Array input", async () => {
    const canonical = await makeSealed();
    const bytes = new TextEncoder().encode(canonical);
    const bundle = await parseBundle(bytes);
    expect(bundle.scene_id).toBe("demo");
  });

  it("rejects malformed JSON", async () => {
    try {
      await parseBundle("{not valid json");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ParseError).code).toBe("INVALID_JSON");
    }
  });

  it("rejects non-object top-level", async () => {
    try {
      await parseBundle("[1,2,3]");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ParseError).code).toBe("INVALID_LSML");
    }
  });

  it("rejects unknown lsml versions", async () => {
    const bundle = JSON.stringify({
      lsml: "2.0",
      scene_id: "x",
      scene_version: "sha256:" + "0".repeat(64),
      layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] },
    });
    try {
      await parseBundle(bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ParseError).code).toBe("UNSUPPORTED_LSML_VERSION");
    }
  });

  it("rejects structural errors via validateBundle", async () => {
    const bundle = JSON.stringify({
      lsml: "1.1",
      scene_id: "has spaces",
      scene_version: "sha256:" + "0".repeat(64),
      layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] },
    });
    try {
      await parseBundle(bundle);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as ParseError;
      expect(e.code).toBe("BUNDLE_VALIDATION_FAILED");
      expect(e.errors?.length).toBeGreaterThan(0);
    }
  });

  it("rejects scene_version mismatch", async () => {
    // Take a sealed bundle, then swap scene_version to a wrong hash.
    const canonical = await makeSealed();
    const tampered = canonical.replace(
      /"scene_version":"sha256:[0-9a-f]{64}"/,
      `"scene_version":"sha256:${"a".repeat(64)}"`,
    );
    try {
      await parseBundle(tampered);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as ParseError;
      expect(e.code).toBe("SCENE_VERSION_MISMATCH");
      expect(e.claimed).toMatch(/^sha256:a{64}$/);
      expect(e.computed).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
