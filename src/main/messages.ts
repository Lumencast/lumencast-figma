// Typed message contract between the Figma plugin sandbox (main) and
// the iframe UI. Every message has a discriminated `kind`. Both directions
// import this module so adding a new message requires updating one place.

import type { SceneBundle } from "~shared/lsml-types";

// ----------- UI → Main -----------

export type UiToMain =
  | { kind: "ui-ready" }
  | { kind: "request-selection-summary" }
  | { kind: "request-export"; sceneId?: string }
  | {
      kind: "request-import";
      /** Raw .lsml bytes the user picked via File-API. */
      lsmlBytes: string;
      /** Per-asset bytes loaded from the sibling `assets/` directory. */
      assets?: { path: string; bytes: Uint8Array }[];
    }
  | { kind: "open-external"; url: string }
  | { kind: "close" };

// ----------- Main → UI -----------

export type MainToUi =
  | { kind: "selection-summary"; payload: SelectionSummary }
  | { kind: "export-progress"; phase: ExportPhase; message?: string }
  | { kind: "export-result"; payload: ExportResult }
  | { kind: "import-progress"; phase: ImportPhase; message?: string }
  | { kind: "import-result"; payload: ImportResult }
  | { kind: "diagnostic-dump"; filename: string; json: string }
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
  /** Optional diagnostic artefacts. Present only when the export was
   *  invoked with `captureDebugArtefacts: true`. The UI writes them to
   *  `_debug/raw-figma.json` + `_debug/mapping-trace.json` inside the
   *  .lsmlz archive. Both are pre-serialised JSON strings. */
  debugArtefacts?: {
    rawFigma: string;
    mappingTrace: string;
  };
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
  /** Optional diagnostic artefact. The UI writes it to disk as
   *  `<scene_id>-import-trace.json` after each import so users can ship
   *  the trace back without copy-pasting console output. */
  debugArtefacts?: {
    importTrace: string;
  };
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
