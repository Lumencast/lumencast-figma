import { describe, it, expect } from "vitest";
import {
  resolveVariable,
  slugifySegment,
  tokenPathFor,
  type FigmaVariable,
  type VariableResolverApi,
} from "../../../src/mapping/variables";
import { mapShape } from "../../../src/mapping/shape";
import { mapFrame } from "../../../src/mapping/frame";

function makeResolver(
  variables: Record<string, FigmaVariable>,
  collections: Record<string, { id: string; name: string }>,
  values: Record<string, string | number>,
): VariableResolverApi {
  return {
    getVariableById: (id) => variables[id] ?? null,
    getVariableCollectionById: (id) => collections[id] ?? null,
    resolveValue: (v) => values[v.id] ?? null,
  };
}

describe("slugifySegment", () => {
  it("normalises uppercase + spaces + special chars", () => {
    expect(slugifySegment("Brand / Primary")).toBe("brand_primary");
    expect(slugifySegment("Show—Title")).toBe("show_title");
  });
  it("collapses repeated separators and trims edges", () => {
    expect(slugifySegment("__a   b__")).toBe("a_b");
  });
  it("falls back to 'unnamed' when result is empty", () => {
    expect(slugifySegment("---")).toBe("unnamed");
  });
});

describe("tokenPathFor", () => {
  it("composes tokens.<group>.<name> from collection + variable", () => {
    const variables: Record<string, FigmaVariable> = {
      "v:1": {
        id: "v:1",
        name: "Primary",
        variableCollectionId: "c:1",
        resolvedType: "COLOR",
      },
    };
    const collections = { "c:1": { id: "c:1", name: "Brand" } };
    const r = makeResolver(variables, collections, {});
    expect(tokenPathFor(variables["v:1"]!, r)).toBe("tokens.brand.primary");
  });

  it("uses 'default' as group when collection lookup fails", () => {
    const variables: Record<string, FigmaVariable> = {
      "v:1": {
        id: "v:1",
        name: "x",
        variableCollectionId: "missing",
        resolvedType: "FLOAT",
      },
    };
    const r = makeResolver(variables, {}, {});
    expect(tokenPathFor(variables["v:1"]!, r)).toBe("tokens.default.x");
  });
});

describe("resolveVariable", () => {
  it("returns path + value for COLOR / FLOAT / STRING", () => {
    const variables: Record<string, FigmaVariable> = {
      "c:1": { id: "c:1", name: "Primary", variableCollectionId: "c", resolvedType: "COLOR" },
      "f:1": { id: "f:1", name: "Size", variableCollectionId: "c", resolvedType: "FLOAT" },
      "s:1": { id: "s:1", name: "Label", variableCollectionId: "c", resolvedType: "STRING" },
    };
    const collections = { c: { id: "c", name: "Brand" } };
    const r = makeResolver(variables, collections, {
      "c:1": "#ff0000",
      "f:1": 16,
      "s:1": "Bonjour",
    });
    expect(resolveVariable("c:1", r)).toEqual({ path: "tokens.brand.primary", value: "#ff0000" });
    expect(resolveVariable("f:1", r)).toEqual({ path: "tokens.brand.size", value: 16 });
    expect(resolveVariable("s:1", r)).toEqual({ path: "tokens.brand.label", value: "Bonjour" });
  });

  it("returns null for BOOLEAN (deferred to v0.2)", () => {
    const variables: Record<string, FigmaVariable> = {
      "b:1": {
        id: "b:1",
        name: "Visible",
        variableCollectionId: "c",
        resolvedType: "BOOLEAN",
      },
    };
    const r = makeResolver(variables, {}, { "b:1": "ignored" });
    expect(resolveVariable("b:1", r)).toBeNull();
  });
});

describe("mapShape with variable-bound fill", () => {
  it("emits bind.fill + defaults when fills[0].color is variable-bound", () => {
    const variables: Record<string, FigmaVariable> = {
      "v:1": { id: "v:1", name: "Primary", variableCollectionId: "c:1", resolvedType: "COLOR" },
    };
    const r = makeResolver(
      variables,
      { "c:1": { id: "c:1", name: "Brand" } },
      { "v:1": "#3366ff" },
    );
    const result = mapShape(
      {
        type: "RECTANGLE",
        id: "s:1",
        name: "Card",
        width: 200,
        height: 100,
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
        fillBoundVariables: [{ color: { id: "v:1" } }],
      },
      { warn: () => undefined, variables: r },
    );
    expect((result.node as { fill?: string }).fill).toBeUndefined();
    expect((result.node as { bind?: { fill?: string } }).bind?.fill).toBe("tokens.brand.primary");
    expect(result.defaults).toEqual({ "tokens.brand.primary": "#3366ff" });
  });

  it("keeps the static fill when the resolver returns null", () => {
    const r = makeResolver({}, {}, {});
    const result = mapShape(
      {
        type: "RECTANGLE",
        id: "s:2",
        name: "Card",
        width: 10,
        height: 10,
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
        fillBoundVariables: [{ color: { id: "missing" } }],
      },
      { warn: () => undefined, variables: r },
    );
    expect((result.node as { fill?: string }).fill).toBe("#000000");
    expect(result.defaults).toBeUndefined();
  });

  it("does nothing when no variable resolver is provided", () => {
    const result = mapShape({
      type: "RECTANGLE",
      id: "s:3",
      name: "Card",
      width: 10,
      height: 10,
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      fillBoundVariables: [{ color: { id: "v:1" } }],
    });
    expect((result.node as { fill?: string }).fill).toBe("#000000");
    expect(result.defaults).toBeUndefined();
  });
});

describe("mapFrame with variable-bound background", () => {
  it("emits bind.background + defaults when fills[0].color is variable-bound", () => {
    const variables: Record<string, FigmaVariable> = {
      "v:1": { id: "v:1", name: "Surface", variableCollectionId: "c:1", resolvedType: "COLOR" },
    };
    const r = makeResolver(
      variables,
      { "c:1": { id: "c:1", name: "Theme" } },
      { "v:1": "#0d0d1a" },
    );
    const result = mapFrame(
      {
        type: "FRAME",
        id: "f:1",
        name: "Root",
        width: 1920,
        height: 1080,
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
        fillBoundVariables: [{ color: { id: "v:1" } }],
      },
      { isRoot: true },
      [],
      { warn: () => undefined, variables: r },
    );
    expect((result.node as { background?: string }).background).toBeUndefined();
    expect((result.node as { bind?: { background?: string } }).bind?.background).toBe(
      "tokens.theme.surface",
    );
    expect(result.defaults).toEqual({ "tokens.theme.surface": "#0d0d1a" });
  });
});
