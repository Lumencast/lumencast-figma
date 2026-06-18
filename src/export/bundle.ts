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
import { FIGMA_AUTHORING_PROFILE, LSML_VERSION, LSML_VERSION_1_2 } from "~shared/constants";
import { schemaUrlForVersion } from "~shared/lsml-schema";
import { mapTree, type MappingContext } from "../mapping";
import { layoutUsesLsml12 } from "../mapping/lsml-1_2";
import { preloadMainComponents } from "../mapping/preload";
import { createMappingTrace } from "../mapping/trace";
import type { VariableResolverApi } from "../mapping/variables";
import { extractOperatorInputs } from "./operator-inputs";
import { applyAssetPathRewrites, createAssetRegistry } from "./assets";
import { sealBundle } from "./canonicalize";
import { snapshotFigmaNode } from "./debug-snapshot";

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
  /** When true, the export captures `_debug/raw-figma.json` (snapshot of
   *  the source SceneNode tree) and `_debug/mapping-trace.json` (per-node
   *  walker decisions) into `result.debugArtefacts`. The caller bundles
   *  them into the .lsmlz archive for offline diagnosis. */
  captureDebugArtefacts?: boolean;
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
  /** Diagnostic artefacts captured during the run. The caller writes them
   *  into `_debug/` inside the .lsmlz archive so the user can ship them
   *  back for offline analysis. Empty in production once we're confident
   *  in the mapping (kept opt-in via `opts.captureDebugArtefacts`). */
  debugArtefacts?: {
    /** Recursive snapshot of the source SceneNode subtree. */
    rawFigma: string;
    /** Per-node decision trace from the walker. */
    mappingTrace: string;
  };
}

export async function buildBundle(opts: BuildBundleOptions): Promise<BuildBundleResult> {
  const warnings: PluginWarning[] = [];
  const registry = createAssetRegistry({
    api: opts.api,
    onDiagnostic: (code, message) => warnings.push({ code, message }),
  });
  // Mapping trace is ALWAYS captured : per-node push is cheap and the
  // trace is the only persistent record of warnings + per-node decisions
  // for the `_debug/mapping-trace.json` archive entry. The heavy raw-
  // figma snapshot stays opt-in via captureDebugArtefacts (deep
  // recursive read + JSON.stringify pretty-print).
  const trace = createMappingTrace();

  // Pre-resolve every INSTANCE → mainComponent before the synchronous
  // walk runs. In `documentAccess: "dynamic-page"` mode (declared in
  // manifest.json) the synchronous `node.mainComponent` getter throws —
  // the API requires `node.getMainComponentAsync()` instead. Doing this
  // up-front (one Promise.all over all instances) keeps the rest of the
  // pipeline synchronous and avoids paying an async cost per node.
  const mainComponentMap = await preloadMainComponents(opts.root as never);

  const ctx: MappingContext = {
    warn(code, message, nodeId) {
      const w: PluginWarning = { code, message };
      if (nodeId !== undefined) w.nodeId = nodeId;
      warnings.push(w);
    },
    registerImageHash: (hash) => registry.registerImageHash(hash),
    registerImageHashAsDataUri: (hash) => registry.registerImageHashAsDataUri(hash),
    ...(opts.variables ? { variables: opts.variables } : {}),
    trace,
    mainComponentMap,
  };

  // 0. Optional pre-mapping snapshot. Captured before mapTree mutates
  // anything so `_debug/raw-figma.json` matches what the host fed in.
  let rawFigmaSnapshot: string | undefined;
  if (opts.captureDebugArtefacts) {
    try {
      rawFigmaSnapshot = JSON.stringify(
        snapshotFigmaNode(opts.root as unknown as Parameters<typeof snapshotFigmaNode>[0]),
        null,
        2,
      );
    } catch (err) {
      // Snapshot failures land in `_debug/raw-figma.json` itself (as a
      // single `{ error }` entry) — that's enough signal for the user to
      // see what went wrong without polluting the console.
      rawFigmaSnapshot = JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 1. Map the tree.
  const mapped = mapTree(opts.root, ctx);

  // 2. Scan for operator inputs across the whole subtree.
  const opInputs = extractOperatorInputs(opts.root as never, mainComponentMap);
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

  // Version gating : a bundle upgrades to 1.2 ONLY when its layout actually
  // carries a 1.2 construct (blendMode / mask / image-fill / gradient
  // transform). A design with none of those stays 1.1 — byte-identical to
  // the previous mapper output (non-regression). `$schema` tracks the
  // emitted version (ADR 002 §3.2).
  const uses12 = layoutUsesLsml12(mapped.node);
  const lsmlVersion = uses12 ? LSML_VERSION_1_2 : LSML_VERSION;

  const draft: SceneBundle = {
    $schema: schemaUrlForVersion(lsmlVersion),
    lsml: lsmlVersion,
    scene_id: sceneId,
    scene_version: "sha256:placeholder", // overwritten by sealBundle
    profiles: [FIGMA_AUTHORING_PROFILE],
    layout: mapped.node,
  };
  if (mapped.defaults && Object.keys(mapped.defaults).length > 0) {
    draft.defaults = mapped.defaults;
  }
  if (operator_inputs.length > 0) draft.operator_inputs = operator_inputs;
  // `allowedHosts` policy (Bastion T6 — coherent with the `src` the mapper
  // produces) : the mapper emits only host-less asset sources — local
  // `assets/<sha256>.<ext>` paths (image primitive) and `data:image/*;base64`
  // URIs (1.2 image-fill / mask-image). Neither references a remote host, so
  // `allowedHosts: []` is the coherent, deny-by-default value : no `src`
  // whose host is absent from the allowlist is ever emitted. Downstream
  // tooling (Prism) may swap in a real CDN host + re-host the assets ; until
  // then nothing remote is referenced, so nothing is denied. The block is
  // emitted whenever the bundle references local assets OR carries a 1.2
  // image-fill — so the gate is always armed for asset sources.
  if (assets.length > 0 || uses12) {
    draft.assets = { allowedHosts: [] };
  }

  // 5. Seal — compute scene_version via the §3.2 placeholder protocol.
  const sealed = await sealBundle(draft);
  const result: BuildBundleResult = {
    bundle: sealed.bundle,
    canonical: sealed.canonical,
    assets,
    warnings,
    sceneVersion: sealed.sceneVersion,
  };
  // Always emit `mappingTrace` : per-node entries + warnings are the
  // primary diagnostic record persisted in `_debug/mapping-trace.json`.
  // `rawFigma` (the deep snapshot) is opt-in because it's expensive on
  // big scenes — controlled by `captureDebugArtefacts`.
  result.debugArtefacts = {
    rawFigma: opts.captureDebugArtefacts ? (rawFigmaSnapshot ?? "{}") : "{}",
    mappingTrace: JSON.stringify({ entries: trace.entries, warnings }, null, 2),
  };
  return result;
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
