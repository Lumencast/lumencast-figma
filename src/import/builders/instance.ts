// LSML instance → Figma INSTANCE placeholder.
//
// We can't materialise the referenced sub-scene without fetching its bundle
// (and even then Figma can't natively cross-reference an LSML scene). Phase 3
// v0.1 strategy : create a placeholder INSTANCE node, write the scene_id +
// scene_version + params back into plugin data so a subsequent re-export
// reproduces the exact same `instance` primitive. Roundtrip-stable.

import type { InstancePrimitive } from "~shared/lsml-types";
import { PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_KEYS } from "~shared/constants";
import type { ImportFigmaApi, ImportInstanceNode } from "../figma-api";
import { applyUniversal } from "../universal";
import { readFigmaMetadata } from "../figma-metadata";
import { applyFigmaExtras } from "../figma-extras";
import type { BuildContext } from "./types";

export function buildInstance(
  prim: InstancePrimitive,
  api: ImportFigmaApi,
  _ctx: BuildContext,
): ImportInstanceNode {
  const node = api.createInstancePlaceholder();
  const figmaMeta = readFigmaMetadata(prim);
  node.name = figmaMeta.layerName ?? `Instance: ${prim.scene_id}`;
  // Placeholder is built from `figma.createFrame()` under the hood — clear
  // the default white fill + black stroke before reapplying source state.
  (node as unknown as { fills?: unknown[] }).fills = [];
  (node as unknown as { strokes?: unknown[] }).strokes = [];

  if (prim.size) node.resize(prim.size.w, prim.size.h);
  if (prim.position) {
    node.x = prim.position.x;
    node.y = prim.position.y;
  }

  // Roundtrip plugin data — mirrors what mapInstance reads on export.
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_KEYS.instanceSceneId, prim.scene_id);
  node.setSharedPluginData(
    PLUGIN_DATA_NAMESPACE,
    PLUGIN_DATA_KEYS.instanceSceneVersion,
    prim.scene_version,
  );
  if (prim.params) {
    node.setSharedPluginData(
      PLUGIN_DATA_NAMESPACE,
      PLUGIN_DATA_KEYS.instanceParams,
      JSON.stringify(prim.params),
    );
  }
  if (prim.bindParams) {
    node.setSharedPluginData(
      PLUGIN_DATA_NAMESPACE,
      PLUGIN_DATA_KEYS.instanceBindParams,
      JSON.stringify(prim.bindParams),
    );
  }
  if (prim.fit) {
    node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_KEYS.instanceFit, prim.fit);
  }

  applyUniversal(node, prim);
  applyFigmaExtras(node, figmaMeta);
  return node;
}
