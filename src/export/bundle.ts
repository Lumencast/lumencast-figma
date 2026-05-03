// Top-level export pipeline : Figma node tree → sealed LSML 1.1 bundle.
//
// Steps :
//   1. Walk the tree via src/mapping/index.ts → primitive root + defaults +
//      asset hashes + operator inputs (from descendants).
//   2. Walk again from the ROOT using extractOperatorInputs() — components
//      living outside the primitive tree (e.g. dedicated input components on
//      a hidden helper frame) still contribute to the bundle.
//   3. Resolve image hashes to bytes via the asset registry, rewrite src
//      paths to their content-addressed form.
//   4. Assemble the SceneBundle with $schema, lsml: "1.1", scene_id, layout,
//      defaults, operator_inputs, assets.allowedHosts.
//   5. Seal : compute scene_version via the §3.2 placeholder protocol.

import type { ExportedAsset, PluginWarning } from "../main/messages";
import type { OperatorInputSpec, SceneBundle } from "~shared/lsml-types";
import { LSML_VERSION } from "~shared/constants";
import { DEFAULT_SCHEMA_URL } from "~shared/lsml-schema";
import { mapTree, type MappingContext } from "../mapping";
import type { VariableResolverApi } from "../mapping/variables";
import { extractOperatorInputs } from "./operator-inputs";
import { applyAssetPathRewrites, createAssetRegistry } from "./assets";
import { sealBundle } from "./canonicalize";

interface FigmaApiSurface {
  getImageByHash(hash: string): { hash: string; getBytesAsync(): Promise<Uint8Array> } | null;
}

interface RootNode {
  type: string;
  id: string;
  name: string;
  width?: number;
  height?: number;
  children?: unknown[];
}

export interface BuildBundleOptions {
  /** Figma API surface — production passes `figma`, tests pass the mock. */
  api: FigmaApiSurface;
  /** Root of the export — typically the FRAME / COMPONENT / INSTANCE selected
   *  in Figma. */
  root: RootNode;
  /** Stable scene id — derived from the root frame's name + id by default. */
  sceneId?: string;
  /** Optional Figma variable resolver. Production wires `figma.variables.*` ;
   *  tests pass an in-memory mock. When omitted, variable bindings are NOT
   *  emitted (existing behaviour is preserved). */
  variables?: VariableResolverApi;
}

export interface BuildBundleResult {
  bundle: SceneBundle;
  /** Canonical UTF-8 bytes of the sealed bundle. The caller writes these to
   *  the `.lsml` file unchanged. */
  canonical: string;
  assets: ExportedAsset[];
  warnings: PluginWarning[];
  /** scene_version (sha256 hash). Convenience — same as `bundle.scene_version`. */
  sceneVersion: string;
}

export async function buildBundle(opts: BuildBundleOptions): Promise<BuildBundleResult> {
  const warnings: PluginWarning[] = [];
  const registry = createAssetRegistry({ api: opts.api });
  const ctx: MappingContext = {
    warn(code, message, nodeId) {
      const w: PluginWarning = { code, message };
      if (nodeId !== undefined) w.nodeId = nodeId;
      warnings.push(w);
    },
    registerImageHash: (hash) => registry.registerImageHash(hash),
    ...(opts.variables ? { variables: opts.variables } : {}),
  };

  // 1. Map the tree.
  const mapped = mapTree(opts.root, ctx);

  // 2. Scan for operator inputs across the whole subtree.
  const opInputs = extractOperatorInputs(opts.root as never);
  for (const w of opInputs.warnings) {
    warnings.push({ code: w.code, message: w.message, nodeId: w.nodeId });
  }

  // 3. Resolve asset hashes → bytes + content-addressed names.
  const assets = await registry.finalize();
  const rewrites = registry.rewrites();
  applyAssetPathRewrites(mapped.node as unknown as object, rewrites);
  if (mapped.defaults) applyAssetPathRewrites(mapped.defaults, rewrites);

  // 4. Assemble.
  const operator_inputs = mergeOperatorInputs(mapped.operatorInputs ?? [], opInputs.inputs);
  const sceneId = opts.sceneId ?? deriveSceneId(opts.root);
  const draft: SceneBundle = {
    $schema: DEFAULT_SCHEMA_URL,
    lsml: LSML_VERSION,
    scene_id: sceneId,
    scene_version: "sha256:placeholder", // overwritten by sealBundle
    layout: mapped.node,
  };
  if (mapped.defaults && Object.keys(mapped.defaults).length > 0) {
    draft.defaults = mapped.defaults;
  }
  if (operator_inputs.length > 0) draft.operator_inputs = operator_inputs;
  if (assets.length > 0) {
    // Bundle uses content-addressed relative paths (`assets/<sha256>.<ext>`),
    // no remote URLs. `allowedHosts: []` allows no remote hostnames — the
    // user adds their CDN host once they upload assets (LSML §11.1).
    draft.assets = { allowedHosts: [] };
  }

  // 5. Seal — compute scene_version via the §3.2 placeholder protocol.
  const sealed = await sealBundle(draft);
  return {
    bundle: sealed.bundle,
    canonical: sealed.canonical,
    assets,
    warnings,
    sceneVersion: sealed.sceneVersion,
  };
}

function mergeOperatorInputs(
  fromTree: OperatorInputSpec[],
  fromScan: OperatorInputSpec[],
): OperatorInputSpec[] {
  const seen = new Set<string>();
  const out: OperatorInputSpec[] = [];
  for (const spec of [...fromTree, ...fromScan]) {
    if (seen.has(spec.path)) continue;
    seen.add(spec.path);
    out.push(spec);
  }
  return out;
}

function deriveSceneId(root: RootNode): string {
  // LSML scene_id pattern : `^[A-Za-z0-9._-]+$`. Slug the root name to fit.
  const slug = root.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) return `scene-${root.id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  return slug;
}
