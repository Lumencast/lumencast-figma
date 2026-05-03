# Contributing to lumencast-figma

Thanks for considering a contribution.

This repository ships the official **Lumencast** Figma plugin — Figma frame ↔ LSML 1.1 scene bundle. Governance for the wire protocol (LSDP/1) and the scene format (LSML 1.1) lives in the [protocol repo](https://github.com/Lumencast/lumencast-protocol). Read its [`CONTRIBUTING.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/CONTRIBUTING.md) and [`GOVERNANCE.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/GOVERNANCE.md) before proposing protocol-touching changes.

This file documents what is **specific to the Figma plugin**.

## Setup

```bash
# Node ≥ 22, pnpm ≥ 10
nvm use            # picks .nvmrc
corepack enable    # enables pnpm shipped with Node
pnpm install
```

## Day-to-day commands

```bash
pnpm build              # bundle dist/main.js + dist/ui.html via Vite
pnpm dev                # watch mode — rebuilds on save
pnpm typecheck          # tsc --noEmit
pnpm lint               # ESLint flat config, max 0 warnings
pnpm format             # Prettier write
pnpm format:check       # Prettier verify (used in CI)
pnpm test               # Vitest unit + integration
pnpm test:watch         # Vitest watch
pnpm package            # produces lumencast-figma-vX.Y.Z.zip for Figma submission
```

## Loading the plugin in Figma desktop

1. Run `pnpm build` (or `pnpm dev` for watch mode).
2. Figma → _Menu → Plugins → Development → Import plugin from manifest..._
3. Select `manifest.json` at the repo root.
4. Open any Figma file → _Plugins → Development → Lumencast Export_.

## Pull requests

- One feature or fix per PR. Keep the diff focused.
- Branch naming : `feature/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`.
- Squash-merge only. The PR title becomes the merge commit subject.
- Required CI gates :
  - `lockfile` — `pnpm install --frozen-lockfile` succeeds
  - `lint` — Prettier check + ESLint, 0 warnings
  - `typecheck` — `tsc --noEmit` strict
  - `test` — Vitest unit + integration
  - `build` — Vite produces `dist/main.js` and `dist/ui.html`
  - `secret-scan` — Trufflehog
  - `codeowners-check` — `.github/CODEOWNERS` present and parses
- Reviewers : the CODEOWNERS for the touched paths (currently `@ClodoCapeo` for the whole repo until a core team is recruited).

## Conventions

### Mapping changes

Any change to the **Figma → LSML** or **LSML → Figma** mapping table is breaking by default. Two rules :

1. New primitive mappers go in `src/mapping/<primitive>.ts` and ship with unit fixtures in `tests/unit/mapping/<primitive>.test.ts`.
2. Behaviour changes for existing primitives MUST update the round-trip integration test (`tests/integration/roundtrip.test.ts`) — failing that test is a sign your change breaks an existing scene.

### Layer-name conventions

The `[bind:path]` layer prefix and the `OperatorInput` component contract are **public API**. Changing them requires :

- An ADR in `docs/adr/`
- A migration note in `CHANGELOG.md`
- A bump of the major version

### Plugin data

All `figma.root.setPluginData()` and `node.setPluginData()` keys are namespaced `lumencast.*` (e.g. `lumencast.binding.path`, `lumencast.operator_input.constraints`). Never write outside that namespace ; never read pluginData from other namespaces.

### LSML target version

The plugin emits **LSML 1.1 strict**. It does NOT fall back to 1.0 when 1.1 features are missing — instead it produces a validation error and surfaces it in the UI. If LSML 1.1 doesn't support a Figma feature you want to map, file an issue against `lumencast-protocol`, not against this repo.

### Bundle output

The on-wire format is JSON content-addressed (per LSML 1.1 spec). The file extension is `.lsml` — a renamed `.lsml.json`. This is a Lumencast-wide convention propagated from the protocol repo.

## Tests

- `tests/unit/` — pure functions, mocked Figma API
- `tests/integration/` — full export → import → export round-trip
- `tests/fixtures/figma/` — JSON dumps of Figma node trees (no `.fig` files in CI)
- `tests/fixtures/lsml/` — expected LSML output corresponding to each Figma fixture

Add a new fixture pair when introducing a mapping rule. The integration test will pick it up automatically.

## Releases

Releases happen manually for now :

1. Bump version in `package.json` and `manifest.json`
2. Update `CHANGELOG.md`
3. Tag : `git tag vX.Y.Z && git push --tags`
4. GitHub Release with the `lumencast-figma-vX.Y.Z.zip` artefact attached
5. Submit the new version to Figma Community (manual review, 1-3 weeks)

## Questions

Open a [GitHub Discussion](https://github.com/Lumencast/lumencast-figma/discussions) (when enabled) or file an issue. Security reports go through [SECURITY.md](SECURITY.md), not public issues.
