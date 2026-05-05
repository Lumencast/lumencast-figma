// Figma FRAME without auto-layout → LSML `frame` (§4.3).
// Auto-layout FRAMEs route to `mapStack` (§4.1).
//
// Children are mapped recursively by the orchestrator. Position is computed
// relative to the parent frame ; the root frame ignores `position` (LSML
// runtime treats the root as the document origin).

import type { Bind, Fill, FramePrimitive } from "~shared/lsml-types";
import { paintToFill, rawGradientTransform, type FigmaPaint, paintToSolidCss } from "./color";
import { withFigmaMetadata, type FigmaImageBackground } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import { capturePaintExtras } from "./image";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { resolveVariable } from "./variables";
import { asArray, asBoolean, asNumber } from "./figma-mixed";
import type { MappingContext, MappingResult } from "./types";

export interface FrameMapInput {
  type: "FRAME" | "COMPONENT" | "INSTANCE" | "GROUP" | "BOOLEAN_OPERATION";
  id: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  fills?: FigmaPaint[];
  /** Per-fill bound variable references — same shape as on shape nodes. */
  fillBoundVariables?: ({ color?: { id: string } } | undefined)[];
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  /** Defaults to true on FrameNode ; we capture it explicitly so re-import
   *  doesn't trigger Figma's auto-grow behaviour for off-frame children. */
  clipsContent?: boolean;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}

export interface FrameMapOptions {
  /** True when this frame is the root of the export (skip `position`). */
  isRoot: boolean;
  /** Parent's coordinate origin in Figma — children's `x/y` are absolute in Figma. */
  parentX?: number;
  parentY?: number;
  /** Cumulative rotation of the closest rotated ancestor (degrees). */
  parentRotation?: number;
  /** True when the immediate source parent is GROUP / BOOLEAN_OPERATION. */
  parentIsTransparent?: boolean;
  /** Composed transparent-Group ancestor chain — see TextMapOptions. */
  groupChainTransform?: number[][];
}

