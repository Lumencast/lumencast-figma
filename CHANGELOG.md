# Changelog

All notable changes to `lumencast-figma` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it ships v1.0 ; pre-1.0 minor versions MAY contain breaking changes,
documented per release.

## [Unreleased]

Layout-fidelity hardening for nested groups, boolean operations, and auto-layout siblings flagged "ignore auto layout". Surfaced when bento / steps / hero stats cards round-tripped with collapsed visuals on first re-import.

### Fixed

- **Flat-then-group child positions under auto-layout parent** ([`12a433a`](https://github.com/Lumencast/lumencast-figma/commit/12a433a)) — leaves built into a transient flat group under an auto-layout FRAME ancestor were repacked by the stack instead of honouring their captured `relativeTransform`. The wrap bbox collapsed (`Group 2087326240` re-imported at 27×15 with the 4 sub-groups visually missing).
- **Boolean op flavour preserved on roundtrip** ([`0532e99`](https://github.com/Lumencast/lumencast-figma/commit/0532e99)) — `SUBTRACT` / `INTERSECT` / `EXCLUDE` were silently demoted to `UNION` at import. `metadata.figma.booleanOperation` is now read on import and routed to `figma.subtract` / `intersect` / `exclude`.
- **Boolean op captured fill applied** ([`a8ca8f7`](https://github.com/Lumencast/lumencast-figma/commit/a8ca8f7)) — `BooleanOperationNode` paints with its OWN fills (operands provide geometry only). The captured `background` / `backgrounds[]` from the LSML frame primitive is now re-applied on the freshly built BO node ; without this every `Subtract` / `Intersect` / `Exclude` rendered fully transparent.
- **Size + sizing modes re-applied after auto-layout attach** ([`023d686`](https://github.com/Lumencast/lumencast-figma/commit/023d686)) — frames captured as FIXED / FIXED at 1440 × 2187 came back HUG / HUG at the createFrame default 100 × 100 because Figma's auto-layout reset sizing during `appendChild`. Both axes are now forced to FIXED first ; `applyFigmaExtras` then restores the captured modes.
- **`relativeTransform` post-attach replay for every flat-then-group child** ([`a0bb3b9`](https://github.com/Lumencast/lumencast-figma/commit/a0bb3b9)) — Figma's `relativeTransform` setter on an off-tree node doesn't stick. Without a post-attach replay, every flat-then-group leaf landed at (0, 0) in the FRAME ancestor and `figma.group()` wrapped a stack of siblings at the origin — bbox collapsed to a tiny union.
- **`layoutPositioning="ABSOLUTE"` + position post-attach replay** ([`8e051fc`](https://github.com/Lumencast/lumencast-figma/commit/8e051fc)) — Figma silently drops `ABSOLUTE` when set on an off-tree node, and overwrites `x`/`y` on `appendChild` to an auto-layout stack with the layout slot. Children flagged "ignore auto layout" in the source (Background+Shadow indicators, free-positioned content frames) now have the flag re-applied post-attach and their captured position re-asserted.

### Added

- **Headless import-replay integration test** — `tests/integration/import-from-archive.test.ts` runs the full `.lsmlz` → in-memory Figma node tree pipeline against a real example bundle (`examples/template-stats.lsmlz`), proving that every primitive in the archive constructs and that direct children of the root land within (or just outside) the frame.
- **Mock simulates Figma's silent-drop quirks** — `tests/fixtures/figma/import-mock.ts` now models the `layoutPositioning="ABSOLUTE"` silent-drop on off-tree nodes, the `appendChild` x/y reset on auto-layout parents, and the `figma.group()` default `AUTO` positioning. Regression tests for the post-attach replay can now fail in CI when the replay is removed.

22 net-new tests (135 total ; was 113 at v0.1.1).

## [0.1.1] — 2026-05-03

Two production-blocker fixes uncovered when v0.1.0 was loaded into Figma desktop for the first time.

### Fixed

- **Bundle parsing** — v0.1.0 emitted `??` and `?.` in `dist/main.js` because Vite's `target` was `es2022`. Figma's plugin parser refused them with `Syntax error on line 1: Unexpected token ?`. Lowered the main bundle target to `es2017` ; esbuild now down-levels both operators. The UI bundle stays at `es2022` (it runs in a Chromium iframe with no parser restriction).
- **Figma host-object spread** — `src/mapping/shape.ts` constructed stroke paints via `{ ...s, type: "SOLID" }` where `s` is a Figma `Stroke` host object. esbuild's ES2017 spread helper iterates `Object.getOwnPropertySymbols(s)` and the host wrapper coerces Symbol keys to numeric indices, throwing `cannot convert symbol to number` when the user clicked _Export to LSML_. Replaced the spread with explicit field copying.

No behavioural changes — 113 tests still pass, bundle size is `dist/main.js` 39.5 KB / 150 KB and `dist/ui.html` 10.3 KB gzipped / 50 KB.

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
