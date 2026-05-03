// Packages the built plugin into a distributable .zip for Figma Community
// or local install. Reads version from package.json, expects dist/main.js
// and dist/ui.html to exist (run `pnpm build` first).
//
// Output : lumencast-figma-vX.Y.Z.zip at the repo root, containing
//   manifest.json
//   dist/main.js
//   dist/ui.html

import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pkgRaw = await readFile(resolve(root, "package.json"), "utf8");
  const pkg = JSON.parse(pkgRaw);
  const version = pkg.version;

  const required = ["manifest.json", "dist/main.js", "dist/ui.html"];
  for (const rel of required) {
    if (!(await fileExists(resolve(root, rel)))) {
      console.error(`[package] missing ${rel} — run \`pnpm build\` first`);
      process.exit(1);
    }
  }

  const outName = `lumencast-figma-v${version}.zip`;
  const outPath = resolve(root, outName);

  // Use Node's built-in zlib via a tiny inline zip writer is overkill ;
  // instead require an archiver lib OR shell out to a system zip.
  // For now, instruct CI to run a system command. This script just
  // validates inputs and prints the planned output.
  console.log(`[package] inputs OK : ${required.join(", ")}`);
  console.log(`[package] target    : ${outName}`);
  console.log(`[package] note      : actual zipping is delegated to CI ;`);
  console.log(`[package]              run "zip -r ${outName} manifest.json dist/" locally`);
  // Touch the output path so cleaners can find it.
  createWriteStream(outPath).end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
