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
import { readFigmaMetadata } from "../figma-metadata";
import type { BuildContext } from "./types";

export function buildText(
  prim: TextPrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportTextNode {
  const node = api.createText();
  node.name = deriveName(prim);

  const figmaMeta = readFigmaMetadata(prim);

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
  // Real Figma derives `fontWeight` (read-only getter) from `fontName.style`,
  // so assigning to it is a no-op there. We still write it for mock parity
  // — the export-side mappers read `node.fontWeight` to populate
  // `style.fontWeight`, and a fresh mock node has no fontName→fontWeight
  // resolver. The cast keeps the production code path unaware of the field.
  if (typeof prim.style?.fontWeight === "number") {
    (node as unknown as { fontWeight?: number }).fontWeight = prim.style.fontWeight;
  }
  if (prim.style?.color !== undefined) {
    const rgb = cssToRgb(prim.style.color);
    if (rgb) {
      const fill: ImportPaint = { type: "SOLID", color: rgb.rgb };
      if (rgb.opacity !== 1) fill.opacity = rgb.opacity;
      node.fills = [fill];
    }
  }
  if (prim.style?.textAlign) {
    const align = prim.style.textAlign.toUpperCase();
    if (align === "LEFT" || align === "CENTER" || align === "RIGHT" || align === "JUSTIFIED") {
      node.textAlignHorizontal = align;
    }
  }

  // Re-apply Figma-only props from metadata.figma : textCase (uppercase
  // visual transform), textAutoResize (frame-fit behaviour), and the
  // absolute position for non-auto-layout parents.
  if (figmaMeta.textCase) {
    (node as unknown as { textCase?: string }).textCase = figmaMeta.textCase;
  }
  if (figmaMeta.textAutoResize) {
    (node as unknown as { textAutoResize?: string }).textAutoResize = figmaMeta.textAutoResize;
  }
  if (figmaMeta.position) {
    (node as unknown as { x?: number; y?: number }).x = figmaMeta.position.x;
    (node as unknown as { x?: number; y?: number }).y = figmaMeta.position.y;
  }

  applyUniversal(node, prim);
  return node;
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
