import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/import/**", "happy-dom"],
      ["tests/unit/ui/**", "happy-dom"],
    ],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/ui/index.tsx"],
    },
  },
  resolve: {
    alias: {
      "~main": resolve(__dirname, "src/main"),
      "~ui": resolve(__dirname, "src/ui"),
      "~mapping": resolve(__dirname, "src/mapping"),
      "~export": resolve(__dirname, "src/export"),
      "~import": resolve(__dirname, "src/import"),
      "~shared": resolve(__dirname, "src/shared"),
    },
  },
});
