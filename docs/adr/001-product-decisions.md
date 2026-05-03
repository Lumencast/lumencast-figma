# ADR 001 — Product decisions for v0.1

- **Status** : Accepted
- **Date** : 2026-05-03
- **Decider** : master conversation (Lumencast)
- **Supersedes** : —

## Context

Before scaffolding the `lumencast-figma` repo, eleven product decisions
needed to be locked. Each one carried a non-trivial cost and was
hard to reverse after publication on the Figma Community. This ADR
captures the agreed positions and the rationale for each.

## Decisions

### 1. Export scope = single frame

The plugin exports the currently selected frame, not the page or a
multi-frame batch. Multi-frame batch is deferred to v0.2.

**Rationale** : A single frame matches the Lumencast scene model
(one bundle = one scene root). It also keeps the UI flow obvious for
the first user. Batch export adds parallel state, error reconciliation
across files, and a more complex UI — better tackled once the single-frame
path is proven.

### 2. Bindings via layer name prefix `[bind:path.to.leaf]`

Layers whose name starts with `[bind:<leafpath>]` produce a primitive
with `bind: { value: "<leafpath>" }`. The remainder of the layer name
is preserved as a human label.

**Rationale** : Survives Figma exports/imports, visible in the layer
panel, no UI burden, no plugin data dependency for the most common case.
Roundtrip-friendly because the convention is purely textual.

### 3. Operator inputs via `OperatorInput` Figma component

The plugin ships a Figma component named `OperatorInput`. Each instance
declares its `path`, `type`, and optional `constraints` via plugin
data fields. At export time, instances are extracted into
`bundle.operator_inputs[]` rather than rendered as primitives.

**Rationale** : Operator inputs are metadata, not visuals. A dedicated
component keeps them visible in the Figma file (designers see what
operators will manipulate) without polluting the rendered tree.

### 4. Assets exported to sibling `assets/` directory, content-hashed refs

Image fills are hashed (sha256), written to a sibling `assets/`
directory, and referenced from the bundle as `assets/<hash>.<ext>`.
The user is responsible for hosting the assets on a CDN they choose.

**Rationale** : Content-hashing matches the rest of the Lumencast
philosophy (LSML bundles are themselves content-hashed). Keeping
asset hosting out of the plugin keeps the network policy at zero —
no CDN credentials, no upload step, no rate limits to worry about.

### 5. Components / Instances → LSML 1.1 `instance` primitive (auto-conversion)

Figma `COMPONENT` and `INSTANCE` nodes are auto-converted to LSML 1.1
`instance` primitives. Instance overrides become `params`. No opt-in
flag required.

**Rationale** : Reusable composition is a first-class Figma concept.
Mapping it to `instance` preserves the designer's intent and avoids
inlining the same sub-tree N times. Auto-conversion (vs opt-in) keeps
the mental model simple — "components in Figma stay components in LSML".

### 6. Figma variables → token bindings (composition pattern, no spec extension needed)

Figma variables of type `Color`, `Number`, and `String` become standard
LSML bindings emitted under the `tokens.*` path convention :

```json
{ "kind": "text", "bindStyle": { "color": "tokens.brand.primary" } }
```

Boolean variables and Figma variable modes (Light/Dark) are deferred to v0.2.

**Resolution** : LSML 1.1 already supports this via composition (LSML
§17.0). The plugin emits regular `bind` / `bindStyle` / `bindUniversal`
references to a `tokens.*` leaf-path namespace. The runtime treats these
as ordinary state ; the server seeds them via `defaults` and updates them
via deltas. **No spec extension required.**

The plugin also emits a matching `defaults` block in the produced bundle,
populated from the variables' resolved values in the design (so the
bundle renders correctly out of the box, even before the server pushes
any deltas). Operators can then override via `__inputs.tokens.*`
operator inputs if the design declares them.

