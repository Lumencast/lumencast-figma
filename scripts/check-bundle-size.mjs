// Enforces the bundle budgets declared in CLAUDE.md.
// Fails CI if dist/main.js or dist/ui.html exceed their budgets.

import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const KB = 1024;

const budgets = [
  { rel: "dist/main.js", maxRawBytes: 150 * KB, gz: false },
  { rel: "dist/ui.html", maxGzBytes: 50 * KB, gz: true },
];

async function checkOne(b) {
  const path = resolve(root, b.rel);
  const buf = await readFile(path);
  const rawBytes = buf.byteLength;
  const gzBytes = b.gz ? gzipSync(buf).byteLength : null;

  const measured = b.gz ? gzBytes : rawBytes;
  const budget = b.gz ? b.maxGzBytes : b.maxRawBytes;
  const label = b.gz ? "gz" : "raw";

  const ok = measured <= budget;
  const status = ok ? "OK" : "OVER";
  const measKB = (measured / KB).toFixed(1);
  const budgetKB = (budget / KB).toFixed(1);
  console.log(`[check:bundle] ${b.rel}  ${label}=${measKB} KB  budget=${budgetKB} KB  ${status}`);
  return ok;
}

async function main() {
  let allOk = true;
  for (const b of budgets) {
    try {
      const ok = await checkOne(b);
      if (!ok) allOk = false;
    } catch {
      console.error(`[check:bundle] ${b.rel}  MISSING — run \`pnpm build\` first`);
      allOk = false;
    }
  }
  if (!allOk) {
    console.error("[check:bundle] FAIL — bundle over budget or missing");
    process.exit(1);
  }
  console.log("[check:bundle] PASS — all bundles within budget");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
