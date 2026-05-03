// Phase 2 wrap-up : end-to-end test exercising the full advanced surface
// (instance + variables + gradients + wrap + universal props) on a single
// fixture. The bundle MUST validate against the canonical schema.json.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { runExport } from "../../src/export";
import { createMockFigma } from "../fixtures/figma/mock";
import { buildDashboardFixture } from "../fixtures/figma/dashboard";

const SCHEMA_PATH = resolve(__dirname, "../fixtures/lsml-schema.json");
const ADAPTER_NAMES = ["http_poll", "websocket_subscribe", "pg_listen", "webhook_receive", "cron"];

let validateAgainstLsmlSchema: (b: unknown) => boolean;
let ajvErrors: () => string;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const name of ADAPTER_NAMES) {
    ajv.addSchema(
      JSON.parse(readFileSync(resolve(__dirname, `../fixtures/adapters/${name}.json`), "utf-8")),
    );
  }
  const v = ajv.compile(schema);
  validateAgainstLsmlSchema = (b) => v(b) as boolean;
  ajvErrors = () => JSON.stringify(v.errors, null, 2);
});

describe("E2E : Phase 2 dashboard fixture (instance + variables + gradients)", () => {
  it("produces a bundle that validates against schema.json", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const ok = validateAgainstLsmlSchema(result.bundle);
    if (!ok) throw new Error(`Schema validation failed : ${ajvErrors()}`);
    expect(ok).toBe(true);
  });

  it("emits the expected token bindings + defaults", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const layout = result.bundle.layout as { bind?: { background?: string } };
    expect(layout.bind?.background).toBe("tokens.theme.background");

    const defaults = result.bundle.defaults ?? {};
    expect(defaults["tokens.theme.background"]).toBe("#0d0d1a");
    expect(defaults["tokens.theme.accent"]).toBe("#3366ff");
  });

  it("emits the instance primitive with scene_id + scene_version + params", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const json = JSON.stringify(result.bundle);
    expect(json).toContain('"kind":"instance"');
    expect(json).toContain('"scene_id":"scoreboard-template"');
    expect(json).toMatch(/"scene_version":"sha256:f{64}"/);
    expect(json).toContain('"team_a":"Alpha"');
  });

  it("emits stack wrap + crossGap (1.1+) on the auto-layout container", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const stack = (
      result.bundle.layout as { children: { kind: string; wrap?: boolean; crossGap?: number }[] }
    ).children[0];
    expect(stack?.kind).toBe("stack");
    expect(stack?.wrap).toBe(true);
    expect(stack?.crossGap).toBe(12);
  });

  it("emits a multi-fill shape with linear-gradient first + solid overlay", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const hero = (
      result.bundle.layout as { children: { kind: string; fills?: { kind: string }[] }[] }
    ).children[1];
    expect(hero?.kind).toBe("shape");
    expect(hero?.fills).toHaveLength(2);
    expect(hero?.fills?.[0]?.kind).toBe("linear-gradient");
    expect(hero?.fills?.[1]?.kind).toBe("solid");
  });

  it("emits universal `rotation` on the hero shape (§5.4)", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const result = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "dashboard",
      variables: fixture.variables,
    });

    const hero = (result.bundle.layout as { children: { rotation?: number }[] }).children[1];
    expect(hero?.rotation).toBe(2);
  });
});
