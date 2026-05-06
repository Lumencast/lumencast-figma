// One-shot generator for the examples/ directory. Run it manually :
//   pnpm exec vitest run tests/_generate-examples.test.ts
// Then commit the produced bundles. CI does NOT run this file (the
// underscore prefix is conventionally used to skip it in the default glob,
// see vitest.config.ts include).

import { describe, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packArchive } from "@lumencast/archive";
import { runExport } from "../src/export";
import { createMockFigma } from "./fixtures/figma/mock";
import { buildScoreboardFixture } from "./fixtures/figma/scoreboard";
import { buildDashboardFixture } from "./fixtures/figma/dashboard";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function prep(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "assets"), { recursive: true });
}

function writeArchive(
  dir: string,
  sceneId: string,
  canonical: string,
  assets: { name: string; bytes: Uint8Array }[],
): number {
  const zipped = packArchive({
    sceneId,
    canonical,
    assets: assets.map((a) => ({ path: a.name, bytes: a.bytes })),
  });
  writeFileSync(resolve(dir, `${sceneId}.lsmlz`), zipped);
  return zipped.length;
}

describe.skipIf(process.env["GENERATE_EXAMPLES"] !== "1")("examples generator", () => {
  it("scoreboard", async () => {
    const figma = createMockFigma();
    const fixture = buildScoreboardFixture();
    for (const img of fixture.images) figma.__registerImage(img);
    const r = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "scoreboard",
    });
    const dir = resolve(root, "examples/scoreboard");
    prep(dir);
    writeFileSync(resolve(dir, "scoreboard.lsml"), r.canonical, "utf-8");
    for (const a of r.assets) writeFileSync(resolve(dir, a.name), a.bytes);
    const zipBytes = writeArchive(dir, "scoreboard", r.canonical, r.assets);
    console.log(
      `✓ scoreboard : ${r.canonical.length} B canonical, ${r.assets.length} asset(s), ${zipBytes} B .lsmlz, ${r.bundle.scene_version}`,
    );
  });

  it("trading-dashboard", async () => {
    const figma = createMockFigma();
    const fixture = buildDashboardFixture();
    const r = await runExport({
      api: figma,
      root: fixture.root as never,
      sceneId: "trading-dashboard",
      variables: fixture.variables,
    });
    const dir = resolve(root, "examples/trading-dashboard");
    prep(dir);
    writeFileSync(resolve(dir, "trading-dashboard.lsml"), r.canonical, "utf-8");
    for (const a of r.assets) writeFileSync(resolve(dir, a.name), a.bytes);
    const zipBytes = writeArchive(dir, "trading-dashboard", r.canonical, r.assets);
    console.log(
      `✓ trading-dashboard : ${r.canonical.length} B canonical, ${r.assets.length} asset(s), ${zipBytes} B .lsmlz, ${r.bundle.scene_version}`,
    );
  });
});
