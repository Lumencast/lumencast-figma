# src/mapping

Per-primitive Figma node → LSML primitive mappers. Pure functions — no I/O,
no Figma mutations. Each module exports one `map<Primitive>` function plus
its types.

## Per-primitive mappers

| Module         | Maps from                                     | To LSML primitive                                                                             |
| -------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `text.ts`      | `TEXT`                                        | `text`                                                                                        |
| `image.ts`     | `RECTANGLE` with `IMAGE` fill                 | `image`                                                                                       |
| `shape.ts`     | `RECTANGLE` (no image), `ELLIPSE`, `VECTOR`   | `shape`                                                                                       |
| `frame.ts`     | `FRAME` (no auto-layout)                      | `frame`                                                                                       |
| `stack.ts`     | `FRAME` with `layoutMode != NONE`             | `stack`                                                                                       |
| `instance.ts`  | `COMPONENT`, `INSTANCE`                       | `instance`                                                                                    |
| `variables.ts` | Figma variable refs (Color / Number / String) | `tokens.<group>.<name>` LeafPath bindings (LSML §17.0 composition pattern, no spec extension) |

## Container nodes (GROUP / BOOLEAN_OPERATION)

`GROUP` and `BOOLEAN_OPERATION` are emitted as `frame` primitives carrying
`metadata.figma.sourceType="GROUP"` / `"BOOLEAN_OPERATION"` (with the BO
flavour `UNION` / `SUBTRACT` / `INTERSECT` / `EXCLUDE` under
`metadata.figma.booleanOperation`). The import side reads these markers
in `walk.ts:buildGroupInline` to reconstruct real `GroupNode` /
`BooleanOperationNode` via `figma.group/union/subtract/intersect/exclude`.

`figma-mixed.ts` handles Figma's `mixed` symbol (per-character text style
overrides) — flattens a TEXT node's per-range styling into LSML
`metadata.figma.textRanges[]`.

## Helpers

| Module              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traverse.ts`       | Walks the Figma node tree, dispatches per node type, composes `metadata.figma.transform` through transparent-Group ancestor chains so leaves end up FRAME-relative                                                                                                                                                                                                                                                               |
| `index.ts`          | Public re-exports for `src/export/` and tests                                                                                                                                                                                                                                                                                                                                                                                    |
| `types.ts`          | Mapping-side shared types                                                                                                                                                                                                                                                                                                                                                                                                        |
| `figma-metadata.ts` | Capture the `metadata.figma.*` block per primitive (sourceType, transform, layoutSizing\*, layerName, …)                                                                                                                                                                                                                                                                                                                         |
| `figma-extras.ts`   | Capture optional figma-flavour fields on top of the LSML primitive (effects, blendMode, isMask, maskType, stroke details, constraints, layoutAlign / Grow / Positioning, layoutSizingHorizontal/Vertical, minWidth/maxWidth/minHeight/maxHeight, cornerRadius/cornerRadii/cornerSmoothing) — see the [`x-figma.authoring/1`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/profiles/figma-authoring.md) profile |
| `universal.ts`      | Capture LSML §5.4 universal props (visible / opacity / rotation / sizing)                                                                                                                                                                                                                                                                                                                                                        |
| `color.ts`          | Figma `RGB` / `RGBA` → CSS color string                                                                                                                                                                                                                                                                                                                                                                                          |
| `preload.ts`        | Walk a frame in advance to enumerate the fonts / images that need to be loaded before the actual `mapFrame` call                                                                                                                                                                                                                                                                                                                 |
| `trace.ts`          | Optional `ctx.trace` event log — surfaces in `_debug/mapping-trace.json` when archive debug is on                                                                                                                                                                                                                                                                                                                                |

Add a new mapper here only when LSML 1.1 (or the active authoring profile)
covers the corresponding primitive or capture field. Otherwise file an issue
against `lumencast-protocol`.
