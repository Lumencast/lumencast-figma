# lumencast-figma — projet CLAUDE.md

@../../docs/rules/git.md
@../../docs/rules/security.md
@../../docs/rules/agents.md
@../agents/\_shared/architecture.md
@../agents/\_shared/conventions.md
@../agents/\_shared/deploy.md
@../agents/\_shared/projects.md

## Description

`lumencast-figma` est le **plugin Figma officiel de Lumencast**. Il convertit une frame Figma en bundle de scène **LSML 1.1** (`.lsml`) et inversement (roundtrip). Premier livrable Layer 5 (authoring tools) du projet Lumencast.

Le repo est un **package unique** (pas un monorepo) qui produit deux artefacts buildés :

- `dist/main.js` — code sandbox du plugin (pas d'accès DOM, accès Figma API restreint)
- `dist/ui.html` — UI iframe (Preact + signals, pas d'accès Figma API)

Distribution : Figma Community (publication officielle) + GitHub Releases (`.zip` artefact).

## Stack

- **Runtime** : Node ≥ 22 (build-time only — le plugin tourne dans Figma)
- **Package manager** : pnpm ≥ 10
- **Language** : TypeScript 5.7 strict (`noUncheckedIndexedAccess` on)
- **UI iframe** : Preact 10 + `@preact/signals` (bundle ~10-30 KB gz)
- **Figma API** : `@figma/plugin-typings` (typings only, MIT)
- **Canonicalization** : `@lumencast/compiler` (depuis `lumencast-js/packages/compiler/`) — source de vérité pour le hashing du bundle
- **Build** : Vite 6 library mode, deux entrées (`src/main/index.ts` + `src/ui/index.tsx`)
- **Test** : Vitest (unit + integration) avec mock Figma API
- **Lint** : ESLint 9 flat config + Prettier
- **License** : Apache 2.0

## Setup local

```bash
nvm use && corepack enable
pnpm install
pnpm build
pnpm test
```

Pour charger le plugin dans Figma :

1. Figma desktop → _Menu → Plugins → Development → Import plugin from manifest..._
2. Sélectionner `manifest.json` à la racine
3. Ouvrir un fichier Figma → _Plugins → Development → Lumencast Export_

Voir `CONTRIBUTING.md` pour les commandes complètes.

## Conventions spécifiques

- **Source canonique du format** : `lumencast-protocol/spec/LSML-1.md`. Aucune divergence d'identifiants ou de sémantique. Le plugin emet **LSML 1.1 strict**, jamais 1.0 fallback.
- **Extension fichier** : `.lsml` (renommage de `.lsml.json` — le contenu reste du JSON content-addressé). Convention propagée depuis le protocol repo.
- **Plugin data namespace** : `lumencast.*` exclusivement. Lecture / écriture hors namespace interdite.
- **Layer name conventions** (public API — breaking change si modifiées) :
  - `[bind:path.to.leaf] <Layer Name>` → binding sur la primitive
  - Component `OperatorInput` (avec props plugin data) → entrée `operator_inputs[]`
- **Mapping Figma → LSML** : table normative dans `README.md` § Mapping. Toute modification = nouvelle entrée ADR.
- **Network access** : ZÉRO. `manifest.json` déclare `allowedDomains: ["none"]`. Toute évolution = bump version + opt-in UI explicite.
- **Pas de telemetry** — aucune collecte d'usage, aucune erreur remontée à un endpoint externe.
- **Public surface** stable : message contract `src/main/messages.ts` + `[bind:...]` convention + `OperatorInput` component shape. Tout changement breaking bumpe le major.
- **Roundtrip-stable** — `export(import(export(fig))) == export(fig)` byte-identical, garanti par `tests/integration/roundtrip.test.ts`.

## Architecture

```
manifest.json                    Figma plugin v2
├── main: dist/main.js          ← src/main/  (sandbox, no DOM)
└── ui:   dist/ui.html          ← src/ui/    (iframe Preact)

src/main → src/ui : figma.ui.postMessage(typed message)
src/ui → src/main : parent.postMessage(typed message)
                    types in src/main/messages.ts
```

Pipelines :

```
Figma node tree   →  src/mapping/     →  src/export/    →  .lsml file
                    (per-primitive       (assemble +
                     mappers)             canonicalize)

.lsml file        →  src/import/parse →  src/import/     →  Figma node tree
                                          builders/
                                          (per-primitive)
```

## Performance budgets

| Métrique                                   | Budget     | Mesure             |
| ------------------------------------------ | ---------- | ------------------ |
| `dist/main.js` size (after Vite bundle)    | ≤ 150 KB   | CI artifact size   |
| `dist/ui.html` size (HTML+JS+CSS embedded) | ≤ 50 KB gz | CI script          |
| Cold export single frame (≤ 100 nodes)     | ≤ 500 ms   | Vitest perf bench  |
| Cold import single bundle (≤ 100 prims)    | ≤ 1 s      | Vitest perf bench  |
| Plugin cold start (Figma load → UI ready)  | ≤ 200 ms   | manual measurement |

## Test coverage

| Type                               | Seuil                | Mesure              |
| ---------------------------------- | -------------------- | ------------------- |
| Mapping functions (per primitive)  | 90 %                 | `vitest --coverage` |
| Export pipeline (bundle, validate) | 90 %                 | `vitest --coverage` |
| Import pipeline (parse, builders)  | 90 %                 | `vitest --coverage` |
| Layer name parsing (`[bind:...]`)  | 100 %                | `vitest --coverage` |
| Round-trip integration             | every public mapping | `roundtrip.test.ts` |

## CI/CD

`.github/workflows/ci.yml` jobs :

- `lockfile-check`, `lint`, `typecheck`, `test`, `build`
- `bundle-budget` (vérifie les budgets `dist/main.js` + `dist/ui.html`)
- `secret-scan` (Trufflehog), `codeowners-check`

Concurrency : cancel sur PR, no cancel sur main. Pas de release auto v0.1.x — Figma Community publish manuel.

## Decisions

- **2026-05-03** — Preact + signals (pas React) pour l'iframe UI : bundle 5× plus petit (~10 KB vs ~50 KB), suffisant pour la surface UI du plugin.
- **2026-05-03** — Vite library mode avec deux entrées plutôt que rollup direct : meilleur DX (HMR en `pnpm dev` pour l'iframe), config minimaliste.
- **2026-05-03** — `.lsml` extension propagée depuis ce chantier, à standardiser cross-SDK via une PR sur le protocol repo après v0.1.0.
- **2026-05-03** — Roundtrip support **dans v0.1**, pas v0.2 : décision produit forte du master conversation. Coût ~3 semaines additionnelles assumé.
- **2026-05-03** — LSML 1.1 strict d'office (pas de fallback 1.0) : la cohérence du pipeline Figma → Prism → Orion exige une version unique. Si LSML 1.1 manque une feature, c'est un issue contre `lumencast-protocol`, pas contre ce repo.
- **2026-05-03** — Variables Figma supportées (Color / Number / String) en v0.1, modes Light/Dark + Boolean en v0.2 : trade-off complexité × valeur.

## Source material

Pas de fork interne. Plugin écrit from scratch contre :

- Figma Plugin API v2 documentation (`@figma/plugin-typings`)
- `lumencast-protocol/spec/LSML-1.md` (pour LSML 1.1)
- `lumencast-js/packages/compiler/` (pour la canonicalization, importé en dépendance via workspace ou published artifact selon timing)
