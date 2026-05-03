// End-to-end : map a Figma scoreboard fixture → produce an LSML 1.1 bundle
// → validate against the canonical schema (ajv + draft 2020-12).
//
// Verifies the full Phase 1 pipeline. This is the test that gates the brief's
// acceptance criteria : "exporting a simple scoreboard `.fig` produces a
// `.lsml` that loads in `@lumencast/runtime` and lumencast validate exits 0".
//
// We can't actually mount @lumencast/runtime here (different repo, network
// + node DOM constraints) — instead we use ajv for the schema validation,
// which is the same logic the runtime uses.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { runExport } from "../../src/export";
import { canonicalize, sealBundle, SCENE_VERSION_PLACEHOLDER } from "../../src/export/canonicalize";
import { sha256OfText } from "../../src/export/hash";
import { createMockFigma } from "../fixtures/figma/mock";
import { buildScoreboardFixture } from "../fixtures/figma/scoreboard";

const SCHEMA_PATH = resolve(__dirname, "../fixtures/lsml-schema.json");
const ADAPTER_NAMES = ["http_poll", "websocket_subscribe", "pg_listen", "webhook_receive", "cron"];

let validateAgainstLsmlSchema: (b: unknown) => boolean;
let ajvErrors: () => string;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // The 1.1 schema references the standard adapter schemas at fixed URLs
  // under https://lumencast.dev/schema/lsml/1.0/adapters/<name>.json. Pre-load
  // them under those exact $id values so ajv resolves the $refs.
  for (const name of ADAPTER_NAMES) {
    const adapter = JSON.parse(
      readFileSync(resolve(__dirname, `../fixtures/adapters/${name}.json`), "utf-8"),
    );
    ajv.addSchema(adapter);
  }
  const v = ajv.compile(schema);
  validateAgainstLsmlSchema = (b: unknown) => v(b) as boolean;
  ajvErrors = () => JSON.stringify(v.errors, null, 2);
});

describe("E2E : scoreboard fixture → LSML 1.1 bundle", () => {
  it("produces a bundle that validates against schema.json", async () => {
    const figma = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) figma.__registerImage(img);

    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });

    const ok = validateAgainstLsmlSchema(result.bundle);
    if (!ok) {
      throw new Error(`Bundle failed schema validation : ${ajvErrors()}`);
    }
    expect(ok).toBe(true);
  });

  it("emits the expected high-level shape", async () => {
    const figma = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) figma.__registerImage(img);

    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });

    expect(result.bundle.lsml).toBe("1.1");
    expect(result.bundle.scene_id).toBe("scoreboard");
    expect(result.bundle.scene_version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.bundle.layout.kind).toBe("frame");
    expect(result.bundle.assets?.allowedHosts).toEqual([]);
    expect(result.bundle.operator_inputs).toEqual([
      {
        path: "__inputs.show_title",
        type: "string",
        label: "Show title",
        writable_by: ["operator"],
        constraints: { maxLength: 80 },
      },
    ]);
    // The OperatorInput component's invisible position should NOT have produced
    // a primitive in the layout tree.
    expect(JSON.stringify(result.bundle.layout)).not.toContain("OperatorInput");

    // Static text "Match title" planted under defaults.__lit.text.<id>.
    const defaults = result.bundle.defaults ?? {};
    const litKeys = Object.keys(defaults).filter((k) => k.startsWith("__lit.text."));
    expect(litKeys.length).toBeGreaterThan(0);
    expect(Object.values(defaults)).toContain("Friendly match");
  });

  it("hashes both image assets and references them as assets/<sha256>.png", async () => {
    const figma = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) figma.__registerImage(img);

    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });

    expect(result.assets).toHaveLength(2);
    for (const a of result.assets) {
      expect(a.name).toMatch(/^assets\/[0-9a-f]{64}\.png$/);
    }
    const json = JSON.stringify(result.bundle);
    for (const a of result.assets) {
      expect(json).toContain(a.name);
    }
  });

  it("scene_version verifies via the §3.2 placeholder protocol", async () => {
    const figma = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) figma.__registerImage(img);

    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });
    // Replace scene_version with placeholder, recanonicalise, recompute,
    // compare — exact mirror of LSML §3.2 verification logic.
    const verifyBundle = { ...result.bundle, scene_version: SCENE_VERSION_PLACEHOLDER };
    const verifyCanonical = canonicalize(verifyBundle);
    const expected = `sha256:${await sha256OfText(verifyCanonical)}`;
    expect(result.bundle.scene_version).toBe(expected);
  });

  it("re-export of the same fixture is byte-stable", async () => {
    const make = async () => {
      const figma = createMockFigma();
      const fixture = buildScoreboardFixture();
      for (const img of fixture.images) figma.__registerImage(img);
      const r = await runExport({
        api: figma,
        root: fixture.root as never,
        sceneId: "scoreboard",
      });
      return r.canonical;
    };
    const a = await make();
    const b = await make();
    expect(a).toBe(b);
  });

  // Prevents a regression : the local sealBundle round-trips via canonicalize
  // without altering the bundle other than scene_version.
  it("sealBundle is stable (placeholder → hash → re-canonicalise)", async () => {
    const draft = {
      lsml: "1.1" as const,
      scene_id: "ok",
      scene_version: "sha256:placeholder",
      layout: { kind: "frame", size: { w: 1, h: 1 }, children: [] } as never,
    };
    const r = await sealBundle(draft);
    const a = canonicalize(r.bundle);
    expect(a).toBe(r.canonical);
  });
});
