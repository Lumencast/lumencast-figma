import { describe, it, expect } from "vitest";
import {
  gateBundle,
  gateBundleWithBudget,
  DEFAULT_BUDGET,
  type AuthoringBudget,
  type GateError,
} from "../../../src/export/authoring-gate";
import type { SceneBundle } from "../../../src/shared/lsml-types";

const VALID_VERSION = `sha256:${"a".repeat(64)}`;

function bundle(layout: unknown, allowedHosts?: string[]): SceneBundle {
  return {
    lsml: "1.2",
    scene_id: "demo",
    scene_version: VALID_VERSION,
    layout: layout as never,
    ...(allowedHosts ? { assets: { allowedHosts } } : {}),
  };
}

function codes(errs: GateError[]): string[] {
  return errs.map((e) => e.code);
}

describe("authoring gate (figma export — T5/T6, #I)", () => {
  it("passes a nominal 1.2 bundle", () => {
    const layout = {
      kind: "frame",
      id: "root",
      backgrounds: [
        {
          kind: "image",
          src: "https://cdn.example.com/cover.png",
          objectFit: "cover",
          blendMode: "multiply",
        },
      ],
      children: [
        {
          kind: "shape",
          id: "ruby",
          blendMode: "screen",
          fills: [{ kind: "image", src: "data:image/png;base64,AAAA" }],
        },
        {
          kind: "image",
          id: "logo",
          src: "https://cdn.example.com/logo.png",
          mask: { source: { kind: "shape", ref: "ruby" }, type: "alpha", op: "intersect" },
        },
      ],
    };
    expect(gateBundle(bundle(layout, ["cdn.example.com"]))).toEqual([]);
  });

  it("passes a data-free bundle with no assets block", () => {
    const layout = {
      kind: "frame",
      children: [{ kind: "shape", fills: [{ kind: "solid", color: "#fff" }] }],
    };
    expect(gateBundle(bundle(layout))).toEqual([]);
  });

  // --- T1/T2 ---

  it("refuses a src whose host is not in allowedHosts", () => {
    const layout = { kind: "image", src: "https://evil.com/x.png" };
    expect(codes(gateBundle(bundle(layout, ["cdn.example.com"])))).toContain(
      "GATE_HOST_NOT_ALLOWED",
    );
  });

  it("refuses look-alike / userinfo hosts (no substring match)", () => {
    for (const src of [
      "https://cdn.example.com.evil.com/x.png",
      "https://cdn-example.com/x.png",
      "https://cdn.example.com@evil.com/x.png",
    ]) {
      const errs = gateBundle(bundle({ kind: "image", src }, ["cdn.example.com"]));
      expect(errs.length).toBeGreaterThan(0);
    }
  });

  it("refuses hostile schemes", () => {
    for (const src of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "file:///etc/passwd",
      "blob:https://x/y",
    ]) {
      const errs = gateBundle(bundle({ kind: "image", src }, ["cdn.example.com"]));
      expect(errs.length).toBeGreaterThan(0);
    }
  });

  it("empty allowlist denies every remote host", () => {
    const errs = gateBundle(bundle({ kind: "image", src: "https://cdn.example.com/x.png" }));
    expect(codes(errs)).toContain("GATE_HOST_NOT_ALLOWED");
  });

  it("never echoes the rejected URL (Bastion R9)", () => {
    const secret = "https://evil.com/super-secret-token-abc123.png";
    const errs = gateBundle(bundle({ kind: "image", src: secret }, ["cdn.example.com"]));
    for (const e of errs) {
      expect(e.message).not.toContain("evil.com");
      expect(e.message).not.toContain("abc123");
    }
  });

  // --- T4 ---

  it("refuses an out-of-enum node blendMode", () => {
    const errs = gateBundle(bundle({ kind: "shape", blendMode: "PASS_THROUGH" }));
    expect(codes(errs)).toContain("GATE_ENUM_NOT_ALLOWED");
  });

  it("refuses an out-of-enum fill blendMode", () => {
    const layout = { kind: "shape", fills: [{ kind: "solid", color: "#fff", blendMode: "evil" }] };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_ENUM_NOT_ALLOWED");
  });

  it("refuses an out-of-enum objectFit", () => {
    const layout = { kind: "image", src: "data:image/png;base64,AA", objectFit: "sneaky" };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_ENUM_NOT_ALLOWED");
  });

  it("refuses out-of-enum mask.type / mask.op", () => {
    const layout = {
      kind: "frame",
      children: [
        { kind: "shape", id: "s" },
        { kind: "image", mask: { source: { kind: "shape", ref: "s" }, type: "sneaky", op: "xor" } },
      ],
    };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_ENUM_NOT_ALLOWED");
  });

  // --- #K dangling + cycle ---

  it("refuses a dangling mask shape-ref", () => {
    const layout = {
      kind: "image",
      mask: { source: { kind: "shape", ref: "nope" }, type: "alpha", op: "intersect" },
    };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_DANGLING_MASK_REF");
  });

  it("refuses a mask→shape→mask cycle", () => {
    const layout = {
      kind: "frame",
      children: [
        {
          kind: "shape",
          id: "a",
          mask: { source: { kind: "shape", ref: "b" }, type: "alpha", op: "intersect" },
        },
        {
          kind: "shape",
          id: "b",
          mask: { source: { kind: "shape", ref: "a" }, type: "alpha", op: "intersect" },
        },
      ],
    };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_MASK_CYCLE");
  });

  it("refuses a mask self-cycle", () => {
    const layout = {
      kind: "shape",
      id: "a",
      mask: { source: { kind: "shape", ref: "a" }, type: "alpha", op: "intersect" },
    };
    expect(codes(gateBundle(bundle(layout)))).toContain("GATE_MASK_CYCLE");
  });

  it("gates a mask image source host", () => {
    const layout = {
      kind: "image",
      mask: {
        source: { kind: "image", src: "https://evil.com/m.png" },
        type: "alpha",
        op: "intersect",
      },
    };
    expect(codes(gateBundle(bundle(layout, ["cdn.example.com"])))).toContain(
      "GATE_HOST_NOT_ALLOWED",
    );
  });

  // --- T5 budget (each fixture trips exactly one cap) ---

  function tightBudget(over: Partial<AuthoringBudget>): AuthoringBudget {
    return { ...DEFAULT_BUDGET, ...over };
  }

  it("enforces the blend-node budget", () => {
    const children = Array.from({ length: 10 }, () => ({ kind: "shape", blendMode: "multiply" }));
    const errs = gateBundleWithBudget(
      bundle({ kind: "frame", children }),
      tightBudget({ maxBlendNodes: 4 }),
    );
    expect(codes(errs)).toContain("GATE_BUDGET_EXCEEDED");
  });

  it("enforces the image-node budget", () => {
    const children = Array.from({ length: 10 }, () => ({
      kind: "image",
      src: "data:image/png;base64,AA",
    }));
    const errs = gateBundleWithBudget(
      bundle({ kind: "frame", children }),
      tightBudget({ maxImageNodes: 3 }),
    );
    expect(codes(errs)).toContain("GATE_BUDGET_EXCEEDED");
  });

  it("enforces the total-node budget", () => {
    const children = Array.from({ length: 20 }, () => ({ kind: "shape" }));
    const errs = gateBundleWithBudget(
      bundle({ kind: "frame", children }),
      tightBudget({ maxTotalNodes: 5 }),
    );
    expect(codes(errs)).toContain("GATE_BUDGET_EXCEEDED");
  });

  it("enforces the mask-depth budget on a deep chain", () => {
    const n = 6;
    const children = Array.from({ length: n }, (_, i) =>
      i < n - 1
        ? {
            kind: "shape",
            id: `m${i}`,
            mask: { source: { kind: "shape", ref: `m${i + 1}` }, type: "alpha", op: "intersect" },
          }
        : { kind: "shape", id: `m${i}` },
    );
    const errs = gateBundleWithBudget(
      bundle({ kind: "frame", children }),
      tightBudget({ maxMaskDepth: 3 }),
    );
    expect(codes(errs)).toContain("GATE_BUDGET_EXCEEDED");
  });

  it("does not freeze and passes a deep ACYCLIC mask chain under the cap", () => {
    const n = 10;
    const children = Array.from({ length: n }, (_, i) =>
      i < n - 1
        ? {
            kind: "shape",
            id: `d${i}`,
            mask: { source: { kind: "shape", ref: `d${i + 1}` }, type: "alpha", op: "intersect" },
          }
        : { kind: "shape", id: `d${i}` },
    );
    expect(gateBundle(bundle({ kind: "frame", children }))).toEqual([]);
  });
});
