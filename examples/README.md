# Examples

Reference scenes that exercise the full plugin surface. Each example
ships an `.lsml` bundle (committed) and a `assets/` directory of
content-addressed images. The matching `.fig` source files will be
published to the Figma Community alongside the v0.1.0 release.

| Example                                    | Stack covered                                                                                                           | Bundle                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`scoreboard/`](scoreboard/)               | `text` + `stack` (auto-layout) + `image` + multi-fill `shape` + `OperatorInput`                                         | [`scoreboard.lsml`](scoreboard/scoreboard.lsml)                      |
| [`trading-dashboard/`](trading-dashboard/) | `instance` (LSML §4.9) + Figma variable tokens + `stack` `wrap`/`crossGap` + multi-fill gradient + universal `rotation` | [`trading-dashboard.lsml`](trading-dashboard/trading-dashboard.lsml) |

Both bundles are produced from the in-tree fixtures :

- `scoreboard` ← `tests/fixtures/figma/scoreboard.ts`
- `trading-dashboard` ← `tests/fixtures/figma/dashboard.ts`

## How to use

### Render a bundle locally

```bash
# Node — @lumencast/server (https://github.com/Lumencast/lumencast-js)
pnpm dlx @lumencast/server \
    --bundle examples/scoreboard/scoreboard.lsml \
    --assets examples/scoreboard/assets \
    --port 8080

# Open in any LSML 1.1-compatible runtime
pnpm dlx @lumencast/runtime --connect ws://localhost:8080
```

```bash
# Go — lumencast-go server
lumencast serve examples/trading-dashboard/trading-dashboard.lsml --port 8080
```

### Verify a bundle

```bash
# Schema-level (full LSML 1.1 schema)
lumencast validate examples/scoreboard/scoreboard.lsml

# Or inline in JS / TS
node -e '
  import("./src/import/parse.ts").then(async ({ parseBundle }) => {
    const fs = await import("node:fs/promises");
    const bytes = await fs.readFile("examples/scoreboard/scoreboard.lsml");
    const bundle = await parseBundle(bytes);
    console.log("OK :", bundle.scene_id, bundle.scene_version);
  });
'
```

`parseBundle` re-canonicalises the bundle bytes and re-checks the
SHA-256 hash per [LSML §3.2](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md#32-divergence--scene_version-placeholder).
Any tampering produces a `SCENE_VERSION_MISMATCH` error.

### Regenerate the bundles

```bash
GENERATE_EXAMPLES=1 pnpm exec vitest run tests/_generate-examples.test.ts
```

Expected output : two example dirs reset, fresh canonical bundles + assets
written, identical bytes to the committed versions (the export pipeline is
deterministic). Use this if you change a fixture or the export logic — the
diff in PR review shows exactly what shifted.

## Round-trip a bundle back into Figma

1. Open Figma and load the plugin (_Plugins → Development → Import plugin
   from manifest..._).
2. Click **Import .lsml** in the plugin UI.
3. Pick `<example>.lsml` plus all the files inside `assets/` in the same
   file picker dialog.
4. The plugin rebuilds the design on the current page — bound text shows
   `[bind:path]` prefixes, image fills resolve to the same content-hashed
   sources, and `OperatorInput` markers become FRAMEs with the original
   plugin data preserved.

Re-exporting an imported scene reproduces the input `.lsml` byte-for-byte
on the layout / defaults / assets — covered by
[`tests/integration/roundtrip.test.ts`](../tests/integration/roundtrip.test.ts).
