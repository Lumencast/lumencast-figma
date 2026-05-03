// Figma's `figma.mixed` Symbol guard.
//
// Figma represents inconsistent / mixed properties (e.g. a rectangle whose
// four corner radii differ, a text node with several font weights, a
// component instance whose fills inherit from the main component) by
// returning `figma.mixed` — a *Symbol*, not a number / string / array.
//
// Touching such a value as if it were a primitive triggers the QuickJS
// runtime error :
//
//     TypeError: cannot convert symbol to number
//
// when QuickJS tries to coerce the Symbol into a numeric index or operand.
// Every Figma-host property read in this codebase MUST go through one of
// the typed guards below — they unwrap `figma.mixed` (or any other unexpected
// type) into a safe `undefined` sentinel.

export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function asArray<T = unknown>(v: unknown): T[] | undefined {
  return Array.isArray(v) ? (v as T[]) : undefined;
}

/** Plain-object check (NOT array, NOT null, NOT Symbol). */
export function asObject<T>(v: unknown): T | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as T) : undefined;
}

/** Typed enum-string guard — returns the value only if it matches one of
 *  the supplied literals. */
export function asEnum<T extends string>(v: unknown, values: readonly T[]): T | undefined {
  if (typeof v !== "string") return undefined;
  return (values as readonly string[]).includes(v) ? (v as T) : undefined;
}
