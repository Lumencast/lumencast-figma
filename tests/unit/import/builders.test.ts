import { describe, it, expect } from "vitest";
import { buildPrimitive } from "../../../src/import/walk";
import { importBundle } from "../../../src/import";
import type { BuildContext } from "../../../src/import/builders/types";
import { createImportMock } from "../../fixtures/figma/import-mock";

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    defaults: over.defaults ?? {},
    assetMap: over.assetMap ?? {},
    warn: over.warn ?? (() => undefined),
  };
}

describe("import builders", () => {
  it("text — resolves __lit.* literal from defaults to characters", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "text",
        bind: { value: "__lit.text.x" },
        style: { fontSize: 24, color: "#ff0000", textAlign: "center" },
      },
      api,
      ctx({ defaults: { "__lit.text.x": "Hello" } }),
    );
    expect(node.type).toBe("TEXT");
    expect((node as unknown as { characters: string }).characters).toBe("Hello");
    expect((node as unknown as { fontSize: number }).fontSize).toBe(24);
    expect((node as unknown as { textAlignHorizontal: string }).textAlignHorizontal).toBe("CENTER");
  });

  it("text — keeps the [bind:path] convention on the layer name for non-literal binds", () => {
    const api = createImportMock();
    const node = buildPrimitive({ kind: "text", bind: { value: "match.score" } }, api, ctx());
    expect(node.name).toBe("[bind:match.score] Text");
  });

  it("shape — single solid fill round-trips via cssToRgb", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      { kind: "shape", geometry: "rect", size: { w: 100, h: 50 }, fill: "#ff8000" },
      api,
      ctx(),
    );
    expect(node.type).toBe("RECTANGLE");
    const fills = (node as unknown as { fills: { type: string; color: { r: number } }[] }).fills;
    expect(fills[0]?.type).toBe("SOLID");
    expect(fills[0]?.color.r).toBeCloseTo(1, 5);
  });

  it("shape — multi-fill gradient maps back to GRADIENT_LINEAR + SOLID", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "shape",
        geometry: "rect",
        size: { w: 200, h: 50 },
        fills: [
          {
            kind: "linear-gradient",
            angle_deg: 90,
            stops: [
              { offset: 0, color: "#ff0000" },
              { offset: 1, color: "#0000ff" },
            ],
          },
          { kind: "solid", color: "#000000", opacity: 0.2 },
        ],
      },
      api,
      ctx(),
    );
    const fills = (node as unknown as { fills: { type: string }[] }).fills;
    expect(fills).toHaveLength(2);
    expect(fills[0]?.type).toBe("GRADIENT_LINEAR");
    expect(fills[1]?.type).toBe("SOLID");
  });

  it("image — uses ctx.assetMap to back the IMAGE fill", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "image",
        bind: { src: "__lit.image.x" },
        alt: "Logo",
        size: { w: 100, h: 100 },
        fit: "contain",
      },
      api,
      ctx({
        defaults: { "__lit.image.x": "assets/abc.png" },
        assetMap: { "assets/abc.png": "figma-img-1" },
      }),
    );
    const fills = (
      node as unknown as { fills: { type: string; imageHash: string; scaleMode: string }[] }
    ).fills;
    expect(fills[0]?.type).toBe("IMAGE");
    expect(fills[0]?.imageHash).toBe("figma-img-1");
    expect(fills[0]?.scaleMode).toBe("FIT");
  });

  it("image — warns when the asset is missing and creates an empty rectangle", () => {
    const api = createImportMock();
    const warns: string[] = [];
    const node = buildPrimitive(
      {
        kind: "image",
        bind: { src: "__lit.image.x" },
        alt: "Logo",
        size: { w: 10, h: 10 },
      },
      api,
      ctx({
        defaults: { "__lit.image.x": "assets/missing.png" },
        warn: (code) => warns.push(code),
      }),
    );
    expect(warns).toContain("ASSET_MISSING");
    const fills = (node as unknown as { fills: unknown[] }).fills;
    expect(fills).toEqual([]);
  });

  it("frame — appends children", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "frame",
        size: { w: 100, h: 100 },
        children: [
          { kind: "text", bind: { value: "x" } },
          { kind: "text", bind: { value: "y" } },
        ],
      },
      api,
      ctx(),
    );
    const children = (node as unknown as { children: unknown[] }).children;
    expect(children).toHaveLength(2);
  });

  it("stack — auto-layout flags + padding map back to Figma", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "stack",
        direction: "horizontal",
        gap: 12,
        wrap: true,
        crossGap: 8,
        justify: "space-between",
        align: "center",
        padding: [16, 32, 16, 32],
        children: [],
      },
      api,
      ctx(),
    );
    const f = node as unknown as {
      layoutMode: string;
      itemSpacing: number;
      layoutWrap: string;
      counterAxisSpacing: number;
      primaryAxisAlignItems: string;
      counterAxisAlignItems: string;
      paddingTop: number;
      paddingLeft: number;
    };
    expect(f.layoutMode).toBe("HORIZONTAL");
    expect(f.itemSpacing).toBe(12);
    expect(f.layoutWrap).toBe("WRAP");
    expect(f.counterAxisSpacing).toBe(8);
    expect(f.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    expect(f.counterAxisAlignItems).toBe("CENTER");
    expect(f.paddingTop).toBe(16);
    expect(f.paddingLeft).toBe(32);
  });

  it("instance — writes scene_id / scene_version / params back into plugin data", () => {
    const api = createImportMock();
    const node = buildPrimitive(
      {
        kind: "instance",
        scene_id: "scoreboard",
        scene_version: "sha256:" + "a".repeat(64),
        size: { w: 800, h: 240 },
        params: { team_a: "Alpha" },
        fit: "contain",
      },
      api,
      ctx(),
    );
    const pd = (node as unknown as { pluginData: Record<string, string> }).pluginData;
    expect(pd["instance.scene_id"]).toBe("scoreboard");
    expect(pd["instance.scene_version"]).toMatch(/^sha256:a{64}$/);
    expect(pd["instance.params"]).toBe('{"team_a":"Alpha"}');
    expect(pd["instance.fit"]).toBe("contain");
  });

  it("unknown primitive kind — surfaces a warning and creates a placeholder frame", () => {
    const api = createImportMock();
    const warns: string[] = [];
    const node = buildPrimitive(
      { kind: "media", media_kind: "video", bind: { src: "v.url" } } as never,
      api,
      ctx({ warn: (code) => warns.push(code) }),
    );
    expect(warns).toContain("UNSUPPORTED_PRIMITIVE");
    expect(node.type).toBe("FRAME");
  });

  it("group conversion — preserves isMask + maskType + blendMode + opacity from placeholder", async () => {
    // Mirror of the bg-texture / mask composition that broke at re-import :
    // the source GROUP carries a child GROUP marked `isMask=true` whose
    // bounds clip the group's reported bbox in Figma. Before the fix,
    // figma.group() returned a fresh GroupNode with all defaults — the
    // isMask flag was silently dropped, so the parent's bbox grew to
    // children-union (much wider than the masked region).
    const { sealBundle } = await import("../../../src/export/canonicalize");
    const api = createImportMock();
    const draft = {
      $schema: "https://lumencast.dev/schema/lsml/1.1/schema.json",
      lsml: "1.1" as const,
      scene_id: "test-mask-group",
      scene_version: "sha256:" + "0".repeat(64),
      defaults: {},
      layout: {
        kind: "frame" as const,
        size: { w: 200, h: 200 },
        children: [
          {
            kind: "frame" as const,
            size: { w: 100, h: 100 },
            metadata: {
              figma: { sourceType: "GROUP", layerName: "outer" },
            },
            children: [
              {
                kind: "frame" as const,
                size: { w: 100, h: 100 },
                opacity: 0.5,
                metadata: {
                  figma: {
                    sourceType: "GROUP",
                    layerName: "mask",
                    isMask: true,
                    maskType: "ALPHA",
                    blendMode: "MULTIPLY",
                  },
                },
                children: [
                  {
                    kind: "shape" as const,
                    geometry: "rect" as const,
                    size: { w: 100, h: 100 },
                    fill: "#ff0000",
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const sealed = await sealBundle(draft);
    await importBundle({ api, lsmlBytes: sealed.canonical });
    const root = api.appended()[0]!;
    expect(root.type).toBe("FRAME");
    const outerGroup = root.children[0]!;
    expect(outerGroup.type).toBe("GROUP");
    const mask = outerGroup.children[0]!;
    expect(mask.type).toBe("GROUP");
    const m = mask as unknown as {
      isMask?: boolean;
      maskType?: string;
      blendMode?: string;
      opacity?: number;
    };
    expect(m.isMask).toBe(true);
    expect(m.maskType).toBe("ALPHA");
    expect(m.blendMode).toBe("MULTIPLY");
    expect(m.opacity).toBe(0.5);
  });
});
