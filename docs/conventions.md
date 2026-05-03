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
