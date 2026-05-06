# From Figma to Broadcast — end-to-end cookbook

This cookbook walks the **Figma → LSML → Prism → Orion** pipeline using
real artefacts produced by `lumencast-figma`. It is the operator-level
companion to the technical reference in [`docs/conventions.md`](conventions.md)
and the [LSML 1.1 spec](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md).

```
Figma (visual design)            LSML "skeleton"          Prism (enrichment)             LSML enriched         Orion (broadcast)
   text / shape / frame             ───────────►            + blueprint                  ───────────►          via LSDP/1.1
   image / stack / instance                                  + chat / source
   variables (tokens)                                        + composite-instance
```

You'll end up with :

1. A `.lsml` bundle authored visually, with no JSON written by hand.
2. The bundle enriched with adapters and operator inputs in Prism.
3. The enriched bundle broadcast to a runtime via Orion (or any LSDP/1.1-compliant server).

Estimated time : **15 minutes** end-to-end on the [`scoreboard`](../examples/scoreboard) example.

## Prerequisites

| Tool                                                                             | Why                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Figma desktop (Mac / Windows)                                                    | Run the plugin                                       |
| `lumencast-figma` plugin                                                         | This repo. Load via _Plugins → Development → Import_ |
| `@lumencast/server` ([lumencast-js](https://github.com/Lumencast/lumencast-js))  | Local Lumencast server for testing                   |
| `@lumencast/runtime` ([lumencast-js](https://github.com/Lumencast/lumencast-js)) | Browser runtime to render the scene                  |
| `lumencast validate` ([lumencast-py](https://github.com/Lumencast/lumencast-py)) | Optional — full schema validation locally            |

## Step 1 — Design in Figma

Open Figma and create a frame at your target resolution (1920×1080 is a
common broadcast canvas). Drop in :

- **Text layers** for headlines, scores, labels.
- **Rectangle / ellipse / vector** shapes for cards, dividers, badges.
- **Image fills** on rectangles for logos and photos.
- **Auto-layout frames** for headers, tag rows, sidebars (these become
  LSML `stack` primitives).
- **Plain frames** for absolute-positioned overlays (these become LSML
  `frame` primitives).

### Bind dynamic values

Rename any layer whose value should change at broadcast time :

```
[bind:show.title]                       Show Title         (a TEXT layer)
[bind:match.team_a.score]               Team A Score       (a TEXT layer)
[bind:match.team_a.logo_url]            Team A Logo        (a RECTANGLE w/ image fill)
```

The plugin emits an LSML `bind: { value: "..." }` (or `bind: { src: "..." }`
for images) that the runtime resolves at frame time.

### Declare operator inputs

For values **operators** edit live (show titles, theme, manual scores), drop
in an `OperatorInput` component (the plugin defines one as a Figma local
component) and configure its plugin data :

| Plugin data key              | Example               |
| ---------------------------- | --------------------- |
| `operator_input.path`        | `__inputs.show_title` |
| `operator_input.type`        | `string`              |
| `operator_input.constraints` | `{"maxLength":80}`    |
| `operator_input.label`       | `Show title`          |
| `operator_input.writable_by` | `["operator"]`        |

The component is **not rendered** — it is extracted into `bundle.operator_inputs[]`.
See [`docs/conventions.md` § OperatorInput](conventions.md#operatorinput-figma-component) for the 9 supported types.

### Reuse design tokens

Define Figma color variables in a "Theme" collection (`Background`,
`Accent`, `Text on dark`, …) and reference them on shape fills / frame
backgrounds. The plugin :

- Slugifies the variable name into a `tokens.<group>.<name>` LeafPath.
- Replaces the static color with `bind: { fill: "tokens.theme.accent" }`.
- Seeds the resolved color in `bundle.defaults["tokens.theme.accent"]`.

Operators or downstream tools can rebind `tokens.*` paths to swap the
theme without re-exporting.

## Step 2 — Export to LSML

1. Select the root frame of your scene.
2. Run _Plugins → Development → Lumencast Export_.
3. Click **Export to LSML**.
4. The plugin downloads a single `<scene-id>.lsmlz` archive — an
   [LSMLZ/1](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSMLZ-1.md)
   container packaging :
   - `<scene-id>.lsml` — the canonical bundle JSON (UTF-8, no BOM)
   - `assets/<sha256>.<ext>` — one entry per image referenced by the design
   - Optional `_debug/` subtree (only when the plugin's `--debug` flag is on ;
     readers ignore it per LSMLZ §3.3)

To get the loose form for tools that read `.lsml` directly, unzip the
archive — the produced `<scene-id>.lsml` + `assets/` tree is the form
LSML §18 describes.

The bundle's `scene_version` is the SHA-256 hash of the canonicalized JSON
per [LSML §3.2](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md#32-divergence--scene_version-placeholder).
Two bundles with identical content always produce the same `scene_version`.

### Verify the bundle

```bash
# Schema-level
lumencast validate scene.lsml

# Or in JS / TS
import { parseBundle } from "@lumencast/compiler";
const bundle = await parseBundle(await Bun.file("scene.lsml").text());
```

`parseBundle` recomputes the SHA-256 hash of the canonicalized form and
fails with `SCENE_VERSION_MISMATCH` if the bundle was tampered with after
export.

## Step 3 — Enrich in Prism _(optional)_

Prism (the Lumencast enrichment editor) reads the `.lsml` and lets you :

- Add **external adapters** (`http_poll`, `websocket_subscribe`, `cron`, …) that
  push data onto leaf paths declared in the design.
- Add **chat / source / composite-instance** blocks.
- Re-bind paths, mass-rename leaves, refactor the scene without
  re-opening Figma.

The enriched bundle is still a valid LSML 1.1 — it just has more declarations.

If you don't need enrichment (the design is already self-sufficient :
operator inputs cover the writable surface, no external adapters
required), skip this step. The bundle from Figma works as-is.

## Step 4 — Broadcast via Orion (or `@lumencast/server`)

Orion (Go server) and `@lumencast/server` (Node server) implement the
LSDP/1.1 protocol. Either accepts a `.lsml` bundle and serves :

- **Schema** — operator UIs and runtimes fetch the bundle to render and
  prepare their forms.
- **Snapshot** — the current value of every leaf path.
- **Deltas** — pushes via WebSocket as adapters write or operators edit.

Quick start with `@lumencast/server` :

```bash
# Serve the scoreboard example on port 8080
pnpm dlx @lumencast/server \
    --bundle examples/scoreboard/scoreboard.lsml \
    --assets examples/scoreboard/assets \
    --port 8080
```

Open the runtime in a browser :

```bash
pnpm dlx @lumencast/runtime --connect ws://localhost:8080
```

Or with the Go binary :

```bash
lumencast serve scoreboard.lsml --port 8080
```

The runtime renders the scene, subscribes to deltas, and updates the
bound primitives in real time. Operators connect a separate UI (Stream
Deck, mobile companion, web overlay) that writes to `__inputs.*` paths
declared in the bundle.

## Step 5 — Iterate

When the design changes :

1. Edit in Figma.
2. _Lumencast Export_ produces a new `.lsml` with a new `scene_version`.
3. The server hot-swaps to the new bundle ; runtimes reconnect or refetch.

Every leaf path that already had a binding preserves its current value.
New paths get their `defaults` value as the initial state.

## Round-trip — `.lsml` → Figma

If you only have a `.lsmlz` archive or a loose `.lsml` (e.g. a teammate sent one over) and want to
edit it visually :

1. Run _Lumencast Export → Import_.
2. Pick a single `.lsmlz` archive (preferred — one file, drag-and-drop)
   OR a loose `.lsml` plus all the matching `assets/<sha256>.<ext>` files
   in one selection. The picker sniffs the magic bytes and routes
   accordingly.
3. The plugin rebuilds the node tree on the current Figma page,
   preserving binding paths via plugin data and synthesized `__lit.*`
   leaves.

Re-exporting an imported scene reproduces the original bundle byte-for-byte
on the layout / defaults / assets — see the round-trip integration tests
at [`tests/integration/roundtrip.test.ts`](../tests/integration/roundtrip.test.ts).

## Where to go next

- **Conventions reference** — [`docs/conventions.md`](conventions.md).
- **LSML 1.1 spec** — [`Lumencast/lumencast-protocol`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md).
- **Examples** — [`examples/`](../examples/) ships with `scoreboard` and
  `hello-lumencast` `.lsml` pairs. Run them through `@lumencast/server` to
  see the pipeline live.
- **Architecture decisions** — [`docs/adr/`](adr/).
