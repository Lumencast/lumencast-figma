// Parse a `.lsml` bundle from raw bytes (or text) → SceneBundle, then
// verify integrity per LSML §3.2 (placeholder protocol). On success the
// caller can trust scene_version exactly matches the canonicalized bytes.

import type { SceneBundle } from "~shared/lsml-types";
import { canonicalize, SCENE_VERSION_PLACEHOLDER } from "../export/canonicalize";
import { sha256OfText } from "../export/hash";
import { validateBundle, type ValidationError } from "../export/validate";

export interface ParseError extends Error {
  code:
    | "INVALID_JSON"
    | "INVALID_LSML"
    | "UNSUPPORTED_LSML_VERSION"
    | "BUNDLE_VALIDATION_FAILED"
    | "SCENE_VERSION_MISMATCH";
  /** When ValidationError fires — list of structural errors. */
  errors?: ValidationError[];
  /** When SCENE_VERSION_MISMATCH fires — claimed vs computed. */
  claimed?: string;
  computed?: string;
}

function fail(code: ParseError["code"], message: string, extra: Partial<ParseError> = {}): never {
  const e = new Error(message) as ParseError;
  e.code = code;
  Object.assign(e, extra);
  throw e;
}

export async function parseBundle(input: string | Uint8Array): Promise<SceneBundle> {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    fail("INVALID_JSON", `.lsml is not valid JSON : ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("INVALID_LSML", "Top-level .lsml must be a JSON object.");
  }

  const bundle = parsed as SceneBundle;
  if (bundle.lsml !== "1.0" && bundle.lsml !== "1.1") {
    fail(
      "UNSUPPORTED_LSML_VERSION",
      `Unknown lsml version "${String(bundle.lsml)}". Supported : 1.0, 1.1.`,
    );
  }
  // The plugin only authors 1.1 — but it MAY import 1.0 bundles for back-compat.

  const v = validateBundle(bundle);
  if (!v.ok) {
    fail(
      "BUNDLE_VALIDATION_FAILED",
      `Bundle failed structural validation (${v.errors.length} issue(s))`,
      {
        errors: v.errors,
      },
    );
  }

  // Verify scene_version via the §3.2 placeholder protocol.
  const claimed = bundle.scene_version;
  const placeholderized = { ...bundle, scene_version: SCENE_VERSION_PLACEHOLDER };
  const canonical = canonicalize(placeholderized);
  const computedHex = await sha256OfText(canonical);
  const computed = `sha256:${computedHex}`;
  if (claimed !== computed) {
    fail(
      "SCENE_VERSION_MISMATCH",
      `scene_version mismatch — bundle claims ${claimed} but recomputed value is ${computed}.`,
      { claimed, computed },
    );
  }

  return bundle;
}
