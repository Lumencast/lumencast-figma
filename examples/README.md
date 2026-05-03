# Examples

Reference scenes that exercise the full plugin surface. Each example
ships :

- `<name>.lsmlz` — the **single-file archive** (LSML bundle + assets in
  one ZIP). This is what `Lumencast Export → Export to LSML` produces
  in v0.1.2+ ; it is the recommended distribution format.
- `<name>.lsml` — the bare LSML 1.1 bundle (UTF-8 JSON), useful for
  diffing in PR reviews.
- `assets/<hash>.<ext>` — raw asset bytes referenced by the bundle.

| Example                                    | Stack covered                                                                                                           | Archive                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`scoreboard/`](scoreboard/)               | `text` + `stack` (auto-layout) + `image` + multi-fill `shape` + `OperatorInput`                                         | [`scoreboard.lsmlz`](scoreboard/scoreboard.lsmlz)                      |
| [`trading-dashboard/`](trading-dashboard/) | `instance` (LSML §4.9) + Figma variable tokens + `stack` `wrap`/`crossGap` + multi-fill gradient + universal `rotation` | [`trading-dashboard.lsmlz`](trading-dashboard/trading-dashboard.lsmlz) |

## The `.lsmlz` archive format

```
<scene_id>.lsmlz/                ← ZIP container
├── <scene_id>.lsml              ← canonical bundle JSON (UTF-8, no BOM)
└── assets/                      ← optional, content-addressed images
    ├── <figma-imageHash>.png
    ├── <figma-imageHash>.jpg
    └── …
```

- **Media type** : `application/lsml+zip` (proposed ; aligns with
  `application/lsml+json` per LSML §18.2 for the bare bundle).
- **No manifest** : the bundle is self-describing — `scene_id`,
  `scene_version`, the `assets.allowedHosts` policy, and every
  `bind.src` reference are inside the JSON.
- **Compression** : DEFLATE level 6. The `.lsml` JSON typically
  compresses 3–5×, so `.lsmlz` is smaller than `.lsml + assets/` even
  for asset-light scenes.

## How to use

### Render a bundle locally

```bash
# Node — @lumencast/server (https://github.com/Lumencast/lumencast-js)
pnpm dlx @lumencast/server \
    --archive examples/scoreboard/scoreboard.lsmlz \
    --port 8080

# Or pass the bare .lsml + assets dir
pnpm dlx @lumencast/server \
    --bundle examples/scoreboard/scoreboard.lsml \
    --assets examples/scoreboard/assets \
    --port 8080

# Open in any LSML 1.1-compatible runtime
pnpm dlx @lumencast/runtime --connect ws://localhost:8080
```

```bash
# Go — lumencast-go server
lumencast serve examples/trading-dashboard/trading-dashboard.lsmlz --port 8080
```

### Verify a bundle

```bash
# Schema-level (full LSML 1.1 schema)
lumencast validate examples/scoreboard/scoreboard.lsml

# Or unpack the archive first
unzip -p examples/scoreboard/scoreboard.lsmlz scoreboard.lsml | lumencast validate -
```

`parseBundle` re-canonicalises the bundle bytes and re-checks the
SHA-256 hash per [LSML §3.2](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md#32-divergence--scene_version-placeholder).
Any tampering produces a `SCENE_VERSION_MISMATCH` error.

### Regenerate the example archives

```bash
GENERATE_EXAMPLES=1 pnpm exec vitest run tests/_generate-examples.test.ts
```

Each run rebuilds `<scene>.lsml`, the `assets/` directory, and the
`.lsmlz` archive in lockstep. Use this if you change a fixture or the
export logic — the diff in PR review shows exactly what shifted.

## Round-trip an archive back into Figma

1. Open Figma desktop and load the plugin (_Plugins → Development →
   Import plugin from manifest..._).
2. Click **Import .lsml** in the plugin UI.
3. Pick the `<scene>.lsmlz` archive (single file, drag-and-drop friendly).
4. The plugin unpacks the archive, pre-loads the fonts, embeds the
   assets via `figma.createImage`, and rebuilds the design on the
   current page. Bound text shows `[bind:path]` prefixes, image fills
   resolve to the same content-hashed sources, and `OperatorInput`
   markers become FRAMEs with the original plugin data preserved.

The picker is permissive — you can also drop a bare `.lsml` plus all
its sibling images (the legacy v0.1.0 flow) and it will just work.

Re-exporting an imported scene reproduces the input layout +
defaults byte-for-byte — covered by
[`tests/integration/roundtrip.test.ts`](../tests/integration/roundtrip.test.ts).
