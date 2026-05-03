# src/export

Figma → LSML pipeline. Orchestration, asset extraction, canonicalization,
schema validation. Calls into `src/mapping/` for per-primitive logic.

| Module               | Phase | Purpose                                                  |
| -------------------- | ----- | -------------------------------------------------------- |
| `index.ts`           | 1     | `exportFrame(root) → ExportResult` orchestrator          |
| `bindings.ts`        | 1     | Parse `[bind:path]` layer name prefix                    |
| `operator-inputs.ts` | 1     | Extract `OperatorInput` component instances              |
| `assets.ts`          | 1     | Hash + dedupe images, return `assets/<hash>.png` refs    |
| `bundle.ts`          | 1     | Assemble the SceneBundle JSON shape                      |
| `canonicalize.ts`    | 1     | Thin wrapper over `@lumencast/compiler` canonicalization |
| `validate.ts`        | 1     | Run the LSML 1.1 JSON schema validator                   |

Output of the pipeline : `ExportResult { bundle, assets, warnings, hash }`.
The UI thread is responsible for serializing this to disk (Figma plugin
sandbox cannot touch the file system directly — it asks the UI iframe,
which uses the File System Access API or a download anchor).
