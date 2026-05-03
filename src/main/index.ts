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
      // Wired up in Phase 1 — see src/export/.
      send({
        kind: "error",
        code: "INTERNAL",
        message: "Export not implemented yet (Phase 1).",
      });
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
