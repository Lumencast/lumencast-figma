// Figma variables → LSML token bindings (LSML §17.0 composition pattern).
//
// LSML 1.1 has no "tokens" primitive — design tokens are expressed as plain
// LeafPaths. This plugin adopts the convention :
//
//   tokens.<group>.<name>
//
// where `<group>` is the Figma variable's collection name (or 'default'
// when the variable lives at the collection root) and `<name>` is the
// variable's name. Both are slugified to LeafPath-safe identifiers.
//
// Figma exposes `boundVariables` on every node + paint that may reference a
// variable. When a paint has a bound variable for `color` (or another
// supported alias), we :
//
//   1. Resolve the variable to a CSS color / number / string value via
//      `figma.variables.getVariableById(id).resolveForConsumer(node)`.
//   2. Add an entry under `defaults["tokens.<group>.<name>"]` with the
//      resolved value (so the bundle renders correctly at first paint).
//   3. Remove the static value from the LSML primitive and add a
//      `bindStyle: { color: "tokens.<group>.<name>" }` entry instead.
//
// LSML 1.1 supports Color / Number / String variables. Boolean and modes
// (Light/Dark) are deferred to v0.2 — see ADR 001 decision #6.

import type { LeafPath } from "~shared/lsml-types";

/** Figma's `Variable` interface, minimal surface used by the resolver. */
export interface FigmaVariable {
  id: string;
  name: string;
  /** Variable collection identifier — used to derive the `<group>` segment. */
  variableCollectionId: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
}

export interface FigmaVariableCollection {
  id: string;
  name: string;
}

export interface VariableResolution {
  /** `tokens.<group>.<name>` LeafPath. */
  path: LeafPath;
  /** Resolved value (CSS color, number, string). */
  value: string | number;
}

export interface VariableResolverApi {
  getVariableById(id: string): FigmaVariable | null;
  getVariableCollectionById(id: string): FigmaVariableCollection | null;
  /** Resolve a variable to its value in the given context. The plugin owns
   *  the conversion from Figma's `RGBA` / `number` / `string` form to a CSS
   *  color string / number / string ; this hook only fetches the raw value. */
  resolveValue(variable: FigmaVariable): string | number | null;
}

const TOKEN_PREFIX = "tokens";

/** Slugify a Figma variable / collection name into a LeafPath segment.
 *  Uppercase → lowercase ; spaces and any non-`[a-z0-9_]` → underscore ;
 *  consecutive underscores collapsed ; empty falls back to `unnamed`. */
export function slugifySegment(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return slug.length > 0 ? slug : "unnamed";
}

export function tokenPathFor(variable: FigmaVariable, api: VariableResolverApi): LeafPath {
  const collection = api.getVariableCollectionById(variable.variableCollectionId);
  const group = collection ? slugifySegment(collection.name) : "default";
  const name = slugifySegment(variable.name);
  return `${TOKEN_PREFIX}.${group}.${name}`;
}

/** Resolve a Figma variable id → { tokenPath, value } pair, or null when
 *  the variable is unsupported (BOOLEAN in v0.1) or unresolvable. */
export function resolveVariable(id: string, api: VariableResolverApi): VariableResolution | null {
  const v = api.getVariableById(id);
  if (!v) return null;
  if (v.resolvedType !== "COLOR" && v.resolvedType !== "FLOAT" && v.resolvedType !== "STRING") {
    return null; // BOOLEAN — v0.2.
  }
  const value = api.resolveValue(v);
  if (value === null) return null;
  return { path: tokenPathFor(v, api), value };
}

/** A small bundle of `bindStyle` keys + matching `defaults` entries collected
 *  while processing a node's bound variables. */
export interface NodeVariableBindings {
  bindStyle: Record<string, LeafPath>;
  defaults: Record<string, string | number>;
}

export function emptyBindings(): NodeVariableBindings {
  return { bindStyle: {}, defaults: {} };
}

/** Walk a node's `boundVariables` map for the supported style keys, resolve
 *  each, and produce bindStyle + defaults entries. */
export function collectStyleBindings(
  boundVariables: Record<string, { id?: string; type?: string }> | undefined,
  api: VariableResolverApi,
  styleKeyMap: Record<string, string>,
): NodeVariableBindings {
  const out = emptyBindings();
  if (!boundVariables) return out;
  for (const [figmaKey, ref] of Object.entries(boundVariables)) {
    const styleKey = styleKeyMap[figmaKey];
    if (!styleKey || !ref?.id) continue;
    const resolved = resolveVariable(ref.id, api);
    if (!resolved) continue;
    out.bindStyle[styleKey] = resolved.path;
    out.defaults[resolved.path] = resolved.value;
  }
  return out;
}
