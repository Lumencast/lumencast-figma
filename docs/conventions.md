# Conventions

Public conventions used by the plugin to capture intent that Figma alone
cannot express. Changing any of these is a **breaking change** and
requires an ADR + major version bump.

## Layer name conventions

### `[bind:path.to.leaf]` — bind a primitive value to a state path

Rename a Figma layer like this :

```
[bind:show.title] Show Title
[bind:players.0.score] Player 1 Score
[bind:platform.twitch.viewer_count] Viewers
```

The plugin produces an LSML primitive with `bind: { value: "<path>" }`.
Anything after the `]` is preserved as a human-readable label (kept as
the LSML primitive's `label` field).

Path grammar : `[a-zA-Z0-9_.{}]+` — same as the LeafPath grammar in
`lumencast-protocol/spec/LSDP-1.md` § 16. Numeric segments (`players.0`)
are array indices ; `{scope}` segments are scope substitution markers
inside a `repeat`.

If the path is malformed, the layer is exported as a static text/image
with a warning surfaced in the UI.

## `OperatorInput` Figma component

The plugin declares a Figma component named `OperatorInput`. Designers
drop instances of this component into their layout to declare values
that operators can write to at broadcast time.

Each instance carries the following plugin data (under the `lumencast.*`
namespace) :

| Plugin data key              | Type                                    | Required | Notes                                 |
| ---------------------------- | --------------------------------------- | -------- | ------------------------------------- |
| `operator_input.path`        | `string`                                | yes      | MUST start with `__inputs.` (LSML §8) |
| `operator_input.type`        | one of the 9 LSML 1.1 types (see below) | yes      |                                       |
| `operator_input.constraints` | JSON object                             | no       | Type-scoped vocabulary (see below)    |
| `operator_input.label`       | `string`                                | yes      | Operator-facing label                 |
| `operator_input.writable_by` | `string[]`                              | yes      | Subset of `["operator", "service"]`   |
| `operator_input.group`       | `string`                                | no       | Grouping label for operator UI        |

### OperatorInput types (LSML 1.1 §8.1)

| `type`        | Constraint vocabulary                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `"string"`    | `maxLength`, `minLength`, `pattern` (PCRE)                               |
| `"number"`    | `min`, `max`, `step`                                                     |
| `"boolean"`   | none                                                                     |
| `"enum"`      | `values` (non-empty array of strings)                                    |
| `"color"`     | none — value is a CSS color string                                       |
| `"date"`      | `min`, `max` (ISO 8601 date)                                             |
| `"time"`      | `min`, `max` (ISO 8601 time)                                             |
| `"path-ref"`  | none — value MUST be a valid LeafPath                                    |
| `"image-ref"` | none — value MUST be a URL allowed by the bundle's `assets.allowedHosts` |

Unknown constraint keys are a validation error. Servers enforce constraints
on every `input` frame ; violations trigger `INVALID_VALUE`.

At export time, instances are extracted into `bundle.operator_inputs[]`
rather than rendered as primitives. The UI surfaces a panel listing
all detected operator inputs.

## Plugin data namespace

All `setSharedPluginData` / `getSharedPluginData` calls live under the
`lumencast` namespace. Reading or writing under any other namespace is
forbidden.

Standard keys :

- `lumencast.binding.path` — fallback when `[bind:...]` prefix is absent
- `lumencast.operator_input.{path,type,constraints}` — see above
- `lumencast.export.source_hash` — sha256 of the last export of this frame
  (used by the import pipeline for incremental round-trip detection)

## File extension `.lsml`

Bundles are written with the `.lsml` extension per LSML §18.1.
Contents remain JSON content-addressed (canonicalised via JCS RFC 8785
with the `scene_version` placeholder protocol per LSML §3.2).

| Extension    | On export | On import |
| ------------ | --------- | --------- |
| `.lsml`      | written   | accepted  |
| `.lsml.json` | not used  | accepted  |
| `.json`      | not used  | accepted  |

Media type when serving over HTTP : `application/lsml+json` (LSML §18.2).

## `$schema` field

Every bundle written by the plugin includes a top-level `$schema` field
pointing to the canonical LSML 1.1 schema URL :

```json
{
  "$schema": "https://lumencast.dev/schema/lsml/1.1/schema.json",
  "lsml": "1.1",
  ...
}
```

This enables IDE autocomplete and validation for any user opening the
bundle in VS Code, JetBrains IDEs, or any editor with JSON Schema support.

The field is informational only — runtimes ignore it (the version of
record is `lsml`, not the URL). See LSML §18.4.

## Assets

Image fills are :

1. Hashed (sha256) ;
2. Written to a sibling directory `assets/` next to the bundle ;
3. Referenced in the bundle as `assets/<sha256>.<ext>` (relative URL).

The user is responsible for hosting `assets/` on a CDN of their choice.
The plugin makes no network calls.

### `assets.allowedHosts` policy for plugin-emitted bundles

Bundles produced by this plugin reference assets exclusively as relative
paths under `assets/<sha256>.<ext>`. There is no remote URL hostname to
allow at export time, so the bundle is emitted with :

```json
{
  "assets": {
    "allowedHosts": []
  }
}
```

Empty `allowedHosts` is the right policy for content-addressed local
bundles : it tells the consumer _"no remote hosts are authorised — the
asset paths are relative to the bundle directory"_. Once the user uploads
the `assets/` directory to a CDN, they (or a downstream tool like Prism)
rewrite the paths to absolute URLs and add the matching hostname pattern
to `allowedHosts` (LSML §11.1).

The plugin never fills in CDN-specific values — that's the user's
infrastructure decision.

## Synthesised LeafPaths : `__lit.*`

LSML §4.4 / §4.5 require text and image primitives to declare their value
via `bind.<prop>: <LeafPath>`. Static authoring content (a literal string,
a content-addressed asset path) doesn't naturally have a leaf path, so the
plugin **synthesises** one and seeds the resolved value under
`bundle.defaults` :

| Source                              | Synthesised LeafPath               | `defaults` value                        |
| ----------------------------------- | ---------------------------------- | --------------------------------------- |
| Static text (no `[bind:value=...]`) | `__lit.text.<sanitised-figma-id>`  | the node's `characters` string          |
| Image fill (no `[bind:src=...]`)    | `__lit.image.<sanitised-figma-id>` | `assets/<sha256>.<ext>` (relative path) |

**Why a reserved prefix.** `__lit.*` is namespaced like LSML's reserved
`__inputs.*` (§8) and `__params.*` (§4.9.1) — leading double underscore
signals "managed by tooling, do not bind operator inputs here, do not
adapter-write here." Servers and operators MUST treat `__lit.*` as
read-only authoring metadata.

**Sanitisation.** The Figma id (`1:23`, `42:0`) is normalised by replacing
any character outside `[A-Za-z0-9_]` with `_`. So Figma id `3:1` becomes
LeafPath segment `3_1`, yielding `__lit.text.3_1`.

**Round-trip.** Re-importing the bundle restores the literal text via the
defaults entry ; an authoring tool can detect the `__lit.*` prefix and
reconcile the literal directly to the node's `characters` (or recreate
the image fill from the asset reference).