**Rationale** : Treating tokens as state (vs baked colors) means the
same scene re-renders correctly when the server pushes a token override.
Using composition rather than a spec extension keeps `tokens.*` purely a
plugin convention — any Lumencast runtime renders it without
modification.

### 7. Roundtrip = both export AND import in v0.1

The plugin reads `.lsml` files and reconstructs the Figma node tree.
Round-trip is byte-stable — `export(import(export(fig))) === export(fig)`.

**Rationale** : One-way export is half the story. Without import,
collaborating across Figma and Prism (or two designers) requires
manual recreation. Roundtrip is what makes Lumencast `.lsml` a
shareable design artefact, not just an export target. The cost
(estimated ~3 weeks) is accepted upfront.

### 8. Plugin data namespace = `lumencast.*`

All `getSharedPluginData` / `setSharedPluginData` keys live under the
`lumencast` namespace. Reading or writing under any other namespace
is forbidden by lint rules.

**Rationale** : Cross-plugin pluginData isolation is enforced by
Figma's `*Shared*` API only when the namespace is unique. `lumencast`
is sufficiently distinct, and prefixing all keys keeps debugging
straightforward.

### 9. UI iframe stack = Preact + signals

The iframe UI uses Preact 10 + `@preact/signals` rather than React.

**Rationale** : Preact bundles ~5× smaller than React (~10 KB gz vs
~50 KB gz) — well within the 50 KB iframe budget declared in
`CLAUDE.md`. Signals fit Lumencast's leaf-grain reactive philosophy.
The iframe surface is small (selection panel, two buttons, error
display) so Preact's lighter ergonomics suffice.

### 10. LSML target version = 1.1 strict

The plugin emits LSML 1.1 only. No fallback to 1.0 when 1.1 features
are unavailable — the validation step rejects the export and surfaces
the missing field in the UI.

**Rationale** : Two parallel target versions would double the
mapping table and the test surface. Locking to 1.1 forces feature
parity with Prism (which assumes 1.1 for the enrichment layer). If
1.1 is missing a Figma feature, the right fix is to extend 1.1 in
`lumencast-protocol`, not to fork the plugin's output.

### 11. File extension = `.lsml` + canonical `$schema` URL

The on-disk extension is `.lsml` (LSML §18.1). Contents are JSON
content-addressed via JCS (LSML §3.1) with the `scene_version` placeholder
protocol (LSML §3.2). Media type when served over HTTP : `application/lsml+json`
(LSML §18.2).

Every bundle written by the plugin includes a `$schema` field pointing
at the canonical LSML 1.1 URL :

```
"$schema": "https://lumencast.dev/schema/lsml/1.1/schema.json"
```

This enables editor autocomplete and validation in any JSON-Schema-aware
IDE (VS Code, JetBrains, Helix, etc.) — see LSML §18.4.1.

**Rationale** : The bundle is a Lumencast artefact, not a generic JSON
file. A dedicated extension makes file association possible (MIME type,
OS file picker), reduces confusion with arbitrary JSON, and signals
"this is meant to be loaded by a Lumencast runtime". The `$schema` URL
gives users a free editor experience without installing anything.

The `.lsml` extension is now the canonical form across all SDKs per
LSML 1.1 §18.1 — no follow-up RFC required.

## Consequences

- The plugin compiles against LSML 1.1 types only. **LSML 1.1 spec is
  published** (`lumencast-protocol/spec/LSML-1.md` v1.1) — Phase 2 is
  unblocked.
- The roundtrip requirement increases the Phase 3 surface (per-primitive
  builders + reconciliation) and pushes the v0.1 release date back ~3
  weeks vs an export-only v0.1.
- Extending the supported Figma feature set later (Boolean variables,
  modes, effects, animations, multi-frame) is additive and goes in v0.2+.
- The `tokens.*` path convention (decision #6) is plugin-internal — no
  spec extension to coordinate. Future ADRs will record any vendor
  extensions (`x-lumencast.*` per LSML §17.1) the plugin needs to
  introduce.
