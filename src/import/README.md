# src/import

LSML bundle → Figma node tree. Reverse of `src/export/`. Round-trip-stable
with the export pipeline (`tests/integration/roundtrip.test.ts`).

| Module                 | Phase | Purpose                                                                       |
| ---------------------- | ----- | ----------------------------------------------------------------------------- |
| `index.ts`             | 3     | `importBundle(bundle) → ImportResult` orchestrator                            |
| `parse.ts`             | 3     | Read bytes / string → `SceneBundle`, validate                                 |
| `reconcile.ts`         | 3     | Strategy when target frame already exists (overwrite v0.1)                    |
| `assets.ts`            | 3     | Fetch and embed images into Figma image hashes                                |
| `builders/text.ts`     | 3     | LSML `text` → `TextNode`                                                      |
| `builders/image.ts`    | 3     | LSML `image` → `RectangleNode` with image fill                                |
| `builders/shape.ts`    | 3     | LSML `shape` → `RectangleNode` / `EllipseNode` / `VectorNode`                 |
| `builders/frame.ts`    | 3     | LSML `frame` → `FrameNode` (no auto-layout)                                   |
| `builders/stack.ts`    | 3     | LSML `stack` → `FrameNode` with `layoutMode`                                  |
| `builders/instance.ts` | 3     | LSML `instance` → `InstanceNode` (creates ComponentSet on the fly if missing) |

Round-trip rule (enforced in tests) : `export(import(export(fig))) === export(fig)` byte-stable.
