import { describe, it, expect } from "vitest";
import { parseLayerName } from "../../src/export/bindings";

describe("parseLayerName", () => {
  it("returns the raw name when no directives are present", () => {
    expect(parseLayerName("Score Bar")).toEqual({ displayName: "Score Bar" });
  });

  it("extracts a shorthand bind directive on text", () => {
    const r = parseLayerName("[bind:show.title] Title", { primitiveKind: "text" });
    expect(r.bind).toEqual({ value: "show.title" });
    expect(r.displayName).toBe("Title");
  });

  it("uses kind-specific default prop names", () => {
    expect(parseLayerName("[bind:logo.url]", { primitiveKind: "image" }).bind).toEqual({
      src: "logo.url",
    });
    expect(parseLayerName("[bind:players]", { primitiveKind: "repeat" }).bind).toEqual({
      items: "players",
    });
  });

  it("supports explicit prop=path form", () => {
    const r = parseLayerName("[bind:value=show.title][bind:format=show.locale] Title", {
      primitiveKind: "text",
    });
    expect(r.bind).toEqual({ value: "show.title", format: "show.locale" });
    expect(r.displayName).toBe("Title");
  });

  it("parses bindStyle directives", () => {
    const r = parseLayerName(
      "[bind:show.title][bindStyle:color=team.color][bindStyle:fontSize=ui.size] Title",
      { primitiveKind: "text" },
    );
    expect(r.bind).toEqual({ value: "show.title" });
    expect(r.bindStyle).toEqual({ color: "team.color", fontSize: "ui.size" });
    expect(r.displayName).toBe("Title");
  });

  it("parses bindUniversal for visible/opacity/rotation only", () => {
    const r = parseLayerName(
      "[bindUniversal:visible=ui.show][bindUniversal:opacity=ui.alpha] Panel",
    );
    expect(r.bindUniversal).toEqual({ visible: "ui.show", opacity: "ui.alpha" });
  });

  it("rejects bindUniversal with unsupported keys", () => {
    const warns: string[] = [];
    const r = parseLayerName("[bindUniversal:size=ui.s] Panel", {
      warn: (code) => warns.push(code),
    });
    expect(r.bindUniversal).toBeUndefined();
    expect(warns).toContain("INVALID_BIND_UNIVERSAL_KEY");
    // Malformed directive falls back into displayName.
    expect(r.displayName).toContain("[bindUniversal:size=ui.s]");
  });

  it("rejects malformed leaf paths", () => {
    const warns: string[] = [];
    const r = parseLayerName("[bind:has spaces] Title", {
      primitiveKind: "text",
      warn: (code) => warns.push(code),
    });
    expect(r.bind).toBeUndefined();
    expect(warns).toContain("INVALID_BINDING_PATH");
  });

  it("strips multiple leading directives even with whitespace", () => {
    const r = parseLayerName("  [bind:show.title]  [bindStyle:color=team.color]  Title  ", {
      primitiveKind: "text",
    });
    expect(r.bind).toEqual({ value: "show.title" });
    expect(r.bindStyle).toEqual({ color: "team.color" });
    expect(r.displayName).toBe("Title");
  });

  it("treats unknown directive heads as plain text (not a bind)", () => {
    const r = parseLayerName("[unknown:foo] Title", { primitiveKind: "text" });
    expect(r.bind).toBeUndefined();
    expect(r.displayName).toBe("[unknown:foo] Title");
  });

  it("supports scope-substitution `{name}` paths inside repeats", () => {
    const r = parseLayerName("[bind:value={player}.name] Name", { primitiveKind: "text" });
    expect(r.bind).toEqual({ value: "{player}.name" });
  });
});
