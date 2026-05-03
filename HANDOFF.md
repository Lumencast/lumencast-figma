# lumencast-figma — handoff

> **Status** : Phase 2 partial (instance + variables — 2026-05-03, CI green on `main`)
> **Maintainer** : `@ClodoCapeo`
> **Brief** : `../briefs/chantier-lumencast-figma.md`
> **Repo** : https://github.com/Lumencast/lumencast-figma

## What this repo is

Official Figma plugin for Lumencast. Exports a Figma frame to an LSML 1.1 scene bundle (`.lsml`) and re-imports any `.lsml` back into Figma. First Layer 5 (authoring tools) deliverable of the Lumencast ecosystem.

## What is done

### Phase 0 — Foundations (commit `87167ff` + `1f3b165`)

- Repo scaffolded under `D:\Document\Lumencast\lumencast-figma\` and pushed to GitHub
- OSS governance : LICENSE (Apache 2.0), NOTICE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CLAUDE.md, .gitignore
- `manifest.json` (Figma plugin v2) declares `networkAccess: none`
- Build setup : `package.json`, `tsconfig.json`, `vite.config.ts`, ESLint flat config
- ADR 001 documents the 11 product decisions
- CI workflow (9 jobs, all green) : lockfile, lint, typecheck, test, build, bundle-budget, secret-scan, codeowners-check, package (.zip)
- `.github/CODEOWNERS` routes everything to `@ClodoCapeo`

### Phase 1 — Export MVP (commit `0bb1185`)

LSML 1.1 strict export end-to-end. Selecting a FRAME / COMPONENT / INSTANCE in Figma and clicking _Export to LSML_ writes a sealed `.lsml` plus a sibling content-addressed `assets/` directory.

- **Mapping layer** : per-primitive mappers (text / image / shape / frame / stack) + universal props (§5.4) + color/gradient extraction
- **Bindings parser** : `[bind:path]` / `[bindStyle:k=p]` / `[bindUniversal:k=p]` directives on layer names
- **OperatorInput extraction** : Figma component named `OperatorInput` with `lumencast.operator_input.*` plugin data → `bundle.operator_inputs[]`, all 9 LSML 1.1 types per §8.1, per-type constraint validation
- **Asset registry** : Figma `imageHash` → bytes → sha256 → `assets/<sha256>.<ext>` ; rewrites layout + defaults trees ; image bytes returned to UI for download
- **JCS canonicalization** : RFC 8785 + `scene_version` placeholder protocol §3.2, zero-dep local impl in `src/export/canonicalize.ts` (re-export when `@lumencast/compiler` ships to npm)
- **Lite validator** : runtime structural checks in the plugin sandbox (required fields, scene_id charset, primitive kinds, operator-input paths, assets/allowedHosts coupling)
- **Wire-up** : `src/main/index.ts` runs the pipeline, sends typed messages ; `src/ui/` Preact iframe surfaces phase + final scene_version, triggers Blob downloads via `src/ui/download.ts`
- **Tests** : 65 passing, including 6 e2e against `lumencast-protocol/spec/schema.json` (ajv draft 2020-12). Scoreboard fixture validates ; scene_version verifies via the §3.2 protocol ; re-export is byte-stable.

### Phase 2 partial — instance primitive + Figma variables

- **`src/mapping/instance.ts`** — Figma INSTANCE marked with `lumencast.instance.scene_id` + `instance.scene_version` plugin data emits LSML §4.9 `instance` with `params` / `bindParams` / `fit`. Without those markers, the instance falls back to FRAME-like recursion (existing behaviour).
- **`src/mapping/variables.ts`** + `src/main/variables-adapter.ts` — Figma variables (Color / Number / String) resolve to `tokens.<group>.<name>` LeafPaths (slugified collection + variable name). When a shape `fill` or frame `background` has a bound color variable, the static value is replaced with `bind: { fill | background: "tokens.<g>.<n>" }` and the resolved value is seeded under `bundle.defaults`.
- Already shipped in Phase 1 : multi-fill `fills[]` (§4.6 + §4.12), stacked `backgrounds[]` (§4.3), universal props (§5.4), stack `wrap` + `crossGap` (§4.1).
- **Tests** : 87 passing (12 net new), including a Phase 2 e2e proving variable-bound bundles validate against `schema.json`.

## What is next (in order)

### Phase 2 wrap-up

Pending items before Phase 2 is fully closed :

- Text style variables (color, fontSize, fontWeight) — currently dropped because the schema's `text.bind` is restricted to `{value}` only and `bindStyle` isn't in the schema. Tracked in lumencast-protocol#23. Action depends on spec resolution.
- Boolean variables + variable modes (Light/Dark) — deferred to v0.2 per ADR 001 decision #6.

### Phase 3 — Roundtrip (import)

- `src/import/parse.ts` — read `.lsml` JSON, validate
- `src/import/builders/{text,image,shape,frame,stack,instance}.ts` — per-primitive Figma node creators
- `src/import/assets.ts` — fetch / embed images (from local `assets/` dir for v0.1)
- `src/import/reconcile.ts` — overwrite strategy for v0.1
- `tests/integration/roundtrip.test.ts` — assert byte-stable round-trip

### Phase 4 — OSS polish + Figma Community

- README GIF demo
- `docs/from-figma-to-broadcast.md` cookbook
- 3 example pairs (`.fig` + `.lsml`) — scoreboard, conference-board, trading-dashboard (master provides `.fig` files)
- Figma Community submission (screenshots, description, support email)
- Tag `v0.1.0`, GitHub Release with `.zip` artefact
- Update `lumencast-org-profile/README.md`

## Open questions for master

- Figma plugin ID — assigned by Figma at first publish. Will be patched into `manifest.json` post-submission.
- `@lumencast/compiler` consumption — tracked in [lumencast-figma#1](https://github.com/Lumencast/lumencast-figma/issues/1). Local JCS impl is byte-stable and well-tested ; switch when the npm artefact ships.
- LSML 1.1 spec — two open issues raised during Phase 1-2 implementation :
  - [lumencast-protocol#23](https://github.com/Lumencast/lumencast-protocol/issues/23) — image / text static-literal authoring (allow static `src` ? formalise the synthesised-leaf pattern ?)
  - [lumencast-protocol#25](https://github.com/Lumencast/lumencast-protocol/issues/25) — reserve `__lit.*` LeafPath namespace for tooling-synthesised literals.
- Token convention — the plugin emits `tokens.<slugified-collection>.<slugified-variable>`. Prism team should confirm naming compatibility ; alternative is a plugin setting for the prefix.

## Coordination touch points

- **`lumencast-protocol`** — file LSML 1.1 ambiguities discovered during Phase 1-2 implementation as issues there (currently #23, #25 open)
- **`lumencast-js`** — coordinate `@lumencast/compiler` consumption pattern (lumencast-figma#1 tracks the switch)
- **Prism `lsml-import` chantier** (yet to open) — bundles produced by this plugin become inputs to Prism ; coordinate the `tokens.*` naming convention before Phase 2 closes
- **Orion → LSDP/1.1** (roadmap-tracked) — needed to validate the end-to-end demo of Phase 1
