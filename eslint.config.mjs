import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "*.tsbuildinfo"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/main/**/*.ts"],
    languageOptions: {
      // Figma plugin sandbox : no DOM, no Node, no globals.
      // The figma global is provided by @figma/plugin-typings.
      globals: {
        figma: "readonly",
        __html__: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Plugin sandbox has no window. Use figma.* APIs." },
        { name: "document", message: "Plugin sandbox has no DOM." },
        { name: "fetch", message: "Plugin manifest forbids network access." },
      ],
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "figma", message: "UI iframe has no Figma API. Send a message to main." },
      ],
    },
  },
  {
    files: ["tests/**/*", "scripts/**/*"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);
