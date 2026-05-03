// Adapter from Figma's `figma.variables.*` API to our internal
// VariableResolverApi. Lives in `main/` because it touches the Figma
// sandbox API (the iframe UI never sees variables).
//
// Only Color, Number (FLOAT), and String variables are surfaced — Boolean
// and modes (Light/Dark) are deferred to v0.2 (ADR 001 decision #6).

import type {
  FigmaVariable,
  FigmaVariableCollection,
  VariableResolverApi,
} from "../mapping/variables";

interface FigmaVariablesApi {
  getVariableById(id: string): {
    id: string;
    name: string;
    variableCollectionId: string;
    resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
    valuesByMode: Record<string, unknown>;
  } | null;
  getVariableCollectionById(id: string): {
    id: string;
    name: string;
    defaultModeId: string;
  } | null;
}

export function createFigmaVariableResolver(api: FigmaVariablesApi): VariableResolverApi {
  return {
    getVariableById(id) {
      const v = api.getVariableById(id);
      if (!v) return null;
      const out: FigmaVariable = {
        id: v.id,
        name: v.name,
        variableCollectionId: v.variableCollectionId,
        resolvedType: v.resolvedType,
      };
      return out;
    },
    getVariableCollectionById(id) {
      const c = api.getVariableCollectionById(id);
      if (!c) return null;
      const out: FigmaVariableCollection = { id: c.id, name: c.name };
      return out;
    },
    resolveValue(variable) {
      const raw = api.getVariableById(variable.id);
      if (!raw) return null;
      const collection = api.getVariableCollectionById(raw.variableCollectionId);
      const modeId = collection?.defaultModeId ?? Object.keys(raw.valuesByMode)[0];
      if (!modeId) return null;
      const value = raw.valuesByMode[modeId];
      switch (variable.resolvedType) {
        case "COLOR":
          return rgbToCss(value);
        case "FLOAT":
          return typeof value === "number" ? value : null;
        case "STRING":
          return typeof value === "string" ? value : null;
        case "BOOLEAN":
          // v0.2 — booleans need a runtime convention.
          return null;
      }
    },
  };
}

interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

function rgbToCss(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as RGBA;
  if (typeof v.r !== "number" || typeof v.g !== "number" || typeof v.b !== "number") return null;
  const r = clamp255(v.r);
  const g = clamp255(v.g);
  const b = clamp255(v.b);
  const a = typeof v.a === "number" ? clamp01(v.a) : 1;
  if (a === 1) {
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const ra = Math.round(a * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${ra})`;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clamp255(n: number): number {
  return Math.round(clamp01(n) * 255);
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}
