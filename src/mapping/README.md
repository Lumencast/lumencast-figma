# src/mapping

Per-primitive Figma node → LSML primitive mappers. Pure functions — no I/O,
no Figma mutations. Each module exports one `map<Primitive>` function plus
its types.

| Module         | Phase | Maps from                                                        | To LSML primitive |
| -------------- | ----- | ---------------------------------------------------------------- | ----------------- |
| `text.ts`      | 1     | `TEXT`                                                           | `text`            |
| `image.ts`     | 1     | `RECTANGLE` with `IMAGE` fill                                    | `image`           |
| `shape.ts`     | 1     | `RECTANGLE` (no image), `ELLIPSE`, `VECTOR`, `BOOLEAN_OPERATION` | `shape`           |
| `frame.ts`     | 1     | `FRAME` (no auto-layout), `GROUP`                                | `frame`           |
| `stack.ts`     | 1     | `FRAME` with `layoutMode != NONE`                                | `stack`           |
| `instance.ts`  | 2     | `COMPONENT`, `INSTANCE`                                          | `instance`        |
| `variables.ts` | 2     | Figma variable refs (Color/Number/String)                        | token bindings    |
| `traverse.ts`  | 1     | walks the node tree, dispatches per-node                         | n/a               |

Add a new mapper here only when LSML 1.1 has the corresponding primitive.
Otherwise file an issue against `lumencast-protocol`.
