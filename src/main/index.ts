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
      // Wired up in Phase 3 — see src/import/.
      send({
        kind: "error",
        code: "INTERNAL",
        message: "Import not implemented yet (Phase 3).",
      });
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
    const result = await runExport({
      api: figma,
      root: root as never,
      ...(sceneIdOverride ? { sceneId: sceneIdOverride } : {}),
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
      },
    });
  } catch (err) {
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

function bootstrap(): void {
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
