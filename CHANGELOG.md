# Changelog

All notable changes to `lumencast-figma` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it ships v1.0 ; pre-1.0 minor versions MAY contain breaking changes,
documented per release.

## [Unreleased]

## [0.1.1] — 2026-05-03

Hot fix — v0.1.0 failed to load in Figma desktop with `Syntax error on line 1: Unexpected token ?` because the bundled `dist/main.js` contained `??` / `?.` operators that Figma's plugin parser does not accept on the sandbox thread.

### Fixed

- **`vite.config.ts`** — main bundle target lowered from `es2022` to `es2017`. esbuild now down-levels nullish coalescing (`??`) and optional chaining (`?.`) into ES2017-compatible patterns. The UI bundle stays at `es2022` (it runs in a Chromium iframe with no parser restriction).

No behavioural changes ; the bundle is ~3 KB larger after down-leveling (`dist/main.js` 37.4 KB → 39.5 KB, well within the 150 KB budget) and the export / import / roundtrip semantics are identical.

## [0.1.0] — 2026-05-03

The first feature-complete release : Figma → LSML 1.1 export and back, with
byte-stable round-trip on fixtures.

### Added

- **Export pipeline** (Figma → `.lsml`)
  - Per-primitive mappers : text, image, shape, frame, stack (LSML §4.1, §4.3-§4.6)
  - Multi-fill / gradients on shapes via `fills[]` (§4.6 + §4.12, 1.1+)
  - Stacked frame `backgrounds[]` (§4.3, 1.1+)
  - Universal props `visible / sizing / opacity / rotation` + `bindUniversal` (§5.4)
  - Stack `wrap` + `crossGap` (§4.1, 1.1+)
  - Layer-name `[bind:path]` / `[bindStyle:k=p]` / `[bindUniversal:k=p]` directives
  - `OperatorInput` component scanner — all 9 LSML 1.1 types per §8.1, with per-type constraint validation
  - Content-addressed asset registry (Figma `imageHash` → SHA-256 → `assets/<sha256>.<ext>`)
  - JSON Canonicalization Scheme (RFC 8785) + `scene_version` placeholder protocol (LSML §3.2)
  - Lite runtime validator (sandbox-friendly) — required fields, scene_id charset, primitive kinds, operator-input paths, assets coupling
- **LSML §4.9 instance primitive** — Figma INSTANCE (or re-imported FRAME) with `lumencast.instance.scene_id` + `instance.scene_version` plugin data emits a sub-scene reference with `params` / `bindParams` / `fit`
- **Figma variables → `tokens.*` LeafPaths** — Color / Number / String variables resolve to `tokens.<group>.<name>` paths (slugified collection + variable name) ; shape `fill` and frame `background` swap static values for `bind: { fill | background: ... }` with the resolved value seeded under `bundle.defaults` (LSML §17.0 composition)
- **Import pipeline** (`.lsml` → Figma node tree)
  - `parseBundle()` reads `.lsml`, validates structure, verifies `scene_version` end-to-end via the §3.2 placeholder protocol
  - Per-primitive Figma builders for text / image / shape / frame / stack / instance
  - Asset re-embedding via `figma.createImage(bytes)` from the user-supplied sibling `assets/` directory
  - Reconcile strategy v0.1 : append the imported root to `figma.currentPage`
  - Synthesised `__lit.*` paths preserved through plugin data so re-export reproduces them byte-stable
- **UI** — Preact + signals iframe with selection summary, export button, import button (File-API picker for `.lsml` + sibling assets), phase status lines, surfaced errors
- **OSS governance** — Apache 2.0 LICENSE, NOTICE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ADR 001 documenting the 11 product decisions
- **CI** — 9-job pipeline (lockfile, lint, typecheck, test, build, bundle-budget, secret-scan, codeowners-check, package .zip)
- **Tests** — 113 passing, including 6 e2e against `lumencast-protocol/spec/schema.json` (ajv draft 2020-12), 3 byte-stable roundtrip integration tests
- **Bundle size** : `dist/main.js` ≤ 40 KB (budget 150 KB), `dist/ui.html` ≤ 11 KB gzipped (budget 50 KB)
- **Documentation** — `README.md`, `docs/conventions.md` (layer-name conventions, plugin data namespace, `__lit.*` synthesis, `tokens.*` namespace, `assets.allowedHosts` policy), `docs/from-figma-to-broadcast.md` cookbook, `docs/publishing.md` Figma Community submission checklist, ADR 001

### Known limitations

Documented in `README.md` § _Things the plugin intentionally does not map in v0.1_ and tracked upstream :

- Text style variables (color / fontSize / fontWeight) — blocked on [lumencast-protocol#23](https://github.com/Lumencast/lumencast-protocol/issues/23) (canonical schema's `text.bind` is restricted to `{value}` only ; `bindStyle` not in schema)
- `__lit.*` LeafPath namespace — informally reserved by the plugin ; formal reservation tracked in [lumencast-protocol#25](https://github.com/Lumencast/lumencast-protocol/issues/25)
- `@lumencast/compiler` consumption — local JCS implementation in `src/export/canonicalize.ts` is byte-stable and well-tested ; switch to the published artefact tracked in [lumencast-figma#1](https://github.com/Lumencast/lumencast-figma/issues/1)

### Deferred to v0.2

- Boolean Figma variables, variable modes (Light / Dark)
- Effects mapping (drop-shadow, inner-shadow, layer blur)
- Multi-frame batch export
- Visual diff merge on import (currently overwrite-only)

[Unreleased]: https://github.com/Lumencast/lumencast-figma/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Lumencast/lumencast-figma/releases/tag/v0.1.1
[0.1.0]: https://github.com/Lumencast/lumencast-figma/releases/tag/v0.1.0
