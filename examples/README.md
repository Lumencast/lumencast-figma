# Examples

Reference designs that exercise the full plugin surface. Each example
is a pair :

- `*.fig` — Figma source file (link to Figma Community when published, or
  raw `.fig` checked in if size permits)
- `expected.lsml` — the LSML 1.1 bundle that the plugin should produce

Phase 4 publishes the three examples below alongside the v0.1.0 release.

| Example              | Stack covered                                                        | Status  |
| -------------------- | -------------------------------------------------------------------- | ------- |
| `scoreboard/`        | `text` + `stack` + `[bind:path]` + `OperatorInput`                   | Phase 1 |
| `conference-board/`  | `text` + `repeat` + `OperatorInput` (string + enum)                  | Phase 1 |
| `trading-dashboard/` | `instance` + Figma variables (token bindings) + `shape` w/ gradients | Phase 2 |

## How to use

1. Open the `.fig` file in Figma.
2. Select the root frame.
3. Run _Plugins → Lumencast Export → Export selected frame to LSML_.
4. Compare the produced bundle to `expected.lsml` (should match byte-for-byte
   after canonicalization).
