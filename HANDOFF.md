# lumencast-figma — handoff

> **Status** : Phase 0 in progress (scaffolding 2026-05-03 — repo skeleton + governance + ADR + brief)
> **Maintainer** : `@ClodoCapeo`
> **Brief** : `../briefs/chantier-lumencast-figma.md`

## What this repo is

Official Figma plugin for Lumencast. Exports a Figma frame to an LSML 1.1 scene bundle (`.lsml`) and re-imports any `.lsml` back into Figma. First Layer 5 (authoring tools) deliverable of the Lumencast ecosystem.

## What is done (Phase 0)

- Repo scaffolded under `D:\Document\Lumencast\lumencast-figma\`
- OSS governance : LICENSE (Apache 2.0), NOTICE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CLAUDE.md, .gitignore
- `manifest.json` (Figma plugin v2) declares `networkAccess: none`
- Build setup : `package.json`, `tsconfig.json`, `vite.config.ts`, ESLint flat config
- `src/` skeleton : `main/`, `ui/`, `mapping/`, `export/`, `import/`, `shared/` with stubs
- Tests scaffold : `tests/unit/`, `tests/integration/`, `tests/fixtures/`
- ADR 001 documents the 11 product decisions
- CI workflow : lockfile, lint, typecheck, test, build, bundle-budget, secret-scan, codeowners-check
- `.github/CODEOWNERS` routes everything to `@ClodoCapeo`

## What is next (in order)

### Phase 1 — Export MVP (LSML 1.1 strict)

Implement, in order :

1. `src/main/messages.ts` — typed message bus contract (DONE — Phase 0)
2. `src/main/index.ts` — Figma plugin entry, opens UI, handles selection (DONE skeleton — Phase 0)
3. `src/ui/` — Preact UI (DONE skeleton — Phase 0)
4. `src/mapping/{text,image,shape,frame,stack}.ts` — per-primitive mappers
5. `src/export/bindings.ts` — `[bind:path]` parsing
6. `src/export/operator-inputs.ts` — `OperatorInput` component extraction (9 LSML 1.1 types per §8.1)
7. `src/export/assets.ts` — image extraction → `assets/<sha256>.<ext>`, `assets.allowedHosts` declared in bundle
8. `src/export/bundle.ts` — assemble + JCS canonicalize via `@lumencast/compiler` (LSML §3.1, §3.2)
9. `src/export/validate.ts` — schema validation against `lumencast-protocol/spec/schema.json`
10. End-to-end test : export a fixture `.fig` (provided by master) → produced `.lsml` loads in `@lumencast/runtime` and `lumencast validate` exits 0

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
