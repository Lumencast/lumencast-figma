// Unit: Figma REST client — token sourcing, auth header, SSRF host guards.
// All network is stubbed via an injected fetch ; the suite never calls Figma.

import { describe, it, expect } from "vitest";
import {
  createFigmaRestClient,
  readToken,
  FigmaRestError,
  TOKEN_ENV_VAR,
  type FetchLike,
} from "../../../src/import-rest/client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as Response;
}

describe("readToken", () => {
  it("reads FIGMA_REST_TOKEN from the environment", () => {
    expect(readToken({ [TOKEN_ENV_VAR]: "secret-123" } as NodeJS.ProcessEnv)).toBe("secret-123");
  });

  it("throws a token-free error when absent", () => {
    let msg = "";
    try {
      readToken({} as NodeJS.ProcessEnv);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain(TOKEN_ENV_VAR);
    expect(msg).toContain(".env.figma-rest");
    // never echoes a token-like value (Figma PATs are `figd_...`).
    expect(msg).not.toMatch(/figd_/);
  });
});

describe("createFigmaRestClient — auth + endpoints", () => {
  it("sends the X-Figma-Token header and hits the nodes endpoint", async () => {
    let seenUrl = "";
    let seenToken = "";
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenToken = (init?.headers as Record<string, string>)["X-Figma-Token"] ?? "";
      return jsonResponse({
        nodes: { "1:2": { document: { id: "1:2", name: "n", type: "FRAME" } } },
      });
    };
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    const node = await client.getNode("FILEKEY", "1:2");
    expect(node.id).toBe("1:2");
    expect(seenUrl).toContain("https://api.figma.com/v1/files/FILEKEY/nodes");
    expect(seenUrl).toContain("ids=1%3A2");
    // RC4 — vector outlines are only returned when geometry=paths is requested.
    expect(seenUrl).toContain("geometry=paths");
    expect(seenToken).toBe("tok");
  });

  it("resolves the imageRef → URL map", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: false, meta: { images: { ref1: "https://x.figma.com/a.png" } } });
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    expect(await client.getImageFills("KEY")).toEqual({ ref1: "https://x.figma.com/a.png" });
  });

  it("rejects an invalid file key (path-injection guard)", async () => {
    const client = createFigmaRestClient({ token: "tok", fetchImpl: async () => jsonResponse({}) });
    await expect(client.getNode("../etc", "1:2")).rejects.toBeInstanceOf(FigmaRestError);
  });

  it("surfaces a non-ok API status without leaking the body", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ secretField: "x" }, false, 403);
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    try {
      await client.getNode("KEY", "1:2");
      expect.unreachable();
    } catch (e) {
      const err = e as FigmaRestError;
      expect(err.status).toBe(403);
      expect(err.message).not.toContain("secretField");
      expect(err.message).not.toContain("tok");
    }
  });
});

describe("createFigmaRestClient — SSRF guard on image downloads", () => {
  it("downloads bytes from a Figma CDN host", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({});
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    const bytes = await client.getImageBytes("https://s3-alpha-sig.figma.com/img/a.png");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a download from a non-Figma host (SSRF)", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({});
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    await expect(client.getImageBytes("https://evil.example.com/x.png")).rejects.toBeInstanceOf(
      FigmaRestError,
    );
  });

  it("refuses a non-https image URL", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({});
    const client = createFigmaRestClient({ token: "tok", fetchImpl });
    await expect(
      client.getImageBytes("http://s3-alpha-sig.figma.com/x.png"),
    ).rejects.toBeInstanceOf(FigmaRestError);
  });
});
