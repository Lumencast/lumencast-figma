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
import type { BuildContext } from "./types";

export function buildText(
  prim: TextPrimitive,
  api: ImportFigmaApi,
  ctx: BuildContext,
): ImportTextNode {
  const node = api.createText();
  node.name = deriveName(prim);

  // CRITICAL : set the font BEFORE assigning `characters`. Figma rejects
  // any write to `text.characters` if the font isn't loaded, AND the font
  // applied to `characters` is the one currently set on `fontName`. The
  // import pipeline pre-loads every font via api.loadFontAsync up-front
  // (see src/import/fonts.ts), so by the time we land here, the font is
  // ready ; we just need to assign it before writing characters.
  if (prim.style?.fontFamily !== undefined) {
    (node as unknown as { fontName: { family: string; style: string } }).fontName = {
      family: prim.style.fontFamily,
      style: prim.style.fontStyle === "italic" ? "Italic" : "Regular",
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
  if (typeof prim.style?.fontWeight === "number") node.fontWeight = prim.style.fontWeight;
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

  applyUniversal(node, prim);
  return node;
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
