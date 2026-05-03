import { useEffect } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import type { ExportPhase, MainToUi, SelectionSummary, UiToMain } from "../main/messages";
import type { SceneBundle } from "~shared/lsml-types";
import { DEFAULT_SCHEMA_URL } from "~shared/lsml-schema";
import { LSML_FILE_EXTENSION } from "~shared/constants";
import { downloadExport } from "./download";

function send(msg: UiToMain): void {
  parent.postMessage({ pluginMessage: msg }, "*");
}

export function App() {
  const summary = useSignal<SelectionSummary | null>(null);
  const lastError = useSignal<string | null>(null);
  const exportPhase = useSignal<ExportPhase | null>(null);
  const lastHash = useSignal<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<{ pluginMessage?: MainToUi }>) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;
      switch (msg.kind) {
        case "selection-summary":
          summary.value = msg.payload;
          lastError.value = null;
          break;
        case "export-progress":
          exportPhase.value = msg.phase;
          break;
        case "export-result": {
          exportPhase.value = null;
          lastHash.value = msg.payload.hash;
          const filename = `${msg.payload.bundle.scene_id}${LSML_FILE_EXTENSION}`;
          downloadExport({
            filename,
            bundleBytes: msg.payload.canonical,
            assets: msg.payload.assets,
          });
          break;
        }
        case "error":
          lastError.value = msg.message;
          exportPhase.value = null;
          break;
        case "import-progress":
        case "import-result":
          // Phase 3.
          break;
      }
    };
    window.addEventListener("message", handler);
    send({ kind: "ui-ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const exportable = useComputed(() => summary.value?.exportable ?? false);

  return (
    <div class="lumencast-root">
      <header class="lumencast-header">
        <h1>Lumencast Export</h1>
        <span class="lumencast-version">v0.1.0-pre</span>
      </header>

      <section class="lumencast-status">
        <SelectionPanel summary={summary.value} />
      </section>

      <section class="lumencast-actions">
        <button
          type="button"
          class="lumencast-button lumencast-button--primary"
          disabled={!exportable.value}
          onClick={() => send({ kind: "request-export" })}
        >
          Export to LSML
        </button>
        <button
          type="button"
          class="lumencast-button"
          onClick={() => send({ kind: "request-import", bundle: PLACEHOLDER_BUNDLE })}
          disabled
          title="Import lands in Phase 3"
        >
          Import .lsml
        </button>
      </section>

      {exportPhase.value !== null && (
        <div class="lumencast-status-line">Export : {exportPhase.value}…</div>
      )}

      {lastHash.value !== null && exportPhase.value === null && (
        <div class="lumencast-status-line lumencast-status-line--ok">
          Exported. scene_version : <code>{lastHash.value.slice(0, 19)}…</code>
        </div>
      )}

      {lastError.value !== null && (
        <div class="lumencast-error" role="alert">
          {lastError.value}
        </div>
      )}

      <footer class="lumencast-footer">
        <a href="https://github.com/Lumencast/lumencast-figma" target="_blank" rel="noreferrer">
          Docs &amp; source
        </a>
      </footer>
    </div>
  );
}

function SelectionPanel({ summary }: { summary: SelectionSummary | null }) {
  if (!summary) {
    return <p class="lumencast-muted">Loading…</p>;
  }
  if (!summary.exportable) {
    return <p class="lumencast-muted">{summary.reason ?? "Selection not exportable."}</p>;
  }
  const f = summary.frame;
  if (!f) {
    return <p class="lumencast-muted">Selection ready.</p>;
  }
  return (
    <dl class="lumencast-frame">
      <dt>Frame</dt>
      <dd>{f.name}</dd>
      <dt>Size</dt>
      <dd>
        {f.width.toFixed(0)} × {f.height.toFixed(0)}
      </dd>
      <dt>Nodes</dt>
      <dd>{f.nodeCount}</dd>
    </dl>
  );
}

// Placeholder so the import button compiles ; replaced in Phase 3 by a
// File-API picker that loads the .lsml bytes into a real bundle.
const PLACEHOLDER_BUNDLE: SceneBundle = {
  $schema: DEFAULT_SCHEMA_URL,
  lsml: "1.1",
  scene_id: "placeholder",
  scene_version: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] },
};
