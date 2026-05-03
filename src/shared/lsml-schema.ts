// Canonical $schema URL constants per LSML §18.4.
//
// The plugin emits LSML 1.1 strict, with $schema set to the canonical
// lumencast.dev URL. Until lumencast.dev hosts the schema bytes, the
// GitHub raw URL is the transport-equivalent fallback used by editors
// for autocomplete / validation.

import { LSML_VERSION } from "./constants";

/**
 * Canonical $schema URL per LSML §18.4. Logical identifier of the schema.
 * This URL is what the plugin writes into `bundle.$schema`.
 */
export const LSML_SCHEMA_URL_CANONICAL =
  `https://lumencast.dev/schema/lsml/${LSML_VERSION}/schema.json` as const;

/**
 * GitHub raw URL pinned to the protocol repo `main` branch — equivalent
 * bytes to the canonical URL while lumencast.dev hosting is being set up.
 * Suitable for the floating-on-main editor experience.
 */
export const LSML_SCHEMA_URL_GITHUB_MAIN =
  "https://raw.githubusercontent.com/Lumencast/lumencast-protocol/main/spec/schema.json" as const;

/**
 * GitHub raw URL pinned to a specific release tag — preferred when the
 * bundle author wants reproducible validation.
 */
export function lsmlSchemaUrlGithubTag(tag: string): string {
  return `https://raw.githubusercontent.com/Lumencast/lumencast-protocol/${tag}/spec/schema.json`;
}

/** Default URL written into produced bundles' `$schema` field. */
export const DEFAULT_SCHEMA_URL = LSML_SCHEMA_URL_CANONICAL;
