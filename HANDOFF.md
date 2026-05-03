# lumencast-figma — handoff

> **Status** : Phase 1 done (export MVP — 2026-05-03, CI green on `main`)
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

LSML 1.1 strict export end-to-end. Selecting a FRAME / COMPONENT / INSTANCE in Figma and clicking *Export to LSML* writes a sealed `.lsml` plus a sibling content-addressed `assets/` directory.

- **Mapping layer** : per-primitive mappers (text / image / shape / frame / stack) + universal props (§5.4) + color/gradient extraction
- **Bindings parser** : `[bind:path]` / `[bindStyle:k=p]` / `[bindUniversal:k=p]` directives on layer names
- **OperatorInput extraction** : Figma component named `OperatorInput` with `lumencast.operator_input.*` plugin data → `bundle.operator_inputs[]`, all 9 LSML 1.1 types per §8.1, per-type constraint validation
- **Asset registry** : Figma `imageHash` → bytes → sha256 → `assets/<sha256>.<ext>` ; rewrites layout + defaults trees ; image bytes returned to UI for download
- **JCS canonicalization** : RFC 8785 + `scene_version` placeholder protocol §3.2, zero-dep local impl in `src/export/canonicalize.ts` (re-export when `@lumencast/compiler` ships to npm)
- **Lite validator** : runtime structural checks in the plugin sandbox (required fields, scene_id charset, primitive kinds, operator-input paths, assets/allowedHosts coupling)
- **Wire-up** : `src/main/index.ts` runs the pipeline, sends typed messages ; `src/ui/` Preact iframe surfaces phase + final scene_version, triggers Blob downloads via `src/ui/download.ts`
- **Tests** : 65 passing, including 6 e2e against `lumencast-protocol/spec/schema.json` (ajv draft 2020-12). Scoreboard fixture validates ; scene_version verifies via the §3.2 protocol ; re-export is byte-stable.

## What is next (in order)

### Phase 2 — LSML 1.1 advanced features (UNBLOCKED — spec published)

LSML 1.1 spec is published in `lumencast-protocol/spec/LSML-1.md`. No external blocker.

- `src/mapping/instance.ts` — `COMPONENT` / `INSTANCE` → LSML `instance` (§4.9 — `scene_id`, `scene_version`, `params` / `bindParams`)
- `src/mapping/variables.ts` — Figma variables (Color / Number / String) → leaf bindings under `tokens.*` path (composition per §17.0 — emit matching `defaults` block seeded from variable-resolved values)
- Multi-fill / gradients on shapes — `fills[]` discriminated union (§4.6 + §4.12)
- Stacked frame `backgrounds[]` (§4.3, 1.1+)
- Auto-layout `sizing: { x, y }` (`fixed | hug | fill`) — universal prop (§5.4)
- Stack `wrap` + `crossGap` (§4.1, 1.1+)
- Universal `visible`, `opacity`, `rotation` props + `bindUniversal` for the bindable subset

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
- `@lumencast/compiler` consumption — workspace dep (requires monorepo setup) or npm published package ? Phase 1 can stub the canonicalization locally and switch over once decided. Note : LSML §3.1 (JCS RFC 8785) + §3.2 (placeholder protocol) are well-specified, so re-implementing canonicalization in this repo is a safe interim option.
- Token convention details (decision #6) — the plugin emits `bindStyle: { color: "tokens.<group>.<name>" }` derived from Figma variable group names. Confirm naming convention with Prism team before Phase 2 implementation, or accept that designers can rename the path prefix via a plugin setting.

## Coordination touch points

- **`lumencast-protocol`** — file LSML 1.1 ambiguities discovered during Phase 1-2 implementation as issues there
- **`lumencast-js`** — coordinate `@lumencast/compiler` consumption pattern
- **Prism `lsml-import` chantier** (yet to open) — bundles produced by this plugin become inputs to Prism
- **Orion → LSDP/1.1** (roadmap-tracked) — needed to validate the end-to-end demo of Phase 1
