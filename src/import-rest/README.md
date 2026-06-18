# `src/import-rest/` — Figma REST import

Pulls a Figma frame over the **REST API** (no plugin sandbox) and runs it through
the **unchanged** `src/mapping` mapper to produce a genuine LSML 1.2 bundle —
full structure + real image bytes. This replaces the toy fixture used by the
SSIM-fidelity harness (ADR ZabCanvas **002 §3.3**, gap #1).

> Not to be confused with `src/import/` — that is the **plugin→Figma** surface
> (in-sandbox). This module is a standalone REST client + adapter.

## Pipeline

```
importFigmaFrame(fileKey, nodeId)
  → client.getNode      GET /v1/files/:key/nodes?ids=:nodeId   (structure)
  → client.getImageFills GET /v1/files/:key/images             (imageRef → CDN URL)
  → adaptNode           REST node tree → main-thread SceneNode shape
  → createRestImageSurface  getImageByHash backed by REST byte downloads
  → buildBundle (src/export)  ← UNCHANGED mapper + gated asset path
```

The **adapter** (`adapter.ts`) normalizes the REST JSON to the shape `src/mapping`
already consumes:

| REST field                                   | Mapper field                                 |
| -------------------------------------------- | -------------------------------------------- |
| `absoluteBoundingBox.{x,y,width,height}`     | `x` / `y` / `width` / `height` (absolute)    |
| `fills[].imageRef`                           | `fills[].imageHash`                          |
| `gradientHandlePositions` (3 pts)            | `gradientTransform` (2×3 affine)             |
| `fillGeometry[].path`                        | `fillGeometry[].data`                        |
| omitted `visible` (= true) / `visible:false` | `visible` (false survives → `visible:false`) |

Positions, sizes, hierarchy and `visible` are preserved **verbatim** — the
source of the structural-diff=0 invariant (RC2).

The image **bytes** are NOT inlined by this module. `createRestImageSurface`
returns a `getImageByHash` surface whose handles download the real bytes via the
client; the export registry's `finalize()` then runs those bytes through the
**existing gated path** — the raster MIME allowlist and the SVG sanitizer
(contract #N). No asset bypasses that gate.

## Token (secret, étage-1)

The REST token is read from **`process.env.FIGMA_REST_TOKEN`** and sent as the
`X-Figma-Token` header. It is a **read-only** token and lives ONLY in the
étage-1 secret file:

```
D:\Documents\Lumencast\.env.figma-rest      # FIGMA_REST_TOKEN=figd_...
```

- **Never** committed (`.env.*` is git-ignored), **never** logged, **never**
  included in an error message (token value is excluded from every thrown error).
- The repo has **no dotenv loader**; the caller sources the file before running.
- The token does not belong on the VPS — the fidelity run is local/live only
  (ADR 002 R2).

## SSRF posture (Bastion R1/R2)

- The API host is pinned to `api.figma.com`; the file key / node id are
  validated against `^[A-Za-z0-9:_.-]+$` (no path escape).
- Image byte downloads are pinned to the Figma CDN host family — a URL from a
  poisoned response that resolves elsewhere is **refused**. No fetch targets an
  arbitrary, caller-influenced host.

## Running the real 817:3 import (local one-shot)

The bundle for the real cover is a **local artefact** — it carries large bitmaps
and is **never committed** (doctrine: do not push test artefacts). To generate it:

```sh
# Bash
set -a; source /d/Documents/Lumencast/.env.figma-rest; set +a
# then, from a TS-aware runner (vitest live test or an app entrypoint):
#   importFigmaFrame("gtCekQzHW0eBqx4ATVRAAw", "817:3")
```

A live, token-gated one-shot lives in `tests/integration/import-rest-live.test.ts`
— it is **skipped** when `FIGMA_REST_TOKEN` is absent (so CI stays mock-only) and
performs the real pull + bundle write when the token is present.
