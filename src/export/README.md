# src/export

Figma → LSML pipeline. Orchestration, asset extraction, canonicalization,
schema validation. Calls into `src/mapping/` for per-primitive logic.

| Module               | Purpose                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `index.ts`           | `exportFrame(root) → ExportResult` orchestrator                                                    |
| `bindings.ts`        | Parse `[bind:path]` / `[bindStyle:k=p]` / `[bindUniversal:k=p]` layer-name directives              |
| `operator-inputs.ts` | Extract `OperatorInput` component instances → `bundle.operator_inputs[]` (LSML §8.1, all 9 types)  |
| `assets.ts`          | Hash + dedupe images, emit `assets/<sha256>.<ext>` refs, return bytes for the UI to bundle         |
| `bundle.ts`          | Assemble the SceneBundle JSON shape (`$schema`, `lsml`, `defaults`, `layout`, `operator_inputs[]`) |
| `canonicalize.ts`    | JCS RFC 8785 + LSML §3.2 `scene_version` placeholder protocol — local impl, byte-stable            |
| `hash.ts`            | sha256 helper for content-addressing                                                               |
| `sha256-pure.ts`     | Pure-JS sha256 (the Figma plugin sandbox has no `crypto.subtle`)                                   |
| `validate.ts`        | Lite runtime validator — required fields, scene_id charset, primitive kinds, allowedHosts coupling |
| `debug-snapshot.ts`  | Optional `_debug/raw-figma.json` recursive node-tree dump for archive diagnostics                  |

Output of the pipeline : `ExportResult { bundle, assets, warnings, debug? }`.
The UI thread serializes this to disk — the Figma plugin sandbox cannot
touch the file system directly, it asks the iframe via `postMessage` and
the iframe packs everything into a `.lsmlz` archive (`src/ui/archive.ts`)
or downloads the loose `.lsml` + `assets/` pair.

`canonicalize.ts` is currently a local implementation. The published
`@lumencast/compiler` artefact will replace it once it accepts LSML 1.1
([lumencast-figma#1](https://github.com/Lumencast/lumencast-figma/issues/1)).
