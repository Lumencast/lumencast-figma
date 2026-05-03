// JSON Canonicalization Scheme (JCS) per RFC 8785, plus the LSML §3.2
// `scene_version` placeholder protocol.
//
// Local implementation. Sized for the Figma plugin sandbox (no eval, no
// reliance on Intl). When `@lumencast/compiler` ships as an npm artefact
// (open question in HANDOFF.md), this file becomes a thin re-export.
//
// JCS rules :
//   1. UTF-8 encoding (handled by the caller — `TextEncoder`)
//   2. Object keys sorted lexicographically by UTF-16 code-unit value
//   3. No insignificant whitespace
//   4. Numbers serialised per ECMAScript Number.prototype.toString
//   5. Strings escaped per RFC 8785 §3.2.1
//
// The `scene_version` placeholder protocol :
//   1. Set bundle.scene_version to PLACEHOLDER (64 zeros)
//   2. Canonicalize
//   3. sha256 of bytes → "sha256:<hex>"
//   4. Set bundle.scene_version to that hash (the bundle is now sealed)

import { sha256OfText } from "./hash";

export const SCENE_VERSION_PLACEHOLDER =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/** Serialize any JSON-shaped value to its JCS canonical form. */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

/** Compute the LSML 1.1 scene_version of a bundle.
 *  - Non-mutating : the input bundle is left untouched.
 *  - Returns the sealed bundle (with scene_version set) and its canonical
 *    bytes (UTF-8 encoded). */
export async function sealBundle<T extends { scene_version: string }>(
  bundle: T,
): Promise<{ bundle: T; canonical: string; sceneVersion: string }> {
  const placeholderized = { ...bundle, scene_version: SCENE_VERSION_PLACEHOLDER } as T;
  const canonicalForHash = canonicalize(placeholderized);
  const hex = await sha256OfText(canonicalForHash);
  const sceneVersion = `sha256:${hex}`;
  const sealed = { ...bundle, scene_version: sceneVersion } as T;
  // The published bundle is canonicalized again (sealed) ; verifiers reverse
  // the protocol to recompute and compare against `sceneVersion`.
  const canonical = canonicalize(sealed);
  return { bundle: sealed, canonical, sceneVersion };
}

// ---------- internals ----------

function serialize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return jcsNumber(v);
  if (typeof v === "string") return jcsString(v);
  if (Array.isArray(v)) return jcsArray(v);
  if (typeof v === "object") return jcsObject(v as Record<string, unknown>);
  // Functions, symbols, undefined : not valid JSON values. JCS treats them as
  // omitted ; we match JSON.stringify by omitting object props (handled in
  // jcsObject) but throwing for top-level / array entries.
  throw new TypeError(`Cannot canonicalize value of type ${typeof v}`);
}

function jcsArray(arr: unknown[]): string {
  let out = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out += ",";
    out += serialize(arr[i] === undefined ? null : arr[i]);
  }
  return out + "]";
}

function jcsObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  // RFC 8785 §3.2.3 : sort by UTF-16 code unit, which is the default
  // lexicographic order of Array.prototype.sort with string keys.
  keys.sort();
  let out = "{";
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out += ",";
    const k = keys[i] as string;
    out += jcsString(k) + ":" + serialize(obj[k]);
  }
  return out + "}";
}

function jcsNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(`Cannot canonicalize non-finite number ${n}`);
  }
  if (Object.is(n, -0)) return "0";
  // ECMAScript Number.prototype.toString already produces the shortest
  // round-trippable decimal form per the JS spec, which is what RFC 8785
  // §3.2.2 requires for the non-exponential range. JS picks exponential at
  // |n| ≥ 1e21 and < 1e-6 ; LSML values are within the safe band, so this
  // matches RFC 8785 in practice.
  return n.toString();
}

const HEX = "0123456789abcdef";

function jcsString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) {
      out += '\\"';
    } else if (c === 0x5c) {
      out += "\\\\";
    } else if (c === 0x08) {
      out += "\\b";
    } else if (c === 0x09) {
      out += "\\t";
    } else if (c === 0x0a) {
      out += "\\n";
    } else if (c === 0x0c) {
      out += "\\f";
    } else if (c === 0x0d) {
      out += "\\r";
    } else if (c < 0x20) {
      out += "\\u00" + HEX[(c >> 4) & 0xf] + HEX[c & 0xf];
    } else {
      // RFC 8785 §3.2.1 : characters U+0020 and above are emitted literally,
      // including surrogate pairs (which JS strings preserve as-is).
      out += s.charAt(i);
    }
  }
  return out + '"';
}
