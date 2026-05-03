// Typed message contract between the Figma plugin sandbox (main) and
// the iframe UI. Every message has a discriminated `kind`. Both directions
// import this module so adding a new message requires updating one place.

import type { SceneBundle } from "~shared/lsml-types";

// ----------- UI → Main -----------

export type UiToMain =
  | { kind: "ui-ready" }
  | { kind: "request-selection-summary" }
  | { kind: "request-export"; sceneId?: string }
  | { kind: "request-import"; bundle: SceneBundle }
  | { kind: "open-external"; url: string }
  | { kind: "close" };

// ----------- Main → UI -----------

export type MainToUi =
  | { kind: "selection-summary"; payload: SelectionSummary }
  | { kind: "export-progress"; phase: ExportPhase; message?: string }
  | { kind: "export-result"; payload: ExportResult }
  | { kind: "import-progress"; phase: ImportPhase; message?: string }
  | { kind: "import-result"; payload: ImportResult }
  | { kind: "error"; code: PluginErrorCode; message: string; detail?: unknown };

// ----------- Payload shapes -----------

export interface SelectionSummary {
  selected: number;
  exportable: boolean;
  reason?: string;
  /** Quick stats for the chosen frame, when exactly one frame is selected. */
  frame?: {
    id: string;
    name: string;
    width: number;
    height: number;
    nodeCount: number;
    primitiveCounts: Partial<Record<string, number>>;
  };
}

export type ExportPhase =
  | "traversing"
  | "mapping"
  | "extracting-assets"
  | "assembling-bundle"
  | "canonicalizing"
  | "validating"
  | "writing";

export interface ExportResult {
  bundle: SceneBundle;
  /** Canonical UTF-8 bytes of the sealed bundle (LSML §3.1 + §3.2). The UI
   *  writes these unchanged to the .lsml file ; verifiers re-canonicalise to
   *  check the hash. */
  canonical: string;
  assets: ExportedAsset[];
  warnings: PluginWarning[];
  /** sha256 of the canonicalized bundle (== scene_version) */
  hash: string;
}

export interface ExportedAsset {
  /** Content-hash filename, e.g. "9f3e...png" */
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type ImportPhase = "parsing" | "validating" | "building-nodes" | "embedding-assets";

export interface ImportResult {
  rootNodeId: string;
  primitivesCreated: number;
  warnings: PluginWarning[];
}

export interface PluginWarning {
  code: string;
  message: string;
  nodeId?: string;
  primitivePath?: string;
}

export type PluginErrorCode =
  | "NO_SELECTION"
  | "MULTIPLE_SELECTION"
  | "UNSUPPORTED_NODE"
  | "INVALID_BINDING_PATH"
  | "INVALID_OPERATOR_INPUT"
  | "ASSET_EXTRACTION_FAILED"
  | "BUNDLE_VALIDATION_FAILED"
  | "INVALID_LSML"
  | "UNSUPPORTED_LSML_VERSION"
  | "INTERNAL";
