// `metadata.figma.*` escape hatch (LSML §17.4) for Figma-specific properties
// the LSML schema cannot carry natively. Captured by the export side, read
// by the import side. Runtimes (`@lumencast/runtime`, Orion, Prism) ignore
// `metadata.*` per LSML §1, so storing this is a non-breaking authoring
// affordance.
//
// What's in here :
//   - `textCase` (partial — "SMALL_CAPS" / "SMALL_CAPS_FORCED" only).
//     Figma's visual text-case transform applied at render time without
//     changing the underlying `characters`. LSML §4.4.1 covers
//     "UPPER" / "LOWER" / "TITLE" via `style.textTransform` ; only the
//     SMALL_CAPS variants have no spec equivalent and stay here.
//   - `textAutoResize` ("NONE" | "WIDTH" | "HEIGHT" | "WIDTH_AND_HEIGHT")
//     — Figma's text node resize behaviour. LSML doesn't carry it.
//   - `fontStyle` — the Figma `fontName.style` ("Bold", "Medium", "Light",
//     "Black", "Regular", "Italic", "Bold Italic", …). LSML carries
//     `fontWeight` (number) and `fontStyle` ("normal" | "italic"), neither
//     of which round-trips through Figma's font-selection rules cleanly.
//   - `gradientTransforms` — raw Figma 2x3 affine matrices for gradient
//     fills, parallel-indexed with `fills[]`. Preserves rotation +
//     translation + scale of gradient handles that LSML's `angle_deg`
//     flattens.
//   - `layerName` — original Figma `node.name` (including any
//     `[bind:...]` directives). Restored verbatim on re-import so the
//     layer panel in Figma matches the source exactly.
//
// History — fields removed at v0.2 cleanup :
//   - `position`, `size`, `clipsContent` were the v0.1 capture for
//     placement / dimensions / frame clipping. v0.2 promoted them to
//     first-class LSML fields (`prim.position` per §5.4, `shape.size`
//     for path geometry, `frame.clipsContent` per §4.3). The metadata
//     stash is no longer emitted nor read ; v0.1 bundles must be
//     re-imported via plugin v0.1.x.

export interface FigmaMetadata {
  /** "SMALL_CAPS" / "SMALL_CAPS_FORCED" only — the other Figma textCase
   *  values map to LSML §4.4.1 `style.textTransform` and aren't stashed
   *  here. */
  textCase?: "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  /** Original Figma `fontName.style` string, e.g. "Bold", "Medium Italic". */
  fontStyle?: string;
  /** Raw Figma 2x3 affine matrices, parallel-indexed with `fills[]` (or
   *  `backgrounds[]` on a frame). Preserves rotation+translation+scale of
   *  gradient handles that LSML's `angle_deg` flattens. Each entry is null
   *  for non-gradient fills (solid, image). Round-trip uses these in
   *  preference to reconstructing from `angle_deg` when present. */
  gradientTransforms?: (number[][] | null)[];
  /** Original Figma layer name (`node.name`) including any `[bind:...]`
   *  directives. The import side restores it verbatim so the layer panel
   *  in Figma matches the source exactly — useful when iterating on
   *  layouts via re-import + manual tweak + re-export. */
  layerName?: string;
}

/** Decorate a primitive's `metadata` block with figma-specific keys. Only
 *  emits a metadata block when at least one figma key is non-empty.
 *
 *  Mappers call this multiple times during a single primitive's
 *  construction (once per category : position, gradient transforms,
 *  layer name, ...). Each call merges its keys into any pre-existing
 *  `figma` sub-block — early versions OVERWROTE the block, losing fields
 *  set by previous calls. */
export function withFigmaMetadata<T extends { metadata?: Record<string, unknown> }>(
  prim: T,
  figma: FigmaMetadata,
): T {
  const filtered = pruneEmpty(figma);
  if (Object.keys(filtered).length === 0) return prim;
  const existing = (prim.metadata?.["figma"] as FigmaMetadata | undefined) ?? {};
  prim.metadata = {
    ...(prim.metadata ?? {}),
    figma: { ...existing, ...filtered },
  };
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
  if (meta.textCase) out.textCase = meta.textCase;
  if (meta.textAutoResize && meta.textAutoResize !== "NONE")
    out.textAutoResize = meta.textAutoResize;
  if (meta.fontStyle) out.fontStyle = meta.fontStyle;
  if (meta.gradientTransforms && meta.gradientTransforms.length > 0) {
    // Drop the array if every entry is null (no gradients had transforms
    // worth preserving) — keeps the metadata block empty in the common
    // single-solid-fill case.
    if (meta.gradientTransforms.some((t) => t !== null)) {
      out.gradientTransforms = meta.gradientTransforms;
    }
  }
  if (meta.layerName) out.layerName = meta.layerName;
  return out;
}
