// Runtime validation of a produced bundle, prior to writing the .lsml.
//
// We run a lightweight structural check inside the plugin sandbox (bundle
// budget is the constraint — full JSON-Schema validation lives in CI tests
// with ajv against `lumencast-protocol/spec/schema.json`).
//
// The checks here are the ones that catch the obvious export bugs early :
//   - required top-level fields present
//   - lsml version, scene_id charset, scene_version pattern
//   - layout has a non-empty `kind` and is one of the known primitives
//   - operator_inputs paths start with `__inputs.`
//   - operator_inputs `type` is one of the 9 LSML 1.1 types
//   - assets.allowedHosts present when the bundle references local assets
//
// The validator returns either { ok: true } or { ok: false, errors: [...] }.
// The export pipeline turns errors into a `BUNDLE_VALIDATION_FAILED` plugin
// error, surfacing them in the UI.

import type { OperatorInputType, SceneBundle } from "~shared/lsml-types";

export interface ValidationError {
  code:
    | "MISSING_FIELD"
    | "INVALID_FIELD"
    | "INVALID_PRIMITIVE"
    | "INVALID_OPERATOR_INPUT"
    | "ASSETS_MISSING_ALLOWED_HOSTS";
  path: string; // JSON pointer-ish path
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

const SCENE_ID_RE = /^[A-Za-z0-9._-]+$/;
const SCENE_VERSION_RE = /^sha256:[0-9a-f]{64}$/;
const KNOWN_KINDS = new Set([
  "stack",
  "grid",
  "frame",
  "text",
  "image",
  "shape",
  "media",
  "repeat",
  "instance",
]);
const VALID_TYPES = new Set<OperatorInputType>([
  "string",
  "number",
  "boolean",
  "enum",
  "color",
  "date",
  "time",
  "path-ref",
  "image-ref",
]);

export function validateBundle(bundle: SceneBundle): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof bundle.lsml !== "string" || (bundle.lsml !== "1.0" && bundle.lsml !== "1.1")) {
    errors.push({ code: "INVALID_FIELD", path: "/lsml", message: "lsml must be 1.0 or 1.1" });
  }
  if (typeof bundle.scene_id !== "string" || bundle.scene_id.length === 0) {
    errors.push({ code: "MISSING_FIELD", path: "/scene_id", message: "scene_id is required" });
  } else if (!SCENE_ID_RE.test(bundle.scene_id)) {
    errors.push({
      code: "INVALID_FIELD",
      path: "/scene_id",
      message: "scene_id must match ^[A-Za-z0-9._-]+$",
    });
  }
  if (typeof bundle.scene_version !== "string" || !SCENE_VERSION_RE.test(bundle.scene_version)) {
    errors.push({
      code: "INVALID_FIELD",
      path: "/scene_version",
      message: 'scene_version must match "sha256:" + 64 lower-hex chars',
    });
  }
  if (!bundle.layout || typeof bundle.layout !== "object") {
    errors.push({ code: "MISSING_FIELD", path: "/layout", message: "layout is required" });
  } else {
    validatePrimitive(bundle.layout as { kind?: string }, "/layout", errors);
  }

  if (Array.isArray(bundle.operator_inputs)) {
    for (let i = 0; i < bundle.operator_inputs.length; i++) {
      const oi = bundle.operator_inputs[i] as { path?: string; type?: string };
      const p = `/operator_inputs/${i}`;
      if (!oi.path || !oi.path.startsWith("__inputs.")) {
        errors.push({
          code: "INVALID_OPERATOR_INPUT",
          path: `${p}/path`,
          message: 'operator_inputs path must start with "__inputs."',
        });
      }
      if (!oi.type || !VALID_TYPES.has(oi.type as OperatorInputType)) {
        errors.push({
          code: "INVALID_OPERATOR_INPUT",
          path: `${p}/type`,
          message: `operator_inputs type must be one of the 9 LSML 1.1 types`,
        });
      }
    }
  }

  // If the bundle references content-hashed assets/, it MUST declare an
  // assets block (with at least allowedHosts, even empty) — that signals to
  // the consumer that asset hosting is part of the bundle's contract
  // (LSML §11.1).
  const usesAssets =
    referencesLocalAssets(bundle.layout as object) ||
    referencesLocalAssets(bundle.defaults as object | undefined);
  if (usesAssets && !bundle.assets?.allowedHosts) {
    errors.push({
      code: "ASSETS_MISSING_ALLOWED_HOSTS",
      path: "/assets/allowedHosts",
      message:
        "Bundle references local assets/ but does not declare assets.allowedHosts (LSML §11.1).",
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePrimitive(
  node: { kind?: string; children?: unknown },
  path: string,
  errors: ValidationError[],
): void {
  if (typeof node.kind !== "string") {
    errors.push({
      code: "INVALID_PRIMITIVE",
      path: `${path}/kind`,
      message: "primitive `kind` is required",
    });
    return;
  }
  // Vendor-prefixed `x-vendor.kind` per LSML §17.1.
  const isVendor = /^x-[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(node.kind);
  if (!isVendor && !KNOWN_KINDS.has(node.kind)) {
    errors.push({
      code: "INVALID_PRIMITIVE",
      path: `${path}/kind`,
      message: `Unknown primitive kind "${node.kind}"`,
    });
  }
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      validatePrimitive(node.children[i] as never, `${path}/children/${i}`, errors);
    }
  }
}

function referencesLocalAssets(node: unknown): boolean {
  if (node === null || node === undefined || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => referencesLocalAssets(n));
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (typeof v === "string" && v.startsWith("assets/")) return true;
    if (v && typeof v === "object" && referencesLocalAssets(v)) return true;
  }
  return false;
}
