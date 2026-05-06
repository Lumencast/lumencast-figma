# lumencast-figma

> **Lumencast Export — Figma plugin for LSML 1.1 scenes.**
>
> Export a Figma frame to a Lumencast scene bundle (`.lsml`). Re-import any `.lsml` back into Figma. Apache 2.0, OSS, no telemetry, no network calls.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Format: LSML 1.1](https://img.shields.io/badge/Format-LSML%201.1-purple.svg)](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md)
[![Version: v0.1.1](https://img.shields.io/badge/Version-v0.1.1-green.svg)](CHANGELOG.md)
[![CI](https://github.com/Lumencast/lumencast-figma/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Lumencast/lumencast-figma/actions/workflows/ci.yml)

> Output bundles include `$schema: "https://lumencast.dev/schema/lsml/1.1/schema.json"` so any IDE with JSON Schema support (VS Code, JetBrains, Helix…) gives you autocomplete + validation out of the box.

---

## What this plugin does

The plugin sits at the **leftmost arrow** of the Lumencast pipeline :

```
Figma           →     LSML "skeleton"     →     Prism (enrichment)     →     LSML enriched     →     Orion (broadcast)
text/shape/img        export to .lsml           + blueprint                  ready to stream         via LSDP/1.1
frame/stack/instance                            + chat / source
variables (tokens)                              + composite-instance
```

Concretely :

- **Export** — select a Figma frame, click _Export to LSML_, get a single `.lsmlz` archive (ZIP containing the canonical `.lsml` bundle plus content-addressed assets).
- **Import** — open a `.lsmlz` archive (or a loose `.lsml` + sibling `assets/`), the plugin rebuilds the node tree inside the current Figma page.
- **Round-trip-stable** — exporting an imported scene reproduces the source byte-for-byte.

The output is a **valid Lumencast scene bundle** that any `@lumencast/runtime`-compliant host can render — `@lumencast/runtime` (browser), Prism (enrichment editor), Orion (Go server), `lumencast-go server`, `lumencast-py server`, `lumencast-rs server`, or any future implementation.

## Status

**v0.1.1** — feature-complete export + import roundtrip with high-fidelity layout preservation for nested groups, boolean operations, and auto-layout siblings. Figma Community publication is the next step ; until then, install via [local plugin import](#local-development).

| Phase | Scope                                                                                                              | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 0     | Repo, governance, CI, manifest, src/ skeleton                                                                      | done   |
| 1     | Export MVP — text/image/shape/frame/stack, bindings, OperatorInput                                                 | done   |
| 2     | LSML 1.1 features — instances, gradients, universal props, tokens                                                  | done   |
| 3     | Roundtrip — `.lsml` → Figma node tree (byte-stable on fixtures)                                                    | done   |
| 4     | OSS polish + Figma Community submission                                                                            | active |
| 5     | Layout fidelity — flat-then-group transform replay, boolean-op flavour preservation, auto-layout ABSOLUTE siblings | done   |

135 tests passing (export + import + roundtrip + 6 e2e against the canonical `schema.json` + headless import-from-archive). Track the [chantier brief](../briefs/chantier-lumencast-figma.md) for the full plan.

## Quick start (when published)

1. Install the plugin from [Figma Community](https://www.figma.com/community/plugin/<TBD>) (link will be added in v0.1.0).
2. In Figma, select the frame you want to export.
3. Run _Plugins → Lumencast Export → Export selected frame to LSML_.
4. The plugin produces :
   - `your-scene.lsml` — the bundle
   - `assets/` — content-hashed images referenced by the bundle

The bundle is immediately usable :

```bash
# Serve it with the Lumencast Node server
pnpm dlx @lumencast/server --bundle your-scene.lsml --port 8080

# Open the runtime in your browser
pnpm dlx @lumencast/runtime --connect ws://localhost:8080
```

Or with the Go binary :

```bash
lumencast serve your-scene.lsml --port 8080
```

## Conventions

The plugin uses two **layer-name conventions** to capture binding metadata that Figma alone cannot express :

### `[bind:path.to.leaf]` — bind a value to a state path

Rename a Figma layer like this :

```
[bind:show.title] Show Title
[bind:players.0.score] Player 1 Score
```

The corresponding LSML primitive will have `bind: { value: "show.title" }`. At broadcast time, the server pushes deltas at that path and the runtime updates only the bound primitives.

### `OperatorInput` component — declare operator-writable inputs

Drop an instance of the `OperatorInput` component (provided by the plugin) into your design, and configure its plugin data :

- `path` — the leaf path operators write to (e.g. `__inputs.show_title`)
- `type` — `string`, `number`, `boolean`, or `enum`
- `constraints` — optional (`maxLength`, `min`, `max`, `values`)

These get extracted into `bundle.operator_inputs[]` instead of being rendered as primitives.

Full convention reference : [`docs/conventions.md`](docs/conventions.md).

## Mapping table — Figma → LSML 1.1

| Figma node                            | LSML primitive                                                      | Notes                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT`                                | `text`                                                              | font, size, weight, color, align mapped to `style.*` (LSML §4.4)                                                                                              |
| `RECTANGLE` w/ image fill             | `image`                                                             | image hash → `assets/` ref ; `alt` required for a11y (LSML §4.5, §13)                                                                                         |
| `RECTANGLE` / `ELLIPSE` / `VECTOR`    | `shape`                                                             | multi-fill / gradients via `fills[]` (LSML §4.6 + §4.12, 1.1+)                                                                                                |
| `FRAME` (no auto-layout)              | `frame`                                                             | `size: { w, h }`, optional `backgrounds[]` for stacked fills (LSML §4.3, 1.1+)                                                                                |
| `FRAME` (auto-layout horizontal)      | `stack` (`direction: horizontal`)                                   | `gap`, `padding`, `wrap`, `crossGap` (LSML §4.1, 1.1+)                                                                                                        |
| `FRAME` (auto-layout vertical)        | `stack` (`direction: vertical`)                                     | idem                                                                                                                                                          |
| `COMPONENT` / `INSTANCE`              | `instance`                                                          | `scene_id` + `scene_version` + `params` / `bindParams` (LSML §4.9, 1.1+)                                                                                      |
| `GROUP`                               | `frame` (`metadata.figma.sourceType="GROUP"`)                       | flat-then-group reconstruction at import — leaves attached under FRAME ancestor, then `figma.group()` wraps them                                              |
| `BOOLEAN_OPERATION`                   | `frame` (`metadata.figma.sourceType="BOOLEAN_OPERATION"` + flavour) | `UNION` / `SUBTRACT` / `INTERSECT` / `EXCLUDE` preserved ; roundtripped via `figma.union/subtract/intersect/exclude`                                          |
| Figma Variable ref (Color)            | leaf binding                                                        | shape `bind: { fill: "tokens.<group>.<name>" }` / frame `bind: { background: ... }` + `defaults` seeded — composition pattern, no spec extension (LSML §17.0) |
| Auto-layout sizing (`fixed/hug/fill`) | `sizing: { x, y }`                                                  | universal prop on every primitive (LSML §5.4, 1.1+)                                                                                                           |
| Layer name `[bind:path]`              | `bind` field                                                        | text / image / shape value binding                                                                                                                            |
| `OperatorInput` component             | `operator_inputs[]` entry                                           | extracted, not rendered (LSML §8) — supports 9 types (string, number, boolean, enum, color, date, time, path-ref, image-ref)                                  |

Things the plugin intentionally **does not** render natively in v0.1 :

- Animations — belong in LSML `animate` blocks, declared in Prism (the enrichment layer)
- Boolean variables and Figma variable modes (Light/Dark) — kept for v0.2
- Text style variables (color / fontSize) — blocked on [lumencast-protocol#23](https://github.com/Lumencast/lumencast-protocol/issues/23) (`text.bind` schema is `{value}` only)
- Multi-frame batch export — single frame only in v0.1

Effects (drop-shadow, inner-shadow, layer / background blur), blend modes, masks, per-corner radii and similar visual properties **are captured** via `metadata.figma.*` per the [`x-figma.authoring/1`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/profiles/figma-authoring.md) profile — runtimes that support the profile reproduce them ; runtimes that don't ignore the metadata gracefully and render the underlying primitives.

## Local development

```bash
# Node ≥ 22, pnpm ≥ 10
nvm use && corepack enable
pnpm install
pnpm build       # produces dist/main.js + dist/ui.html
pnpm test
pnpm lint
```

To load the plugin in Figma desktop :

1. Figma → _Menu → Plugins → Development → Import plugin from manifest..._
2. Select `manifest.json` at the repo root
3. Open any Figma file, run _Plugins → Development → Lumencast Export_

Watch mode :

```bash
pnpm dev    # rebuilds dist/ on save
```

## Repository layout

```
src/
├── main/        Figma plugin sandbox code (no DOM)
├── ui/          Iframe Preact UI
├── mapping/     Figma node ↔ LSML primitive mappers
├── export/      Figma → LSML pipeline
├── import/      LSML → Figma pipeline
└── shared/      cross-cutting types and constants
```

Detailed layout in [`docs/conventions.md`](docs/conventions.md). Architecture decisions in [`docs/adr/`](docs/adr/).

## Governance

This plugin is part of the **Lumencast** ecosystem :

- [Lumencast org](https://github.com/Lumencast)
- [`lumencast-protocol`](https://github.com/Lumencast/lumencast-protocol) — LSDP/1 + LSML 1.1 specs, conformance suite
- [Governance](https://github.com/Lumencast/lumencast-protocol/blob/main/GOVERNANCE.md)
- [RFC process](https://github.com/Lumencast/lumencast-protocol/blob/main/RFC-PROCESS.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

Protocol-level changes (LSML 1.1 schema, new primitives) belong in the protocol repo, not here. This plugin tracks the published spec.

## License

[Apache 2.0](LICENSE) — see [NOTICE](NOTICE) for attribution.

The "Lumencast" name and the LSDP / LSML acronyms are protected per [GOVERNANCE.md § Brand](https://github.com/Lumencast/lumencast-protocol/blob/main/GOVERNANCE.md#brand).
