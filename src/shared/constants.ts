// Plugin-wide constants. Keep this file dependency-free so both the main
// sandbox and the UI iframe can import it.

export const PLUGIN_DATA_NAMESPACE = "lumencast";

export const PLUGIN_DATA_KEYS = {
  /** Layer-name binding — fallback when [bind:path] prefix is absent */
  bindingPath: "binding.path",
  /** OperatorInput component metadata */
  operatorInputPath: "operator_input.path",
  operatorInputType: "operator_input.type",
  operatorInputConstraints: "operator_input.constraints",
  /** Marker on root frames already exported once (for incremental round-trip) */
  exportSourceHash: "export.source_hash",
  /** When set on a Figma INSTANCE, the node maps to LSML §4.9 `instance`
   *  instead of recursing through the component tree. */
  instanceSceneId: "instance.scene_id",
  instanceSceneVersion: "instance.scene_version",
  /** Optional JSON-encoded {string: any} for static `params`. */
  instanceParams: "instance.params",
  /** Optional JSON-encoded {string: LeafPath} for reactive `bindParams`. */
  instanceBindParams: "instance.bind_params",
  /** Optional fit override (`contain | cover | fill | none`). */
  instanceFit: "instance.fit",
  /** On a re-imported node, preserves the original synthesised `__lit.*`
   *  bind path so the next export reproduces it byte-stable. */
  litBindValue: "lit.bind.value",
  litBindSrc: "lit.bind.src",
} as const;

/** Layer name pattern : `[bind:path.to.leaf] Optional Display Name` */
export const BIND_LAYER_PREFIX_RE = /^\s*\[bind:([a-zA-Z0-9_.{}]+)\]\s*(.*)$/;

/** Name of the Figma component the plugin treats as an operator-input declaration */
export const OPERATOR_INPUT_COMPONENT_NAME = "OperatorInput";

/** LSML target version emitted by this plugin */
export const LSML_VERSION = "1.1" as const;

/** File extension of the bundle on disk (renamed .lsml.json) */
export const LSML_FILE_EXTENSION = ".lsml" as const;

/** File extension of a self-contained Lumencast archive — a ZIP file with
 *  `<scene_id>.lsml` at the root and an `assets/` directory of content-
 *  addressed images. Single-file alternative to the bare `.lsml + assets/`
 *  layout for distribution. */
export const LSML_ARCHIVE_EXTENSION = ".lsmlz" as const;

/** Sibling directory holding content-hashed assets referenced by the bundle */
export const ASSETS_DIR = "assets" as const;

/** LSML 1.1 §17.3 authoring profile this plugin emits. Documented at
 *  `lumencast-protocol/spec/profiles/figma-authoring.md`. The slash-major
 *  suffix marks it as an *authoring* profile — runtimes that don't speak
 *  it MUST silently ignore (graceful degrade), unlike rendering profiles
 *  which use `-version` and trigger BUNDLE_INCOMPATIBLE on mismatch. */
export const FIGMA_AUTHORING_PROFILE = "x-figma.authoring/1" as const;
