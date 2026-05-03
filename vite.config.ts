import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";
import { renameSync, rmSync, existsSync } from "node:fs";

/** Flatten the UI HTML output : Vite preserves the input's directory structure
 *  (`dist/src/ui/index.html`), but the manifest expects `dist/ui.html`. */
function flattenUiHtml(): Plugin {
  return {
    name: "lumencast-flatten-ui-html",
    apply: "build",
    closeBundle() {
      const nested = resolve(__dirname, "dist/src/ui/index.html");
      const flat = resolve(__dirname, "dist/ui.html");
      if (existsSync(nested)) {
        renameSync(nested, flat);
        rmSync(resolve(__dirname, "dist/src"), { recursive: true, force: true });
      }
    },
  };
}

/**
 * Two build targets, both bundled into `dist/` for the manifest to pick up.
 *
 * - "main" : Figma plugin sandbox code. No DOM, no UI framework.
 *   Single IIFE bundle at `dist/main.js`.
 *
 * - "ui"   : Iframe Preact UI. Single self-contained HTML at `dist/ui.html`
 *   with JS + CSS inlined (Figma loads the UI from one file URL).
 *
 * Selected via BUILD_TARGET env var. `pnpm build` chains both phases.
 */
const target = process.env["BUILD_TARGET"] ?? "main";

const sharedAlias = {
  "~main": resolve(__dirname, "src/main"),
  "~ui": resolve(__dirname, "src/ui"),
  "~mapping": resolve(__dirname, "src/mapping"),
  "~export": resolve(__dirname, "src/export"),
  "~import": resolve(__dirname, "src/import"),
  "~shared": resolve(__dirname, "src/shared"),
};

const mainConfig = defineConfig({
  resolve: { alias: sharedAlias },
  build: {
    // Figma's plugin sandbox runs on a JS engine that does NOT support
    // `??`, `?.`, top-level await, or class fields out of the box —
    // attempting to load a bundle with those tokens fails the manifest
    // parser with "Unexpected token ?" before the plugin ever boots.
    // ES2017 is the safe target ; esbuild down-levels modern syntax.
    target: "es2017",
    lib: {
      entry: resolve(__dirname, "src/main/index.ts"),
      formats: ["iife"],
      name: "lumencastFigmaMain",
      fileName: () => "main.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

const uiConfig = defineConfig({
  resolve: { alias: sharedAlias },
  plugins: [preact(), viteSingleFile(), flattenUiHtml()],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      input: resolve(__dirname, "src/ui/index.html"),
      output: {
        entryFileNames: "ui.js",
        assetFileNames: "ui.[ext]",
      },
    },
  },
});

export default target === "ui" ? uiConfig : mainConfig;
