import { describe, it, expect } from "vitest";
import { mapInstance } from "../../../src/mapping/instance";
import { equipPluginData } from "../../fixtures/figma/mock";

const VALID_VERSION = `sha256:${"a".repeat(64)}`;

function ctx(): {
  warns: { code: string; message: string }[];
  warn: (code: string, message: string, nodeId?: string) => void;
} {
  const warns: { code: string; message: string }[] = [];
  return {
    warns,
    warn: (code, message) => warns.push({ code, message }),
  };
}

function instanceNode(id: string, data: Record<string, string>): never {
  const node = equipPluginData({
    type: "INSTANCE" as const,
    id,
    name: "Card instance",
    width: 320,
    height: 200,
    x: 100,
    y: 50,
    children: [],
    pluginData: { ...data },
  } as never);
  return node as never;
}

describe("mapInstance", () => {
  it("returns null when scene_id is absent (caller falls back to FRAME)", () => {
    const node = instanceNode("i:0", {});
    const r = mapInstance(node, { isRoot: false }, ctx());
    expect(r).toBeNull();
  });

  it("returns null and warns when scene_version is malformed", () => {
    const c = ctx();
    const node = instanceNode("i:1", {
      "instance.scene_id": "scoreboard",
      "instance.scene_version": "not-a-hash",
    });
    const r = mapInstance(node, { isRoot: false }, c);
    expect(r).toBeNull();
    expect(c.warns[0]?.code).toBe("INVALID_INSTANCE");
    expect(c.warns[0]?.message).toContain("scene_version");
  });

  it("emits an instance primitive with size + position", () => {
    const node = instanceNode("i:2", {
      "instance.scene_id": "scoreboard",
      "instance.scene_version": VALID_VERSION,
    });
    const r = mapInstance(node, { isRoot: false, parentX: 0, parentY: 0 }, ctx())!;
    expect(r.node).toMatchObject({
      kind: "instance",
      scene_id: "scoreboard",
      scene_version: VALID_VERSION,
      size: { w: 320, h: 200 },
      position: { x: 100, y: 50 },
    });
  });

  it("omits position when isRoot", () => {
    const node = instanceNode("i:3", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
    });
    const r = mapInstance(node, { isRoot: true }, ctx())!;
    expect((r.node as { position?: unknown }).position).toBeUndefined();
  });

  it("parses params and bindParams from JSON plugin data", () => {
    const node = instanceNode("i:4", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.params": '{"team_a":"Alpha","score_a":14}',
      "instance.bind_params": '{"team_b":"match.team_b.name"}',
    });
    const r = mapInstance(node, { isRoot: true }, ctx())!;
    expect((r.node as { params?: unknown }).params).toEqual({ team_a: "Alpha", score_a: 14 });
    expect((r.node as { bindParams?: unknown }).bindParams).toEqual({
      team_b: "match.team_b.name",
    });
  });

  it("warns and removes the static key when params and bindParams overlap", () => {
    const c = ctx();
    const node = instanceNode("i:5", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.params": '{"team_a":"Alpha","team_b":"Beta"}',
      "instance.bind_params": '{"team_a":"match.team_a.name"}',
    });
    const r = mapInstance(node, { isRoot: true }, c)!;
    const params = (r.node as { params?: Record<string, unknown> }).params;
    expect(params).toEqual({ team_b: "Beta" });
    expect(c.warns[0]?.message).toContain("both params and bind_params");
  });

  it("accepts and emits valid fit values", () => {
    const node = instanceNode("i:6", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.fit": "cover",
    });
    const r = mapInstance(node, { isRoot: true }, ctx())!;
    expect((r.node as { fit?: string }).fit).toBe("cover");
  });

  it("rejects malformed fit values with a warning", () => {
    const c = ctx();
    const node = instanceNode("i:7", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.fit": "stretch",
    });
    const r = mapInstance(node, { isRoot: true }, c)!;
    expect((r.node as { fit?: string }).fit).toBeUndefined();
    expect(c.warns[0]?.message).toContain('fit "stretch"');
  });

  it("rejects non-object params with a warning", () => {
    const c = ctx();
    const node = instanceNode("i:8", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.params": "[1,2,3]",
    });
    const r = mapInstance(node, { isRoot: true }, c)!;
    expect((r.node as { params?: unknown }).params).toBeUndefined();
    expect(c.warns[0]?.message).toContain("must be a JSON object");
  });

  it("rejects non-string bind_params values", () => {
    const c = ctx();
    const node = instanceNode("i:9", {
      "instance.scene_id": "x",
      "instance.scene_version": VALID_VERSION,
      "instance.bind_params": '{"k":42,"k2":"a.path"}',
    });
    const r = mapInstance(node, { isRoot: true }, c)!;
    expect((r.node as { bindParams?: Record<string, string> }).bindParams).toEqual({
      k2: "a.path",
    });
    expect(c.warns[0]?.message).toContain("must be a string LeafPath");
  });
});