This convention is currently plugin-local. Two upstream issues track its
formalisation in the LSML spec :

- [Lumencast/lumencast-protocol#23](https://github.com/Lumencast/lumencast-protocol/issues/23) —
  clarify image / text static-literal authoring story (allow static
  `src` ? formalise the synthesised-leaf pattern ?)
- [Lumencast/lumencast-protocol#25](https://github.com/Lumencast/lumencast-protocol/issues/25) —
  reserve `__lit.*` leaf-path namespace for tooling-synthesised literals,
  alongside the existing `__inputs.*` and `__params.*` reservations.

Until those issues land, the plugin's behaviour stays as documented
above — bundles validate against the canonical schema and round-trip
cleanly via the §3.2 placeholder protocol.

## Figma variables → `tokens.*` LeafPaths

Phase 2 — **Color / Number / String** Figma variables become LeafPath
bindings under the `tokens.*` namespace, following the LSML §17.0
composition pattern (no spec extension required).

When a Figma paint has a bound color variable :

1. The variable's collection name and variable name are slugified into
   LeafPath segments — `tokens.<group>.<name>`. Example : a variable
   `Primary` in collection `Brand` → `tokens.brand.primary`.
2. The resolved value (CSS color string for COLOR, number for FLOAT,
   string for STRING) is seeded under `bundle.defaults["tokens.brand.primary"]`
   so the bundle paints correctly at first frame.
3. The static value is removed from the LSML primitive and replaced with
   `bind: { fill: "tokens.brand.primary" }` (on shape) or
   `bind: { background: "tokens.theme.surface" }` (on frame).

| Figma source           | LSML emission                              |
| ---------------------- | ------------------------------------------ |
| Shape fill — color var | `bind.fill` + `defaults["tokens.<g>.<n>"]` |
| Frame fill — color var | `bind.background` + matching `defaults`    |

### Slugification rules

| Input                     | LeafPath segment |
| ------------------------- | ---------------- |
| `"Primary"`               | `primary`        |
| `"Brand / Primary"`       | `brand_primary`  |
| `"Show—Title"` (em-dash)  | `show_title`     |
| `"  spaced  "`            | `spaced`         |
| `"---"` (only separators) | `unnamed`        |

### Deferred (v0.2)

- **Boolean variables** — need a runtime convention for boolean LeafPath
  binding semantics (truthy / falsy display behaviour).
- **Variable modes (Light/Dark/...)** — bundle would need to carry the
  mode lookup map ; deferred until LSML's `i18n`-style resolution settles.
- **Text style variables** (fontSize, color on text) — schema currently
  restricts `text.bind` to `{value}` only ; needs the §5.2 `bindStyle`
  story to land in the schema. Tracked in lumencast-protocol#23.

## Things the plugin intentionally does NOT do

- **Animations** — these belong in LSML `animate` blocks, declared in
  Prism (the enrichment layer). Figma animation nodes are dropped with
  a warning.
- **Effects** (drop-shadow, inner-shadow, layer blur) — preserved when
  LSML 1.1 covers them ; otherwise dropped with a warning. Full coverage
  in v0.2.
- **Boolean Figma variables** — deferred to v0.2.
- **Figma variable modes** (Light/Dark) — deferred to v0.2.
- **Multi-frame batch export** — single frame only in v0.1.
- **Network requests** — manifest declares `networkAccess: none`. Period.
