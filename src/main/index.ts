// Entry point of the Figma plugin sandbox.
//
// Responsibilities :
//   - Show the iframe UI
//   - Listen for typed messages from the UI
//   - Dispatch to selection / export / import handlers
//
// All actual mapping/export/import logic lives in src/mapping, src/export,
// src/import. This file is the thin orchestration layer.

import type { UiToMain, MainToUi } from "./messages";
import { summarizeSelection } from "./selection";
import { runExport, type RunExportError } from "../export";
import { importBundle } from "../import";
import { createFigmaVariableResolver } from "./variables-adapter";
import { createFigmaImportAdapter } from "./import-adapter";
import { buildDiagnosticDump } from "./diagnostic";

const PLUGIN_VERSION = "0.1.1";

const UI_WIDTH = 360;
const UI_HEIGHT = 480;

function send(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

async function handleMessage(msg: UiToMain): Promise<void> {
  switch (msg.kind) {
    case "ui-ready":
      send({ kind: "selection-summary", payload: summarizeSelection() });
      return;

    case "request-selection-summary":
      send({ kind: "selection-summary", payload: summarizeSelection() });
      return;

    case "request-export":
      await handleExportRequest(msg.sceneId);
      return;

    case "request-import":
      await handleImportRequest(msg.lsmlBytes, msg.assets ?? []);
      return;

    case "open-external":
      // Plugin sandbox cannot open URLs ; rely on the UI's anchor target.
      // Kept as a typed message for future capability.
      return;

    case "close":
      figma.closePlugin();
      return;
  }
}

async function handleExportRequest(sceneIdOverride?: string): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    send({
      kind: "error",
      code: selection.length === 0 ? "NO_SELECTION" : "MULTIPLE_SELECTION",
      message:
        selection.length === 0
          ? "Select a frame, component, or instance to export."
          : "Select exactly one root node ; multi-frame export ships in v0.2.",
    });
    return;
  }
  const root = selection[0];
  if (!root) {
    send({ kind: "error", code: "NO_SELECTION", message: "Selection became empty." });
    return;
  }
  if (root.type !== "FRAME" && root.type !== "COMPONENT" && root.type !== "INSTANCE") {
    send({
      kind: "error",
      code: "UNSUPPORTED_NODE",
      message: `Selected ${root.type} cannot be the export root.`,
    });
    return;
  }

  send({ kind: "export-progress", phase: "traversing" });
  try {
    const variables =
      "variables" in figma
        ? createFigmaVariableResolver(
            figma.variables as Parameters<typeof createFigmaVariableResolver>[0],
          )
        : undefined;
    const result = await runExport({
      api: figma,
      root: root as never,
      ...(sceneIdOverride ? { sceneId: sceneIdOverride } : {}),
      ...(variables ? { variables } : {}),
      // Debug artefacts (`_debug/raw-figma.json` + `_debug/mapping-trace.json`)
      // are opt-in : the snapshot is a deep recursive read of every Figma
      // node + a pretty-printed JSON.stringify. On a small scene it costs
      // a few hundred ms, but on 8000+ nodes it adds 10-20s of pure work
      // (and several MB to the .lsmlz). The plugin can flip this on via a
      // future UI toggle when a user is actively diagnosing an issue.
      captureDebugArtefacts: false,
    });
    send({ kind: "export-progress", phase: "writing" });
    send({
      kind: "export-result",
      payload: {
        bundle: result.bundle,
        canonical: result.canonical,
        assets: result.assets,
        warnings: result.warnings,
        hash: result.hash,
        ...(result.debugArtefacts ? { debugArtefacts: result.debugArtefacts } : {}),
      },
    });
  } catch (err) {
    // Failures bubble through the structured `error` message below ; the
    // stack is preserved on the err object for the UI to surface in the
    // archive's `_debug/error.json` block.
    const e = err as RunExportError;
    if (e?.code === "BUNDLE_VALIDATION_FAILED") {
      send({
        kind: "error",
        code: "BUNDLE_VALIDATION_FAILED",
        message: `Validation failed : ${e.errors.length} issue(s).`,
        detail: e.errors,
      });
      return;
    }
    send({
      kind: "error",
      code: "INTERNAL",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleImportRequest(
  lsmlBytes: string,
  assets: { path: string; bytes: Uint8Array }[],
): Promise<void> {
  send({ kind: "import-progress", phase: "parsing" });
  try {
    const api = createFigmaImportAdapter();
    const result = await importBundle({ api, lsmlBytes, assets });
    send({ kind: "import-progress", phase: "embedding-assets" });
    send({ kind: "import-progress", phase: "building-nodes" });
    send({ kind: "import-result", payload: result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (
      code === "SCENE_VERSION_MISMATCH" ||
      code === "BUNDLE_VALIDATION_FAILED" ||
      code === "INVALID_LSML" ||
      code === "INVALID_JSON" ||
      code === "UNSUPPORTED_LSML_VERSION"
    ) {
      send({
        kind: "error",
        code: code === "UNSUPPORTED_LSML_VERSION" ? "UNSUPPORTED_LSML_VERSION" : "INVALID_LSML",
        message: err instanceof Error ? err.message : String(err),
        detail: (err as { errors?: unknown }).errors,
      });
      return;
    }
    send({
      kind: "error",
      code: "INTERNAL",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function runDiagnosticCommand(): void {
  // Branched menu : "Diagnostic: dump selection positions" jumps here.
  // We walk the selected node + descendants (or the whole current page
  // if nothing is selected) and post a JSON string to the iframe UI for
  // download. The dump captures every property the position-debug
  // investigation needs : x/y, width/height, rotation, relativeTransform,
  // absoluteTransform, absoluteBoundingBox, constraints, layoutMode,
  // layoutSizing, parent type/id/name. Source-vs-imported diff is
  // straightforward against two dumps.
  figma.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT, themeColors: true });
  try {
    const json = buildDiagnosticDump(PLUGIN_VERSION);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    send({
      kind: "diagnostic-dump",
      filename: `lumencast-diagnostic-${stamp}.json`,
      json,
    });
  } catch (err) {
    send({
      kind: "error",
      code: "INTERNAL",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function bootstrap(): void {
  if (figma.command === "diagnostic") {
    runDiagnosticCommand();
    figma.ui.onmessage = (msg: UiToMain) => {
      handleMessage(msg).catch((err) => {
        send({
          kind: "error",
          code: "INTERNAL",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    };
    return;
  }

  figma.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT, themeColors: true });

  figma.ui.onmessage = (msg: UiToMain) => {
    handleMessage(msg).catch((err) => {
      send({
        kind: "error",
        code: "INTERNAL",
        message: err instanceof Error ? err.message : String(err),
      });
    });
  };

  figma.on("selectionchange", () => {
    send({ kind: "selection-summary", payload: summarizeSelection() });
  });
}

bootstrap();
