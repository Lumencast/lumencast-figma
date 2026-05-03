// [bind:path] layer-name parsing.
//
// Convention (LSML §5) :
//   - `[bind:path.to.leaf] Optional Display Name`         → bind on the primitive
//   - `[bindStyle:color=team.color] ...`                  → bindStyle entry
//   - `[bindUniversal:visible=ui.show_panel] ...`         → bindUniversal entry
//
// Multiple directives are concatenated, each in its own `[...]` block at the
// start of the layer name, in any order. Whitespace between blocks is allowed.
// Anything after the last `]` is the human-friendly display name (kept as the
// Figma layer name ; not surfaced in LSML).
//
// The directive grammar is intentionally narrow — paths use the same charset
// as LeafPath (LSDP §16), property names use the bindable-prop charset
// (LSML §5.1).

import type { Bind, BindStyle, BindUniversal } from "~shared/lsml-types";

export interface ParsedBindings {
  bind?: Bind;
  bindStyle?: BindStyle;
  bindUniversal?: BindUniversal;
  /** Layer name with all `[...]` directives stripped. */
  displayName: string;
}

/** Single LeafPath segment charset (LSDP §16 — letters, digits, `_`, `.`, `{}`).
 *  The first character may be a letter, `_`, or `{` (scope substitution head). */
const LEAF_PATH_RE = /^[A-Za-z_{][A-Za-z0-9_.{}-]*$/;

/** Bindable prop name charset (LSML §5.1 §5.2). */
const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Universal prop bindable subset (LSML §5.4). */
const UNIVERSAL_KEYS = new Set(["visible", "opacity", "rotation"]);

const DIRECTIVE_RE = /^\s*\[([^\]]+)\]/;

/** Default propName for `[bind:...]` shorthand (no `=`) per primitive `kind`. */
const DEFAULT_BIND_PROP: Record<string, string> = {
  text: "value",
  image: "src",
  media: "src",
  shape: "value",
  frame: "value",
  stack: "value",
  grid: "value",
  instance: "value",
  repeat: "items",
};

export interface ParseOptions {
  /** Primitive kind, used to resolve the default `bind` prop name (§5.1).
   *  Falls back to `value` when omitted or unknown. */
  primitiveKind?: string;
  /** Optional sink for malformed directives. */
  warn?: (code: string, message: string) => void;
}

export function parseLayerName(name: string, opts: ParseOptions = {}): ParsedBindings {
  const result: ParsedBindings = { displayName: name };
  let rest = name;

  while (true) {
    const m = DIRECTIVE_RE.exec(rest);
    if (!m) break;
    const inner = (m[1] ?? "").trim();
    rest = rest.slice(m[0].length);

    const consumed = consumeDirective(inner, result, opts);
    if (!consumed) {
      // Malformed directive — keep it in the display name, stop further parsing.
      result.displayName = `[${inner}]${rest}`.trim();
      return result;
    }
  }

  result.displayName = rest.trim();
  return result;
}

function consumeDirective(inner: string, out: ParsedBindings, opts: ParseOptions): boolean {
  const colon = inner.indexOf(":");
  if (colon < 0) return false;
  const head = inner.slice(0, colon).trim();
  const body = inner.slice(colon + 1).trim();

  switch (head) {
    case "bind":
      return consumeBind(body, out, opts);
    case "bindStyle":
      return consumeKeyEqPath(body, "bindStyle", out, opts);
    case "bindUniversal":
      return consumeUniversal(body, out, opts);
    default:
      // Unknown directive head — treat as not-a-directive (keep the user's
      // original layer name intact).
      return false;
  }
}

/**
 * `[bind:path]` (shorthand — defaults to the primitive's primary bindable prop)
 * `[bind:prop=path]` (explicit prop)
 */
function consumeBind(body: string, out: ParsedBindings, opts: ParseOptions): boolean {
  const eq = body.indexOf("=");
  let prop: string;
  let path: string;
  if (eq < 0) {
    prop = DEFAULT_BIND_PROP[opts.primitiveKind ?? ""] ?? "value";
    path = body;
  } else {
    prop = body.slice(0, eq).trim();
    path = body.slice(eq + 1).trim();
  }
  if (!PROP_NAME_RE.test(prop)) {
    opts.warn?.("INVALID_BINDING_PROP", `Invalid bind prop name : ${prop}`);
    return false;
  }
  if (!LEAF_PATH_RE.test(path)) {
    opts.warn?.("INVALID_BINDING_PATH", `Invalid LeafPath : ${path}`);
    return false;
  }
  out.bind = { ...(out.bind ?? {}), [prop]: path };
  return true;
}

function consumeKeyEqPath(
  body: string,
  kind: "bindStyle",
  out: ParsedBindings,
  opts: ParseOptions,
): boolean {
  const eq = body.indexOf("=");
  if (eq < 0) {
    opts.warn?.("INVALID_BIND_STYLE", `Expected key=path : ${body}`);
    return false;
  }
  const key = body.slice(0, eq).trim();
  const path = body.slice(eq + 1).trim();
  if (!PROP_NAME_RE.test(key)) {
    opts.warn?.("INVALID_BINDING_PROP", `Invalid ${kind} key : ${key}`);
    return false;
  }
  if (!LEAF_PATH_RE.test(path)) {
    opts.warn?.("INVALID_BINDING_PATH", `Invalid LeafPath : ${path}`);
    return false;
  }
  if (kind === "bindStyle") {
    out.bindStyle = { ...(out.bindStyle ?? {}), [key]: path };
  }
  return true;
}

function consumeUniversal(body: string, out: ParsedBindings, opts: ParseOptions): boolean {
  const eq = body.indexOf("=");
  if (eq < 0) {
    opts.warn?.("INVALID_BIND_UNIVERSAL", `Expected key=path : ${body}`);
    return false;
  }
  const key = body.slice(0, eq).trim();
  const path = body.slice(eq + 1).trim();
  if (!UNIVERSAL_KEYS.has(key)) {
    opts.warn?.(
      "INVALID_BIND_UNIVERSAL_KEY",
      `bindUniversal key must be one of visible|opacity|rotation, got : ${key}`,
    );
    return false;
  }
  if (!LEAF_PATH_RE.test(path)) {
    opts.warn?.("INVALID_BINDING_PATH", `Invalid LeafPath : ${path}`);
    return false;
  }
  out.bindUniversal = {
    ...(out.bindUniversal ?? {}),
    [key as "visible" | "opacity" | "rotation"]: path,
  };
  return true;
}