export function mapFrame(
  node: FrameMapInput,
  opts: FrameMapOptions,
  children: FramePrimitive["children"],
  ctx?: MappingContext,
): MappingResult {
  const parsed = parseLayerName(node.name, { primitiveKind: "frame" });

  const prim: FramePrimitive = {
    kind: "frame",
    children,
    ...extractUniversal(node, {
      parentRotation: opts.parentRotation ?? 0,
      parentIsTransparent: opts.parentIsTransparent === true,
    }),
  };

  const w = asNumber(node.width) ?? 0;
  const h = asNumber(node.height) ?? 0;
  if (opts.isRoot) {
    prim.size = { w: roundTo3(w), h: roundTo3(h) };
  } else {
    prim.size = { w: roundTo3(w), h: roundTo3(h) };
    const nx = asNumber(node.x) ?? 0;
    const ny = asNumber(node.y) ?? 0;
    const px = opts.parentX ?? 0;
    const py = opts.parentY ?? 0;
    const x = nx - px;
    const y = ny - py;
    if (x !== 0 || y !== 0) prim.position = { x: roundTo3(x), y: roundTo3(y) };
  }

  // Backgrounds : single solid → `background`, multi/gradient → `backgrounds[]`.
  // IMAGE fills are NOT representable in LSML's Fill type — capture them
  // separately under `metadata.figma.imageBackgrounds[]` with the asset
  // path + paint extras (blendMode, scaleMode, opacity, imageTransform,
  // …) so avatar circles, hero banners, card image backgrounds round-trip.
  //
  // We collect `fills` and `gradientTransforms` in lockstep : if any paint
  // returns null from `paintToFill` (invisible, unsupported), it's skipped
  // from BOTH arrays so transforms[i] always lines up with fills[i] /
  // backgrounds[i]. Earlier two-pass filter+map produced length mismatches
  // when an invisible paint sat between two visible ones.
  const fillsArr = asArray<FigmaPaint>(node.fills) ?? [];
  const fills: Fill[] = [];
  const gradientTransformsAligned: (number[][] | null)[] = [];
  for (const paint of fillsArr) {
    if (paint.type === "IMAGE") continue;
    const fill = paintToFill(paint);
    if (fill === null) continue;
    fills.push(fill);
    gradientTransformsAligned.push(rawGradientTransform(paint));
  }
  const imageAssetRefs: string[] = [];
  const imageBackgrounds: FigmaImageBackground[] = [];
  if (ctx?.registerImageHash) {
    for (const paint of fillsArr) {
      if (paint.type !== "IMAGE") continue;
      const hash = (paint as unknown as { imageHash?: unknown }).imageHash;
      if (typeof hash !== "string" || hash === "") continue;
      const src = ctx.registerImageHash(hash);
      const extras = capturePaintExtras(paint) ?? {};
      imageBackgrounds.push({ ...extras, src });
      imageAssetRefs.push(hash);
    }
  }
  if (fills.length === 1 && fills[0]?.kind === "solid" && fills[0].opacity === undefined) {
    const single = fillsArr.find((p) => p.type === "SOLID");
    if (single) {
      const css = paintToSolidCss(single);
      if (css) prim.background = css;
    }
  } else if (fills.length > 0) {
    prim.backgrounds = fills;
  }

  // Preserve raw gradient matrices parallel-indexed with the emitted fills
  // for byte-stable round-trip. Helper drops the array when every entry is
  // null, so plain solid backgrounds carry no metadata noise.
  if (fills.length > 0 && gradientTransformsAligned.some((t) => t !== null)) {
    withFigmaMetadata(prim, { gradientTransforms: gradientTransformsAligned });
  }

  if (parsed.bindStyle) prim.bindStyle = parsed.bindStyle;
  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  // Variable bindings : when fills[0] has a bound color variable AND the
  // frame rendered a single solid `background`, replace the static
  // background with `bind: { background: "tokens.<group>.<name>" }` and
  // seed defaults.
  let defaults: Record<string, unknown> | undefined;
  const bind: Bind = parsed.bind ?? {};
  if (ctx?.variables && prim.background !== undefined && node.fillBoundVariables?.[0]?.color?.id) {
    const id = node.fillBoundVariables[0].color.id;
    const resolved = resolveVariable(id, ctx.variables);
    if (resolved) {
      bind["background"] = resolved.path;
      delete prim.background;
      defaults = { [resolved.path]: resolved.value };
    }
  }
  if (Object.keys(bind).length > 0) prim.bind = bind;

  // `clipsContent` is a first-class field as of LSML 1.1 (§4.3). Default
  // is `true` ; we only emit when the source frame diverges, so plain
  // frames don't carry redundant noise.
  //
  // GROUP and BOOLEAN_OPERATION nodes in Figma never clip their children
  // (they don't even have a `clipsContent` property). When we lower them
  // to LSML `frame`, we MUST emit `clipsContent: false` explicitly,
  // otherwise the import side defaults to true and clips children that
  // legitimately extend past the group's bounding box (e.g. an Ellipse
  // 865×865 inside a Group whose bbox is only 701×701 — the visible
  // overflow is what the user sees as a decorative sphere).
  const clips = asBoolean(node.clipsContent);
  if (node.type === "GROUP" || node.type === "BOOLEAN_OPERATION") {
    prim.clipsContent = false;
  } else if (clips === false) {
    prim.clipsContent = false;
  }

  // Stash the source layer name so the import side can restore it
  // verbatim. Skips when the name is the empty string or just whitespace.
  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  // Mark groups + boolean-operations so the import side can convert the
  // freshly-created LSML frame back into a real Figma GroupNode (via
  // `figma.group()`) — preserves the layer-panel distinction.
  if (node.type === "GROUP" || node.type === "BOOLEAN_OPERATION") {
    withFigmaMetadata(prim, { sourceType: node.type });
  }

  // Stash any IMAGE fills captured above. Done here (after sourceType)
  // so the merge helper sees both keys in one withFigmaMetadata call
  // pattern.
  if (imageBackgrounds.length > 0) {
    withFigmaMetadata(prim, { imageBackgrounds });
  }

  // Universal x-figma.authoring/1 extras (effects, blendMode, mask flags,
  // per-corner radii + smoothing, stroke details, constraints, layout
  // overrides). Per-primitive captures above handle frame-specific keys.
  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim, {
    localPosition: prim.position ?? { x: 0, y: 0 },
    parentIsTransparent: opts.parentIsTransparent === true,
    ...(opts.groupChainTransform ? { groupChainTransform: opts.groupChainTransform } : {}),
  });

  const result: MappingResult = { node: prim };
  if (defaults) result.defaults = defaults;
  if (imageAssetRefs.length > 0) result.assetRefs = imageAssetRefs;
  return result;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
