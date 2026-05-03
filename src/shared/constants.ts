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
} as const;

/** Layer name pattern : `[bind:path.to.leaf] Optional Display Name` */
export const BIND_LAYER_PREFIX_RE = /^\s*\[bind:([a-zA-Z0-9_.{}]+)\]\s*(.*)$/;

/** Name of the Figma component the plugin treats as an operator-input declaration */
export const OPERATOR_INPUT_COMPONENT_NAME = "OperatorInput";

/** LSML target version emitted by this plugin */
export const LSML_VERSION = "1.1" as const;

/** File extension of the bundle on disk (renamed .lsml.json) */
export const LSML_FILE_EXTENSION = ".lsml" as const;

/** Sibling directory holding content-hashed assets referenced by the bundle */
export const ASSETS_DIR = "assets" as const;
