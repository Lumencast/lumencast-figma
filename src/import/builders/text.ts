// LSML text → Figma TEXT.
//
// `bind.value` is reverse-resolved from `bundle.defaults` when the LeafPath
// starts with `__lit.text.*` (the synthesised-literal convention) — that
// gives us the original `characters`. Otherwise we render the LeafPath
// itself as a placeholder, since the runtime would resolve it dynamically.

import type { TextPrimitive } from "~shared/lsml-types";
import type { ImportFigmaApi, ImportPaint, ImportTextNode } from "../figma-api";
import { PLUGIN_DATA_KEYS, PLUGIN_DATA_NAMESPACE } from "~shared/constants";
import { cssToRgb } from "../color";
import { applyUniversal } from "../universal";
import { readFigmaMetadata, type FigmaPaintMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import type { BuildContext } from "./types";

export function buildText(
  prim: TextPrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportTextNode {
  const node = api.createText();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? deriveName(prim);

  // CRITICAL : set the font BEFORE assigning `characters`. Figma applies
  // the font currently on `fontName` to characters at write time, so the
  // order matters even with the font pre-loaded.
  //
  // The font *style* is the tricky bit. LSML carries `fontWeight` (number)
  // and `fontStyle` ("normal" | "italic") ; Figma selects fonts by
  // `fontName.style` ("Bold", "Medium Italic", "Black", …). The export
  // side stashed the original `fontName.style` into `metadata.figma.fontStyle`,
  // so we restore it as-is when present. Falls back to a fontWeight →
  // style approximation otherwise (700 → Bold, etc.).
  if (prim.style?.fontFamily !== undefined) {
    const style = figmaMeta.fontStyle ?? styleFromWeightAndItalic(
      typeof prim.style?.fontWeight === "number" ? prim.style.fontWeight : undefined,
      prim.style?.fontStyle === "italic",
    );
    (node as unknown as { fontName: { family: string; style: string } }).fontName = {
      family: prim.style.fontFamily,
      style,
    };
  }
  // (If no fontFamily declared the node keeps Figma's default Inter Regular,
  // which the import pipeline pre-loads unconditionally.)

  // Resolve characters : prefer the literal under defaults, fall back to a
  // placeholder showing the LeafPath itself.
  const path = prim.bind?.value;
  const fromDefaults = path !== undefined ? ctx.defaults[path] : undefined;
  if (typeof fromDefaults === "string") {
    node.characters = fromDefaults;
  } else if (path !== undefined) {
    node.characters = `{${path}}`;
  } else {
    node.characters = "";
  }

  // Preserve the synthesised `__lit.text.*` path so the next export reproduces
  // it (the alternative is regenerating from the new Figma node id, which
  // breaks byte-stable roundtrip).
  if (path && path.startsWith("__lit.")) {
    node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_KEYS.litBindValue, path);
  }

  if (prim.style?.fontSize !== undefined) node.fontSize = prim.style.fontSize;
  // LSML carries `lineHeight` as a ratio multiplier (e.g. 1 = 100%, 1.2 =
  // 120%) — map back to Figma's PERCENT unit which encodes the same.
  // Without this the imported text falls back to AUTO leading and source
  // designs that explicitly set `leading-none` (1.0) render with a
  // visibly larger line-box.
  if (typeof prim.style?.lineHeight === "number") {
    try {
      (node as unknown as { lineHeight?: { unit: string; value?: number } }).lineHeight = {
        unit: "PERCENT",
        value: prim.style.lineHeight * 100,
      };
    } catch {
      // Some font/glyph combinations reject the setter — tolerate.
    }
  }
  // LSML letterSpacing is in pixels (LSML 1.1 §4.4) — Figma's setter
  // takes the PIXELS variant of its discriminated union. Plain numbers
  // round-trip cleanly ; PERCENT-mode source spacing is normalised to
  // pixels by the mapping side via fontSize.
  if (typeof prim.style?.letterSpacing === "number") {
    try {
      (node as unknown as { letterSpacing?: { unit: string; value: number } }).letterSpacing = {
        unit: "PIXELS",
        value: prim.style.letterSpacing,
      };
    } catch {
      // Tolerate mock surfaces that don't accept letterSpacing.
    }
  }
  // `fontWeight` on a real Figma TextNode is a read-only getter derived
  // from `fontName.style` ; assigning to it throws `no setter for property
  // fontWeight`. The mock-side test API DOES accept the assignment (and
  // relies on it for byte-stable roundtrip — there's no fontName→weight
  // resolver in the mock). We try the assignment defensively : in
  // production it harmlessly throws and we ignore ; in the mock it
  // takes effect as before.
  if (typeof prim.style?.fontWeight === "number") {
    try {
      (node as unknown as { fontWeight?: number }).fontWeight = prim.style.fontWeight;
    } catch {
      // Real Figma — read-only setter. Visual weight is already controlled
      // by `fontName.style` set above.
    }
  }
  if (prim.style?.color !== undefined) {
    const rgb = cssToRgb(prim.style.color);
    if (rgb) {
      const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
      if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
      node.fills = [fill];
    }
  }
  // `metadata.figma.textFills` overrides `style.color` when present —
  // covers gradients, multi-fill, per-paint blend / opacity that LSML's
  // single-color field can't express. Default-NORMAL paints with a
  // single SOLID fill round-trip via `style.color` instead.
  if (figmaMeta.textFills && figmaMeta.textFills.length > 0) {
    const paints = figmaMeta.textFills
      .map((p) => figmaPaintMetadataToImportPaint(p))
      .filter((p): p is ImportPaint => p !== null);
    if (paints.length > 0) node.fills = paints;
  }
  if (prim.style?.textAlign) {
    const align = prim.style.textAlign.toUpperCase();
    if (align === "LEFT" || align === "CENTER" || align === "RIGHT" || align === "JUSTIFIED") {
      node.textAlignHorizontal = align;
    }
  }
  // textAlignVertical : Figma exposes TOP / CENTER / BOTTOM. The default is
  // TOP, but designs often center text inside a fixed-height box (e.g.
  // a 43px Arial label inside a 67×389 frame, vertically centered). We
  // stash the source's value in metadata.figma.textAlignVertical and
  // restore it here — without this the imported text drifts to the top
  // of its box and overlaps the wrong vertical position.
  if (figmaMeta.textAlignVertical) {
    try {
      (node as unknown as { textAlignVertical?: string }).textAlignVertical =
        figmaMeta.textAlignVertical;
    } catch {
      // Mock surfaces may not accept the setter — tolerate.
    }
  }
  // textDecoration : LSML's CSS-style strings → Figma's enum. Default
  // NONE / undefined collapses to "NONE".
  if (typeof prim.style?.textDecoration === "string") {
    let decoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH" = "NONE";
    if (prim.style.textDecoration === "underline") decoration = "UNDERLINE";
    else if (prim.style.textDecoration === "line-through") decoration = "STRIKETHROUGH";
    if (decoration !== "NONE") {
      try {
        (node as unknown as { textDecoration?: string }).textDecoration = decoration;
      } catch {
        // Tolerate.
      }
    }
  }

  // textCase : prefer the canonical `style.textTransform` (LSML 1.1
  // §4.4.1). Fall back to `metadata.figma.textCase` for v0.1 bundles
  // produced before the spec change.
  const textCase =
    transformToTextCase(prim.style?.textTransform) ?? figmaMeta.textCase;
  if (textCase) {
    (node as unknown as { textCase?: string }).textCase = textCase;
  }
  if (figmaMeta.textAutoResize) {
    (node as unknown as { textAutoResize?: string }).textAutoResize = figmaMeta.textAutoResize;
  }
  // Restore the source's explicit dimensions when textAutoResize ≠
  // WIDTH_AND_HEIGHT (the createText default). HEIGHT fixes width and
  // hugs height to content ; NONE / TRUNCATE fix both. Without this,
  // the imported text grows to its natural-content width (e.g. a 1034px
  // wide line of "On demand vs formalized" balloons to 1425px and the
  // parent stack's clipsContent crops it visibly).
  //
  // resize MUST come after textAutoResize : Figma rejects resize() while
  // the node is in WIDTH_AND_HEIGHT mode (auto-resize takes precedence).
  if (figmaMeta.textAutoResize && figmaMeta.size) {
    try {
      node.resize(figmaMeta.size.w, figmaMeta.size.h);
    } catch {
      // Some font/glyph combinations or pending font loads make the
      // setter throw — tolerate so the rest of the build continues.
    }
  }
  // Position : prefer the canonical universal prop (LSML 1.1 §5.4) ;
  // fall back to `metadata.figma.position` for v0.1 bundles. Skip when
  // `meta.transform` is present — the relativeTransform setter inside
  // applyFigmaExtras encodes position + linear atomically (FRAME-ancestor-
  // relative), so an x/y override here would corrupt the translation.
  if (!figmaMeta.transform) {
    const pos = prim.position ?? figmaMeta.position;
    if (pos) {
      (node as unknown as { x?: number; y?: number }).x = pos.x;
      (node as unknown as { x?: number; y?: number }).y = pos.y;
    }
  }

  // Multi-style ranges : restore per-character styling captured by the
  // mapping side (multi-fontName, multi-color, multi-fontSize text). All
  // setters are guarded with try/catch + optional-chaining since the
  // mock surface in vitest doesn't implement them.
  applyTextSegments(node, figmaMeta.textSegments);

  applyUniversal(node, prim);
  applyFigmaExtras(node, figmaMeta);
  return node;
}

/** Apply each captured per-range styling to the freshly-built TEXT node.
 *  Must run AFTER `node.characters` is set (the setters reject ranges
 *  that exceed the current character count) and BEFORE applyFigmaExtras
 *  so node-level metadata doesn't override per-range values. */
function applyTextSegments(
  node: ImportTextNode,
  segments: NonNullable<ReturnType<typeof readFigmaMetadata>["textSegments"]> | undefined,
): void {
  if (!segments || segments.length === 0) return;
  for (const seg of segments) {
    if (seg.end <= seg.start) continue;
    if (seg.fontName) {
      try {
        node.setRangeFontName?.(seg.start, seg.end, seg.fontName);
      } catch {
        // Font may not be loaded — preloadFonts is best-effort. Skip.
      }
    }
    if (seg.fontSize !== undefined) {
      try {
        node.setRangeFontSize?.(seg.start, seg.end, seg.fontSize);
      } catch {
        // Tolerate.
      }
    }
    if (seg.fills && seg.fills.length > 0) {
      const paints = seg.fills
        .map((p) => figmaPaintMetadataToImportPaint(p))
        .filter((p): p is ImportPaint => p !== null);
      if (paints.length > 0) {
        try {
          node.setRangeFills?.(seg.start, seg.end, paints);
        } catch {
          // Tolerate.
        }
      }
    }
    if (seg.textCase) {
      try {
        node.setRangeTextCase?.(seg.start, seg.end, seg.textCase);
      } catch {
        // Tolerate.
      }
    }
    if (seg.textDecoration && seg.textDecoration !== "NONE") {
      try {
        node.setRangeTextDecoration?.(seg.start, seg.end, seg.textDecoration);
      } catch {
        // Tolerate.
      }
    }
    if (seg.letterSpacing) {
      try {
        node.setRangeLetterSpacing?.(seg.start, seg.end, seg.letterSpacing);
      } catch {
        // Tolerate.
      }
    }
    if (seg.lineHeight) {
      try {
        node.setRangeLineHeight?.(seg.start, seg.end, seg.lineHeight);
      } catch {
        // Tolerate.
      }
    }
    if (seg.hyperlink && seg.hyperlink.url) {
      try {
        node.setRangeHyperlink?.(seg.start, seg.end, {
          type: "URL",
          value: seg.hyperlink.url,
        });
      } catch {
        // Tolerate.
      }
    }
  }
}

/** Map LSML `style.textTransform` (LSML §4.4.1) back to Figma's `textCase`.
 *  Returns undefined when no transform is declared, leaving the caller to
 *  fall back to `metadata.figma.textCase` for v0.1 bundles. */
function transformToTextCase(
  tt: string | undefined,
): "UPPER" | "LOWER" | "TITLE" | undefined {
  if (tt === "uppercase") return "UPPER";
  if (tt === "lowercase") return "LOWER";
  if (tt === "capitalize") return "TITLE";
  return undefined;
}

/** Derive a Figma `fontName.style` string from LSML's numeric `fontWeight`
 *  and `italic` flag. This is a best-effort fallback for bundles produced
 *  before metadata.figma.fontStyle was captured. The 9-step CSS weight
 *  axis maps to common Figma style names ; non-Inter fonts may not have
 *  every weight available — the loader picks the nearest installed
 *  variant. */
function styleFromWeightAndItalic(weight: number | undefined, italic: boolean): string {
  const base = baseStyleFromWeight(weight);
  return italic ? (base === "Regular" ? "Italic" : `${base} Italic`) : base;
}

function baseStyleFromWeight(weight: number | undefined): string {
  if (weight === undefined) return "Regular";
  if (weight <= 100) return "Thin";
  if (weight <= 200) return "ExtraLight";
  if (weight <= 300) return "Light";
  if (weight <= 400) return "Regular";
  if (weight <= 500) return "Medium";
  if (weight <= 600) return "SemiBold";
  if (weight <= 700) return "Bold";
  if (weight <= 800) return "ExtraBold";
  return "Black";
}

function deriveName(prim: TextPrimitive): string {
  // Reverse the layer-name convention : if the bind path is a real (non-
  // synthesised) leaf, keep the [bind:...] prefix so re-export roundtrips.
  const path = prim.bind?.value;
  if (path && !path.startsWith("__lit.")) {
    return `[bind:${path}] Text`;
  }
  return "Text";
}

/** Reconstruct an ImportPaint from the serialisable
 *  `metadata.figma.textFills[]` shape. Used by the text builder when
 *  the source carried a non-trivial fill (gradient, multi-fill, etc.). */
function figmaPaintMetadataToImportPaint(p: FigmaPaintMetadata): ImportPaint | null {
  if (p.type === "SOLID") {
    if (!p.color) return null;
    const out: ImportPaint = { type: "SOLID", color: p.color };
    if (p.opacity !== undefined && p.opacity !== 1) out.opacity = p.opacity;
    if (p.visible === false) out.visible = false;
    if (p.blendMode) (out as unknown as Record<string, unknown>)["blendMode"] = p.blendMode;
    return out;
  }
  if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL") {
    if (!p.gradientStops || p.gradientStops.length < 1) return null;
    const transform =
      p.gradientTransform && p.gradientTransform.length === 2
        ? p.gradientTransform
        : [
            [1, 0, 0],
            [0, 1, 0],
          ];
    const out: ImportPaint = {
      type: p.type,
      gradientStops: p.gradientStops,
      gradientTransform: transform,
    };
    if (p.opacity !== undefined && p.opacity !== 1) out.opacity = p.opacity;
    if (p.visible === false) out.visible = false;
    if (p.blendMode) (out as unknown as Record<string, unknown>)["blendMode"] = p.blendMode;
    return out;
  }
  return null;
}
