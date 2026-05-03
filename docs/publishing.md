# Publishing to the Figma Community

This document captures everything needed to publish `lumencast-figma` on
the [Figma Community plugin store](https://www.figma.com/community/plugins).
The submission itself is a **manual web flow** that the maintainer drives
inside Figma desktop ; this checklist makes sure the metadata, assets,
and policy answers are ready before clicking _Submit_.

## When to submit

After the v0.1.0 release is tagged on GitHub and the release `.zip`
artefact is attached. Don't submit a pre-release — the Figma listing
links to the GitHub repo and Community users expect a stable surface.

Pre-flight :

- [x] Tag `v0.1.0` exists on `Lumencast/lumencast-figma`
- [x] CI green on `main`
- [x] `examples/scoreboard/` and `examples/trading-dashboard/` committed
- [x] `README.md` carries the version badge + CI badge
- [x] `manifest.json` has `name: "Lumencast Export"` and a unique `id`
      placeholder (Figma assigns the real id at first publish ; patch
      `manifest.json` after submission and re-tag)

## Submission flow

1. **Open Figma desktop** → _Plugins → Development → Import plugin from
   manifest..._ → select `manifest.json` from a freshly-cloned copy of
   the repo at the v0.1.0 tag.
2. _Plugins → Manage plugins → Lumencast Export → Publish new..._
3. Figma's submission wizard collects the metadata below ; paste from
   this file as you go.
4. Submit. Approval typically takes 1–3 business days (Figma reviews for
   manifest correctness, network policy, and content guidelines).

## Metadata to paste into the wizard

### Name

```
Lumencast Export
```

(Always two words, capitalised. Don't translate — the brand is preserved
across locales.)

### Tagline (short description, ≤ 100 chars)

```
Export Figma frames to LSML 1.1 broadcast scenes — and back.
```

### Long description (Markdown, ~300–500 words)

```
Lumencast Export turns a Figma frame into a Lumencast Scene Markup
Language (LSML 1.1) bundle — a portable, content-addressed scene format
designed for live-broadcast graphics, scoreboards, conference overlays,
and trading dashboards.

The plugin sits at the leftmost arrow of the Lumencast pipeline:
Figma → LSML → Prism (enrichment) → Orion (LSDP/1.1 broadcast).

What it does
- Export — select a Figma frame, click Export to LSML, get a .lsml file
  plus a sibling assets/ directory of content-hashed images.
- Import — open a .lsml bundle, the plugin rebuilds the node tree
  inside Figma. Round-trip-stable: re-exporting reproduces the input
  byte-for-byte.
- Bind dynamic values via the [bind:path.to.leaf] layer-name convention.
- Declare operator inputs (string, number, boolean, enum, color, date,
  time, path-ref, image-ref) via a single OperatorInput component.
- Resolve Figma color variables to LSML token bindings under tokens.*.

What it doesn't do
- Network requests — manifest declares networkAccess: none, the plugin
  operates entirely on the local Figma document.
- Telemetry — zero analytics, zero error reporting endpoints.
- Animations — those belong in LSML's animate blocks, declared in
  Prism (the enrichment editor), not in Figma.

Open source — Apache 2.0
The full source, test suite, and architecture decisions are public at
github.com/Lumencast/lumencast-figma. 113 tests cover the export
pipeline, import pipeline, and byte-stable round-trip on real fixtures.

Spec
LSML 1.1 specification:
github.com/Lumencast/lumencast-protocol/blob/main/spec/LSML-1.md
```

### Categories

Pick (Figma allows up to 3) :

- **Design tools** — primary
- **Productivity** — secondary
- **Documentation** — tertiary

### Tags

```
lumencast, lsml, broadcast, scoreboard, overlay, scene-export, design-tokens, json
```

### Cover art

| Asset                | Spec               | Source                                                  |
| -------------------- | ------------------ | ------------------------------------------------------- |
| Cover image          | 1920 × 960 px, PNG | Master to design — should show "Figma → .lsml → Server" |
| Snapshot 1 (Export)  | 1280 × 768 px, PNG | Plugin UI mid-export with the scoreboard fixture        |
| Snapshot 2 (Import)  | 1280 × 768 px, PNG | File picker open with `.lsml` + `assets/` selected      |
| Snapshot 3 (Bind UI) | 1280 × 768 px, PNG | Layer panel showing `[bind:show.title] Title`           |
| Demo GIF (optional)  | ≤ 3 MB, < 30 s     | Record the round-trip flow                              |

The cover art lives under `docs/community/` (not committed yet — TBD
when master designs the visuals).

### Support contact

```
Email:    support@lumencast.dev
Source:   https://github.com/Lumencast/lumencast-figma
Issues:   https://github.com/Lumencast/lumencast-figma/issues
Security: https://github.com/Lumencast/lumencast-figma/security/policy
```

(`support@lumencast.dev` is the official Lumencast org address ; CONFIRM
with the maintainer before submission.)

### Privacy / data policy answers

Figma asks three policy questions before publication. The answers are
load-bearing for review and SHOULD NOT change without ADR :

| Question                                       | Answer                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Does the plugin make network requests?         | **No** — manifest declares `networkAccess: { allowedDomains: ["none"] }` |
| Does the plugin collect personal data?         | **No** — zero telemetry, zero analytics                                  |
| Does the plugin share data with third parties? | **No** — the plugin reads / writes only the local Figma document         |

### Permissions

`manifest.json` declares :

```json
{
  "capabilities": [],
  "enableProposedApi": false,
  "documentAccess": "dynamic-page",
  "permissions": ["currentuser"]
}
```

`currentuser` is required for `figma.currentUser` (used to attribute the
exporter's user id in plugin data, surfaced in the bundle's optional
`metadata` block — never sent off-document).

## Post-submission checklist

- [ ] Patch `manifest.json` with the assigned plugin id (Figma assigns it
      on first publish — replace the placeholder string)
- [ ] Tag `v0.1.1` with the manifest patch and re-publish (Figma supports
      re-publishing with new builds without re-reviewing)
- [ ] Update `README.md` § _Quick start_ with the real Community URL
      (`https://www.figma.com/community/plugin/<assigned-id>`)
- [ ] Update `lumencast-org-profile/README.md` with a link to the
      published plugin
- [ ] Open a PR on `lumencast-protocol` adding the plugin to the
      ecosystem index
- [ ] Announce on Lumencast's communication channels (TBD with master)

## If the submission is rejected

Common reasons + fixes :

| Reason                              | Fix                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Network access listed but unused    | Already `["none"]` — should not happen                                         |
| Plugin id missing or duplicate      | Figma assigns the id on submission ; the manifest's placeholder is intentional |
| Cover art doesn't match guidelines  | Re-export at the exact pixel dims listed above                                 |
| Plugin name already taken           | Should not happen — "Lumencast Export" is unique by brand reservation          |
| Fails to load on Figma's review env | Re-build at the v0.1.0 tag, re-zip via `pnpm package`, re-upload               |

Re-submission is free. Address the feedback in a fix branch, tag a patch
release (`v0.1.1` etc.), re-publish.
