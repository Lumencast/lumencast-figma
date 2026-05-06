# ADR 002 — `.lsmlz` archive container as the default export format

- **Status** : Accepted
- **Date** : 2026-05-04
- **Decider** : master conversation (Lumencast)
- **Supersedes** : extends ADR 001 decision #11 (file extension `.lsml`)

## Context

ADR 001 decision #11 established that the bundle is a JSON document with the `.lsml` extension. In practice the plugin emits **two** artefacts on every export — the `.lsml` bundle plus a sibling `assets/` directory of content-hashed images referenced by the bundle's `bind.src`.

The two-artefact form has shipped friction :

- One drag-and-drop in Figma produces N+1 downloads (the `.lsml` plus one per image asset). Browsers gate this behind a "this site is trying to download multiple files" prompt.
- Re-import requires the user to multi-select every file in one go. Easy to forget an asset and end up with a partial scene.
- Email / Slack handoff between designers is awkward — `.lsml` + folder doesn't survive copy-paste, requires a manual zip step.
- Cache / hash audits over a scene span multiple files, complicating provenance.

A single-file artefact removes all four pain points, at the cost of introducing a new container format.

## Decision

The plugin emits a **single `.lsmlz` archive** on export from v0.1.2 onwards. The archive is a standard ZIP carrying the canonical `.lsml` bundle at the root plus an `assets/` directory of content-hashed images.

The `.lsmlz` format is normative and lives upstream in [`lumencast-protocol/spec/LSMLZ-1.md`](https://github.com/Lumencast/lumencast-protocol/blob/main/spec/LSMLZ-1.md) — vendor-neutral and adoptable by any other Lumencast authoring tool.

The plugin's import picker prefers `.lsmlz` (single drag) but stays permissive on the loose `.lsml + assets/` form for backward compatibility and hand-authored bundles.

## Rationale

### Why ZIP and not a custom container

ZIP is universally supported (every OS, every language stdlib, every CDN). A new container format would need its own toolchain — diff tools, viewers, parsers. ZIP gives all of those for free, including the ability to inspect a `.lsmlz` with any unzip utility for debugging.

JSON-with-attachments alternatives (multipart MIME, MIME64-inline data URIs in the bundle) were considered and rejected :

- **Inline data URIs** bloat the canonical bundle bytes, breaking content-addressing reproducibility (asset bytes change → bundle hash changes, even when the layout is structurally identical).
- **Multipart MIME** is awkward outside HTTP transport ; no good Node / browser tooling exists for the file-on-disk case.

ZIP keeps the bundle JSON clean (assets stay external, `bind.src` keeps relative paths) while solving the single-file problem.

### Why a custom extension `.lsmlz` and not `.zip`

`.zip` would lose semantic meaning — the OS file picker / preview would treat the archive as a generic blob instead of a Lumencast scene. `.lsmlz` is short, mnemonic ("LSML zipped"), and natural for editors / pickers that already register `.lsml`.

A `.lsmlz` mis-renamed to `.zip` is still recognised structurally (LSMLZ-1 §2.4 magic-byte sniff), so the rename is a hint-only soft requirement.

### Why DEFLATE level 6

JSON compresses 5–15× (LSML §18.7) ; PNG / JPEG asset entries pay only the DEFLATE container overhead (a few bytes per entry — negligible). Level 6 is fflate's default and a sensible JSON / asset compromise. STORE is also accepted by the LSMLZ spec for archives where space isn't a concern.

### Why `_debug/` reserved prefix

The plugin's `--debug` mode emits the raw Figma node-tree snapshot and the per-primitive mapping trace alongside the bundle. Without a reserved prefix, those would either pollute the loose `assets/` namespace (semantically wrong — they're not assets) or sit at the root (confusing readers about which `*.lsml` is the bundle when two are present).

LSMLZ §3.3 reserves `_debug/` (and any future top-level prefix starting with `_`) for authoring-tool diagnostics. Readers MUST ignore the prefix when consuming the archive for rendering. The plugin only emits `_debug/` when `--debug` is on ; default exports skip it for size / privacy.

### Why upstream the spec rather than keep it plugin-local

Other authoring tools (Sketch, Adobe XD, hand-authored tooling) will face the same two-artefact friction. Standardising the container format upstream means :

- Every Lumencast authoring tool emits the same archive shape.
- Every consumer (Prism, Orion, dev-server, runtime) can read any tool's archive with one library.
- Vendor-neutral `application/lsml+zip` media type for HTTP serving.
- A single conformance suite covers all readers.

This is the same posture as `application/lsml+json` for the bundle JSON — the Lumencast ecosystem benefits from one canonical packaging convention rather than per-tool ad-hoc zips.

## Consequences

- The plugin's UI message changed from "Export to LSML" producing N+1 downloads to "Export to LSML" producing one `.lsmlz` download. Loose `.lsml + assets/` export was kept available behind an advanced toggle initially, then dropped at v0.2 once `.lsmlz` adoption was confirmed.
- A new normative spec document (`LSMLZ-1.md`) lives in the protocol repo. Plugin docs delegate to it instead of restating the format inline.
- A new shared library (`@lumencast/archive`) implements `packArchive` / `unpackArchive` / `isArchive` against the spec. The plugin consumes it from npm — no local zip implementation duplicates the format.
- Round-trip stability is preserved : `.lsmlz` → unzip → re-import via the loose form produces the same scene as `.lsmlz` → import directly. The picker auto-detects via magic bytes.
- The decision is additive over ADR 001 #11 — the `.lsml` JSON format inside the archive is unchanged ; LSMLZ only adds packaging.
- Future authoring profiles emitted by the plugin (currently only `x-figma.authoring/1`) ride inside the bundle's `metadata.<vendor>.*` block and travel transparently inside the archive ; no LSMLZ-level change required.
