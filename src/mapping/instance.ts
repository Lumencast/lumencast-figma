// Figma INSTANCE → LSML `instance` (LSML §4.9, 1.1+).
//
// An INSTANCE node mounts a Figma component. By default the plugin recurses
// through the instance's content (treating it like a FRAME) so the produced
// bundle is fully self-contained.
//
// When the designer explicitly marks an INSTANCE as "this is a separate
// scene" via plugin data, we emit `kind: "instance"` referencing the target
// scene by id + content hash, matching LSML §4.9 :
//
//   lumencast.instance.scene_id        "scoreboard-template"
//   lumencast.instance.scene_version   "sha256:c4b9..."
//   lumencast.instance.params          '{"team_a":"Alpha","score_a":14}'
//   lumencast.instance.bind_params     '{"team_b":"match.team_b.name"}'
//   lumencast.instance.fit             "contain"
//
// `params` is the static map ; `bind_params` are reactive LeafPath bindings.
// They MUST NOT overlap on a key (LSML §4.9 mutually-exclusive).

import type { InstancePrimitive, LeafPath } from "~shared/lsml-types";
import { extractUniversal } from "./universal";
import { parseLayerName } from "../export/bindings";
import { withFigmaMetadata } from "./figma-metadata";
import { captureFigmaExtras } from "./figma-extras";
import type { MappingContext, MappingResult } from "./types";
import { PLUGIN_DATA_NAMESPACE } from "~shared/constants";

interface InstanceFigmaNode {
  /** Either a real Figma INSTANCE (designer-created, with mainComponent) or
   *  a FRAME that re-imported `lumencast.instance.*` plugin data carries. */
  type: "INSTANCE" | "FRAME";
  id: string;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  /** Figma's plugin data accessor — see tests/fixtures/figma/mock.ts. */
  getSharedPluginData?(namespace: string, key: string): string;
}

interface InstanceMapOptions {
  isRoot: boolean;
  parentX?: number;
  parentY?: number;
  parentRotation?: number;
}

/** Returns the LSML instance primitive when the INSTANCE has the required
 *  scene plugin data ; null otherwise (caller falls back to FRAME mapping). */
export function mapInstance(
  node: InstanceFigmaNode,
  opts: InstanceMapOptions,
  ctx: MappingContext,
): MappingResult | null {
  const sceneId = readPlugin(node, "instance.scene_id");
  const sceneVersion = readPlugin(node, "instance.scene_version");
  if (!sceneId || !sceneVersion) {
    return null; // Not marked as a separate scene.
  }

  if (!/^sha256:[0-9a-f]{64}$/.test(sceneVersion)) {
    ctx.warn(
      "INVALID_INSTANCE",
      `Instance ${node.id} has malformed scene_version (must match "sha256:" + 64 lower-hex). Falling back to FRAME mapping.`,
      node.id,
    );
    return null;
  }

  const parsed = parseLayerName(node.name, { primitiveKind: "instance" });

  const prim: InstancePrimitive = {
    kind: "instance",
    scene_id: sceneId,
    scene_version: sceneVersion,
    ...extractUniversal(node, { parentRotation: opts.parentRotation ?? 0 }),
  };

  // size : always emit on instance — runtime needs the slot dimensions.
  prim.size = { w: roundTo3(node.width), h: roundTo3(node.height) };

  if (!opts.isRoot) {
    const px = opts.parentX ?? 0;
    const py = opts.parentY ?? 0;
    const x = (node.x ?? 0) - px;
    const y = (node.y ?? 0) - py;
    if (x !== 0 || y !== 0) prim.position = { x: roundTo3(x), y: roundTo3(y) };
  }

  const params = parseJsonObject(
    readPlugin(node, "instance.params"),
    node.id,
    ctx,
    "instance.params",
  );
  const bindParams = parseBindParams(readPlugin(node, "instance.bind_params"), node.id, ctx);

  // §4.9 : params and bindParams MUST NOT share a key.
  if (params && bindParams) {
    for (const k of Object.keys(bindParams)) {
      if (k in params) {
        ctx.warn(
          "INVALID_INSTANCE",
          `Instance ${node.id} has key "${k}" in both params and bind_params (LSML §4.9 forbids overlap).`,
          node.id,
        );
        delete params[k];
      }
    }
  }

  if (params && Object.keys(params).length > 0) prim.params = params;
  if (bindParams && Object.keys(bindParams).length > 0) prim.bindParams = bindParams;

  const fit = readPlugin(node, "instance.fit");
  if (fit && /^(contain|cover|fill|none)$/.test(fit)) {
    prim.fit = fit as "contain" | "cover" | "fill" | "none";
  } else if (fit) {
    ctx.warn(
      "INVALID_INSTANCE",
      `Instance ${node.id} has invalid fit "${fit}" (must be contain|cover|fill|none).`,
      node.id,
    );
  }

  if (parsed.bindUniversal) prim.bindUniversal = parsed.bindUniversal;

  if (node.name && node.name.trim().length > 0) {
    withFigmaMetadata(prim, { layerName: node.name });
  }

  captureFigmaExtras(node as Parameters<typeof captureFigmaExtras>[0], prim, {
    localPosition: prim.position ?? { x: 0, y: 0 },
  });

  return { node: prim };
}

function readPlugin(node: InstanceFigmaNode, key: string): string | null {
  if (typeof node.getSharedPluginData !== "function") return null;
  const v = node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, key);
  return v === "" ? null : v;
}

function parseJsonObject(
  raw: string | null,
  nodeId: string,
  ctx: MappingContext,
  fieldName: string,
): Record<string, unknown> | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    ctx.warn("INVALID_INSTANCE", `Instance ${nodeId} has invalid JSON in ${fieldName}.`, nodeId);
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    ctx.warn("INVALID_INSTANCE", `Instance ${nodeId} ${fieldName} must be a JSON object.`, nodeId);
    return null;
  }
  return v as Record<string, unknown>;
}

function parseBindParams(
  raw: string | null,
  nodeId: string,
  ctx: MappingContext,
): Record<string, LeafPath> | null {
  if (!raw) return null;
  const obj = parseJsonObject(raw, nodeId, ctx, "instance.bind_params");
  if (!obj) return null;
  const out: Record<string, LeafPath> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") {
      ctx.warn(
        "INVALID_INSTANCE",
        `Instance ${nodeId} bind_params.${k} must be a string LeafPath.`,
        nodeId,
      );
      continue;
    }
    out[k] = v;
  }
  return out;
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { InstanceFigmaNode };
