import { describe, it, expect } from "vitest";
import { validateBundle } from "../../../src/export/validate";
import type { SceneBundle } from "../../../src/shared/lsml-types";

const VALID_VERSION = `sha256:${"a".repeat(64)}`;

function ok(): SceneBundle {
  return {
    lsml: "1.1",
    scene_id: "demo",
    scene_version: VALID_VERSION,
    layout: { kind: "frame", size: { w: 100, h: 100 }, children: [] },
  };
}

describe("validateBundle (lite)", () => {
  it("accepts a minimal valid bundle", () => {
    expect(validateBundle(ok())).toEqual({ ok: true });
  });

  it("rejects an invalid scene_id charset", () => {
    const bundle = { ...ok(), scene_id: "a b c" };
    const r = validateBundle(bundle);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("/scene_id");
  });

  it("rejects a malformed scene_version", () => {
    const bundle = { ...ok(), scene_version: "sha256:not-hex" };
    const r = validateBundle(bundle);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown primitive kinds", () => {
    const bundle = { ...ok(), layout: { kind: "balloon", children: [] } as never };
    const r = validateBundle(bundle);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("balloon");
  });

  it("accepts vendor-prefixed primitive kinds (LSML §17.1)", () => {
    const bundle = {
      ...ok(),
      layout: {
        kind: "frame",
        size: { w: 1, h: 1 },
        children: [{ kind: "x-acme.spinner" }],
      } as never,
    };
    expect(validateBundle(bundle)).toEqual({ ok: true });
  });

  it("rejects operator_inputs without __inputs. prefix", () => {
    const bundle = ok();
    bundle.operator_inputs = [
      { path: "show.title", label: "x", type: "string", writable_by: ["operator"] },
    ];
    const r = validateBundle(bundle);
    expect(r.ok).toBe(false);
  });

  it("flags missing assets.allowedHosts when the bundle references assets/", () => {
    const bundle: SceneBundle = {
      lsml: "1.1",
      scene_id: "demo",
      scene_version: VALID_VERSION,
      layout: {
        kind: "frame",
        size: { w: 100, h: 100 },
        children: [],
      },
      defaults: { "__lit.image.x": "assets/abc.png" },
    };
    const r = validateBundle(bundle);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("ASSETS_MISSING_ALLOWED_HOSTS");
  });
});
