// `metadata.figma.*` escape hatch (LSML §17.4) for Figma-specific properties
// the LSML schema cannot carry natively. Captured by the export side, read
// by the import side. Runtimes (`@lumencast/runtime`, Orion, Prism) ignore
// `metadata.*` per LSML §1, so storing this is a non-breaking authoring
// affordance.
//
// What's in here :
//   - `position { x, y }` — absolute placement for non-frame children of
//     absolute (non-auto-layout) frames. LSML §4.x only declares position
//     on `frame` and `instance` ; without this metadata, every shape /
//     image / text in an absolute layout collapses to (0, 0) on re-import.
//   - `size { w, h }` — for vector-geometry shapes. LSML's `shape.size` is
//     "required for rect/circle" and unspecified for path ; without an
//     explicit size, Figma renders the vector at its path's natural size.
//   - `textCase` ("UPPER" | "LOWER" | "TITLE" | "ORIGINAL") — Figma's
//     visual text-case transform, applied at render time without changing
//     the underlying `characters`. LSML has no equivalent.
//   - `textAutoResize` ("NONE" | "WIDTH" | "HEIGHT" | "WIDTH_AND_HEIGHT")
//     — Figma's text node resize behaviour. LSML doesn't carry it.
//   - `fontStyle` — the Figma `fontName.style` ("Bold", "Medium", "Light",
//     "Black", "Regular", "Italic", "Bold Italic", …). LSML carries
//     `fontWeight` (number) and `fontStyle` ("normal" | "italic"), neither
//     of which round-trips through Figma's font-selection rules cleanly.
//   - `clipsContent` — frame clipping flag. Defaults vary across Figma's
//     frame creation paths ; we capture it explicitly to avoid re-import
//     auto-grow surprises.

export interface FigmaMetadata {
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  /** Original Figma `fontName.style` string, e.g. "Bold", "Medium Italic". */
  fontStyle?: string;
  clipsContent?: boolean;
}

/** Decorate a primitive's `metadata` block with figma-specific keys. Only
 *  emits a metadata block when at least one figma key is non-empty. */
export function withFigmaMetadata<T extends { metadata?: Record<string, unknown> }>(
  prim: T,
  figma: FigmaMetadata,
): T {
  const filtered = pruneEmpty(figma);
  if (Object.keys(filtered).length === 0) return prim;
  prim.metadata = { ...(prim.metadata ?? {}), figma: filtered };
  return prim;
}

/** Read the figma metadata block off a primitive, type-narrowing the
 *  freeform `metadata` field. Returns an empty object when absent. */
export function readFigmaMetadata(prim: { metadata?: Record<string, unknown> }): FigmaMetadata {
  const meta = prim.metadata?.["figma"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as FigmaMetadata;
}

function pruneEmpty(meta: FigmaMetadata): FigmaMetadata {
  const out: FigmaMetadata = {};
  if (meta.position && (meta.position.x !== 0 || meta.position.y !== 0)) {
    out.position = meta.position;
  }
  if (meta.size && (meta.size.w > 0 || meta.size.h > 0)) {
    out.size = meta.size;
  }
  if (meta.textCase && meta.textCase !== "ORIGINAL") out.textCase = meta.textCase;
  if (meta.textAutoResize && meta.textAutoResize !== "NONE") out.textAutoResize = meta.textAutoResize;
  if (meta.fontStyle) out.fontStyle = meta.fontStyle;
  if (meta.clipsContent !== undefined) out.clipsContent = meta.clipsContent;
  return out;
}
