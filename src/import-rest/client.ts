// Figma REST API client.
//
// Endpoints used (ADR ZabCanvas 002 §3.3):
//   - structure : GET /v1/files/:key/nodes?ids=:nodeId
//   - image map : GET /v1/files/:key/images          (imageRef → CDN URL)
//   - bytes     : GET <CDN URL>                       (the raster bytes)
//
// Auth — the token is read from `process.env.FIGMA_REST_TOKEN` and sent as the
// `X-Figma-Token` header. The token is a read-only étage-1 secret that lives in
//   D:\Documents\Lumencast\.env.figma-rest
// and is NEVER committed, logged, or echoed in an error message (see README +
// SECURITY). This module reads `process.env` only — the repo has no dotenv
// loader, so the caller (CLI / shell) is responsible for sourcing the file.
//
// SSRF posture (Bastion R1/R2): the file key + node id come from the caller,
// never from network input. The API host is pinned to `api.figma.com`. Image
// byte downloads are pinned to the Figma image CDN host family — an `imageRef`
// URL returned by Figma that resolves to any other host is REFUSED, so a
// compromised/poisoned response cannot redirect a fetch to an attacker host.

import type { RestImagesResponse, RestNode, RestNodesResponse } from "./types";

const FIGMA_API_HOST = "api.figma.com";

/** Allowed hosts for image byte downloads. Figma serves rendered/imageRef
 *  assets from S3-backed CDN hosts under these domains. A URL whose host is not
 *  in this set is refused (no SSRF to an arbitrary host). */
const FIGMA_CDN_HOST_SUFFIXES = [
  ".figma.com",
  ".figma-alpha-api.s3.us-west-2.amazonaws.com",
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
  "s3-alpha-sig.figma.com",
  "s3-alpha.figma.com",
];

const TOKEN_ENV_VAR = "FIGMA_REST_TOKEN";

export class FigmaRestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FigmaRestError";
  }
}

/** Read the REST token from the environment. Throws a token-free error if it
 *  is absent. The token VALUE is never included in any thrown message. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env[TOKEN_ENV_VAR];
  if (typeof token !== "string" || token.trim() === "") {
    throw new FigmaRestError(
      `Missing ${TOKEN_ENV_VAR}. Provide the read-only Figma REST token via the ` +
        `étage-1 secret D:\\Documents\\Lumencast\\.env.figma-rest (never committed/logged).`,
    );
  }
  return token;
}

/** Injectable fetch — defaults to the global `fetch` (Node ≥ 18 / browser).
 *  Tests pass a stub so the suite never touches the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FigmaRestClient {
  /** Pull the document subtree rooted at `nodeId`. */
  getNode(fileKey: string, nodeId: string): Promise<RestNode>;
  /** Resolve every imageRef in the file to its CDN URL. */
  getImageFills(fileKey: string): Promise<Record<string, string>>;
  /** Download the raster bytes for a (host-checked) Figma CDN URL. */
  getImageBytes(url: string): Promise<Uint8Array>;
}

export interface CreateClientOptions {
  token?: string;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}

function assertFigmaApiUrl(url: URL): void {
  if (url.protocol !== "https:" || url.hostname !== FIGMA_API_HOST) {
    throw new FigmaRestError(`Refusing non-Figma API request to host "${url.hostname}".`);
  }
}

function assertFigmaCdnUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new FigmaRestError(`Refusing non-https image download (scheme "${url.protocol}").`);
  }
  const host = url.hostname.toLowerCase();
  const ok = FIGMA_CDN_HOST_SUFFIXES.some(
    (suffix) =>
      host === suffix.replace(/^\./, "") ||
      host.endsWith(suffix.startsWith(".") ? suffix : `.${suffix}`),
  );
  if (!ok) {
    throw new FigmaRestError(
      `Refusing image download from non-Figma host "${host}" (SSRF guard). ` +
        `Only Figma CDN hosts are permitted.`,
    );
  }
}

/** Validate caller-supplied path segments. A file key / node id is interpolated
 *  into the URL path ; reject anything that could escape the path (slashes,
 *  control chars). Figma keys are `[A-Za-z0-9]`, node ids `[0-9:.-]`. */
function safePathSegment(value: string, kind: string): string {
  if (!/^[A-Za-z0-9:_.-]+$/.test(value)) {
    throw new FigmaRestError(`Invalid ${kind} "${value}" (illegal characters).`);
  }
  return value;
}

export function createFigmaRestClient(opts: CreateClientOptions = {}): FigmaRestClient {
  const token = opts.token ?? readToken(opts.env);
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const authHeaders = { "X-Figma-Token": token };

  async function apiGet<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(`https://${FIGMA_API_HOST}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    assertFigmaApiUrl(url);
    const res = await doFetch(url.toString(), { headers: authHeaders });
    if (!res.ok) {
      // Never echo the token or response body verbatim — just the status and
      // the (token-free) path.
      throw new FigmaRestError(`Figma API GET ${path} failed`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    async getNode(fileKey, nodeId) {
      const key = safePathSegment(fileKey, "fileKey");
      const id = safePathSegment(nodeId, "nodeId");
      const body = await apiGet<RestNodesResponse>(`/v1/files/${key}/nodes`, { ids: id });
      const entry = body.nodes?.[id];
      if (!entry?.document) {
        throw new FigmaRestError(`Node "${id}" not present in file "${key}" response.`);
      }
      return entry.document;
    },

    async getImageFills(fileKey) {
      const key = safePathSegment(fileKey, "fileKey");
      const body = await apiGet<RestImagesResponse>(`/v1/files/${key}/images`, {});
      if (body.error || !body.meta?.images) {
        throw new FigmaRestError(`Figma image-fills endpoint returned no map`, body.status);
      }
      return body.meta.images;
    },

    async getImageBytes(url) {
      const parsed = new URL(url);
      assertFigmaCdnUrl(parsed);
      const res = await doFetch(parsed.toString());
      if (!res.ok) {
        throw new FigmaRestError(`Image download failed`, res.status);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

export { TOKEN_ENV_VAR, FIGMA_API_HOST, FIGMA_CDN_HOST_SUFFIXES };
