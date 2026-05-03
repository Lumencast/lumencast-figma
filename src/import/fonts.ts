// Font collection + preload for the import pipeline.
//
// Figma refuses to write `text.characters` on a TEXT node whose font isn't
// loaded yet — it throws :
//
//     Cannot write to node with unloaded font "<family> <style>".
//     Please call figma.loadFontAsync({...}) and await it first.
//
// The plugin's import builders are synchronous (they construct the Figma
// node tree top-down). To satisfy Figma's font contract without making the
// builders async, we do a separate pre-pass : walk the bundle, collect
// every (family, style) pair referenced by a text primitive, and
// `await api.loadFontAsync(...)` for each before any builder runs.

import type { PrimitiveNode, TextPrimitive } from "~shared/lsml-types";
import type { FontReference, ImportFigmaApi } from "./figma-api";

/** Figma's default text font when no style is declared. Loaded for every
 *  imported scene since most text primitives don't carry an explicit
 *  fontFamily (the export pipeline drops it when it'd be the default). */
const DEFAULT_FONT: FontReference = { family: "Inter", style: "Regular" };

export function collectFonts(layout: PrimitiveNode): FontReference[] {
  const seen = new Map<string, FontReference>();
  // Always queue the default font — text primitives without an explicit
  // fontFamily inherit Figma's default.
  seen.set(`${DEFAULT_FONT.family}${DEFAULT_FONT.style}`, DEFAULT_FONT);

  const visit = (node: PrimitiveNode): void => {
    if (node.kind === "text") {
      const text = node as TextPrimitive;
      const family = text.style?.fontFamily;
      if (typeof family === "string" && family.length > 0) {
        const style = text.style?.fontStyle === "italic" ? "Italic" : "Regular";
        const key = `${family}${style}`;
        if (!seen.has(key)) seen.set(key, { family, style });
      }
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const c of node.children) visit(c as PrimitiveNode);
    }
  };
  visit(layout);
  return Array.from(seen.values());
}

export async function preloadFonts(
  api: ImportFigmaApi,
  fonts: FontReference[],
  warn?: (code: string, message: string) => void,
): Promise<void> {
  await Promise.all(
    fonts.map(async (f) => {
      try {
        await api.loadFontAsync(f);
      } catch (err) {
        warn?.(
          "FONT_LOAD_FAILED",
          `Could not load font "${f.family} ${f.style}" : ${
            err instanceof Error ? err.message : String(err)
          }. Text using this font will fall back to the runtime default.`,
        );
      }
    }),
  );
}
