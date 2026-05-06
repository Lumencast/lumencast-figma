# src/import

LSML bundle → Figma node tree. Reverse of `src/export/`. Round-trip-stable
with the export pipeline (`tests/integration/roundtrip.test.ts`).

## Entry point

| Module         | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `index.ts`     | `importBundle({ api, lsmlBytes, assets? }) → ImportResult`     |
| `parse.ts`     | Bytes / string → `SceneBundle`, validate, verify scene_version |
| `reconcile.ts` | Strategy when target frame already exists (overwrite in v0.1)  |

## Walker + builders

| Module     | Purpose                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk.ts`  | Per-primitive dispatcher + flat-then-group orchestrator for `metadata.figma.sourceType="GROUP"` / `"BOOLEAN_OPERATION"` (recursively attaches descendants, then `figma.group()`) |
| `trace.ts` | Optional `ctx.trace` event log — start / done / failure per primitive. Surfaces in `_debug/import-trace.json` when archive debug is on                                           |

| Builder                | LSML primitive → Figma node                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builders/text.ts`     | `text` → `TextNode`                                                                                                                                               |
| `builders/image.ts`    | `image` → `RectangleNode` with `IMAGE` fill                                                                                                                       |
| `builders/shape.ts`    | `shape` → `RectangleNode` / `EllipseNode` / `VectorNode` per `geometry`                                                                                           |
| `builders/frame.ts`    | `frame` → `FrameNode` (no auto-layout)                                                                                                                            |
| `builders/stack.ts`    | `stack` → `FrameNode` with `layoutMode`                                                                                                                           |
| `builders/instance.ts` | `instance` → placeholder `FRAME` carrying `lumencast.instance.*` plugin data (real `INSTANCE` requires a local `COMPONENT` to clone — not available cross-bundle) |

## Helpers

| Module                 | Purpose                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `figma-api.ts`         | The `ImportFigmaApi` surface the import pipeline depends on — narrow interface for the Figma plugin sandbox + the in-memory test mock           |
| `figma-metadata.ts`    | `readFigmaMetadata(prim)` — extract `metadata.figma.*` from an LSML primitive                                                                   |
| `figma-extras.ts`      | `applyFigmaExtras(node, meta)` — apply `metadata.figma.*` (transform, sizing, constraints, effects, strokes, mask, blend, layoutPositioning, …) |
| `universal.ts`         | Apply universal LSML props (visible / opacity / rotation / sizing) per LSML §5.4                                                                |
| `color.ts`             | CSS color string → Figma `RGB` / `RGBA`, with opacity round-trip                                                                                |
| `fill-to-paint.ts`     | LSML `Fill` (solid / linear-gradient / radial-gradient) → Figma `Paint`                                                                         |
| `image-backgrounds.ts` | Multi-fill / image background application on FRAMEs (LSML §4.3 `backgrounds[]`)                                                                 |
| `fonts.ts`             | Font preload via `figma.loadFontAsync` before `TextNode.characters` is set                                                                      |
| `assets.ts`            | Wraps `figma.createImage(bytes)` to embed local `assets/<sha256>.<ext>` byte sources                                                            |

## Round-trip rule

Enforced in `tests/integration/roundtrip.test.ts` :

```
export(import(export(fig))) === export(fig)   // byte-stable canonical bytes
```

Plus a headless replay path in `tests/integration/import-from-archive.test.ts`
that runs the full `.lsmlz` → in-memory Figma node tree pipeline on a real
example bundle and asserts that every primitive constructs and direct children
of the root land within the frame.
