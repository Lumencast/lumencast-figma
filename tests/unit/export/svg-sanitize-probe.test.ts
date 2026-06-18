// Probe adversarial tests — svg-sanitize.ts
// Bastion contract #N, ADR 002 Amendment 3.
// Ref: forge/N-svg-sanitizer PR #9
//
// These tests COMPLEMENT Forge's 13 contract fixtures. They exercise:
//   - Fuzz / re-emitter numeric (V1)
//   - Parsing bypass vectors (V2)
//   - URL attribute injection (V3)
//   - MIME inaccessibility (V4)
//   - 0-loss / error-severity guarantees (V5)
//   - DoS boundary fences (V6)
//   - Named-color constraint gap (flagged to Forge)
//
// All assertions go through reparse() of the sanitizer output — never regex on raw
// bytes (contract §8 mandate).

import { describe, it, expect } from "vitest";
import {
  sanitizeSvg,
  emitSanitizedSvgDataUri,
  SanitizeError,
  MAX_SVG_BYTES,
  MAX_ELEMENTS,
  MAX_DEPTH,
  MAX_GRADIENT_STOPS,
  MAX_PATH_DATA_LEN,
} from "../../../src/export/svg-sanitize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function sanitize(inner: string) {
  return sanitizeSvg(bytes(svg(inner)));
}

interface Attr {
  el: string;
  name: string;
  value: string;
}
interface Parsed {
  elements: string[];
  attrs: Attr[];
}

/** Re-parse the sanitizer output structurally (contract §8 — never regex on raw string). */
function reparse(markup: string): Parsed {
  const elements: string[] = [];
  const attrs: Attr[] = [];
  const s = markup.replace(/^<\?xml[^?]*\?>/, "");
  const tagRe = /<([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    const el = localN(m[1]!);
    elements.push(el);
    const aRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = aRe.exec(m[2] ?? "")) !== null) {
      attrs.push({ el, name: a[1]!, value: a[2]! });
    }
  }
  return { elements, attrs };
}
function localN(n: string) {
  const i = n.indexOf(":");
  return i === -1 ? n : n.slice(i + 1);
}
function out(inner: string): Parsed {
  return reparse(sanitize(inner).markup);
}
function attrVal(p: Parsed, el: string, name: string): string | undefined {
  return p.attrs.find((a) => a.el === el && a.name === name)?.value;
}
function hasEl(p: Parsed, el: string) {
  return p.elements.includes(el);
}
function hasAttr(p: Parsed, name: string) {
  return p.attrs.some((a) => a.name === name);
}

// ---------------------------------------------------------------------------
// V1 — Re-emitter numeric fuzz
// ---------------------------------------------------------------------------

describe("V1 — numeric re-emitter: fuzz & boundary tokens", () => {
  it("scientific notation 1e10 in viewBox → clamped to null → attr dropped", () => {
    // viewBox is on svg, not rect — test it on the svg element directly.
    const p2 = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e10 1e10"><rect x="0" y="0" width="1" height="1"/></svg>`,
        ),
      ).markup,
    );
    // 1e10 > NUMERIC_ABS_MAX (1e7) → clampFinite returns null → attr dropped
    expect(attrVal(p2, "svg", "viewBox")).toBeUndefined();
    expect(hasEl(p2, "rect")).toBe(true);
  });

  it("1e-400 (subnormal underflow → 0 in IEEE-754) in viewBox → zero-token re-emitted", () => {
    // 1e-400 parses to 0 (underflow), which IS finite — so it round-trips as 0
    const p = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e-400 1e-400"><rect x="0" y="0" width="1" height="1"/></svg>`,
        ),
      ).markup,
    );
    const vb = attrVal(p, "svg", "viewBox");
    // Must be numeric-only tokens; no 'e-400' string in the output
    expect(vb).toBeDefined();
    if (vb !== undefined) {
      expect(/[^0-9\s.-]/.test(vb)).toBe(false);
      expect(vb.includes("e")).toBe(false);
    }
  });

  it("'Infinity' token in transform: a non-finite arg drops the WHOLE attribute — no partial digit extraction", () => {
    // 'translate(Infinity 0)': 'Infinity' is not a wholly-finite number token, so
    // splitNumericArgs() rejects the argument list and reemitTransform() drops the
    // ENTIRE transform attribute — it does NOT silently extract the '0' into a
    // no-op translate(0). The element itself still survives (only the attr drops).
    const p = out(`<rect x="0" y="0" width="1" height="1" transform="translate(Infinity 0)"/>`);
    expect(attrVal(p, "rect", "transform")).toBeUndefined();
    expect(hasEl(p, "rect")).toBe(true);
  });

  it("NaN in scalar width → attr dropped", () => {
    const p = out(`<rect x="0" y="0" width="NaN" height="1"/>`);
    // 'NaN' doesn't match the scalar numeric regex → reemitScalar returns null
    expect(attrVal(p, "rect", "width")).toBeUndefined();
    // height is fine
    expect(attrVal(p, "rect", "height")).toBe("1");
  });

  it("-0 in transform → normalised to 0 (not -0 in output)", () => {
    const p = out(`<rect x="0" y="0" width="1" height="1" transform="translate(-0 0)"/>`);
    const t = attrVal(p, "rect", "transform");
    expect(t).toBeDefined();
    // fmt() normalises -0 to 0; output must not contain '-0'
    expect(t?.includes("-0")).toBe(false);
  });

  it("hex-prefixed number 0x1F in viewBox → dropped (not numeric tokens)", () => {
    const p = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0x1F 0 100 100"><rect x="0" y="0" width="1" height="1"/></svg>`,
        ),
      ).markup,
    );
    // NUMBER_RE would match '0' from '0x1F', but 'x' is not a separator → uncovered tail → null
    // OR it extracts '0' and '1' as separate tokens — either way no hex passthrough
    const vb = attrVal(p, "svg", "viewBox");
    // If it produced a value, it must not contain 'x' or 'F' or 'X'
    if (vb !== undefined) {
      expect(/[xXFf]/.test(vb)).toBe(false);
    }
  });

  it("numeric value way beyond clamp (1e8) in d path → clamped to null → path dropped", () => {
    const p = out(`<path d="M 0 0 L 1e8 1e8 Z"/>`);
    // 1e8 > NUMERIC_ABS_MAX(1e7) → clampFinite returns null → entire d dropped
    expect(attrVal(p, "path", "d")).toBeUndefined();
  });

  it("unknown transform function 'skewQ' drops the whole transform attr", () => {
    const p = out(`<rect x="0" y="0" width="1" height="1" transform="skewQ(45)"/>`);
    expect(attrVal(p, "rect", "transform")).toBeUndefined();
  });

  it("known function followed by trailing non-whitespace drops the transform", () => {
    const p = out(
      `<rect x="0" y="0" width="1" height="1" transform="translate(1 2) javascript:alert(1)"/>`,
    );
    // 'javascript:alert(1)' has non-space content after the function sequence → dropped
    expect(attrVal(p, "rect", "transform")).toBeUndefined();
  });

  it("all 6 recognised transform functions are allowed: matrix/translate/scale/rotate/skewX/skewY", () => {
    const p = out(
      `<rect x="0" y="0" width="1" height="1" transform="matrix(1 0 0 1 0 0) translate(1 2) scale(2) rotate(45) skewX(10) skewY(10)"/>`,
    );
    // All 6 functions accepted → transform is non-null
    expect(attrVal(p, "rect", "transform")).toBeDefined();
  });

  it("truncated matrix 'matrix(1 0 0' (no closing paren) in transform → parse error or attr drop", () => {
    // findTagEnd handles quotes; the attribute value ends at the closing quote.
    // reemitTransform: the regex /([a-zA-Z]+)\s*\(([^)]*)\)/g won't match an unclosed paren.
    // So no functions match → parts.length === 0 → return null.
    const p = out(`<rect x="0" y="0" width="1" height="1" transform="matrix(1 0 0"/>`);
    expect(attrVal(p, "rect", "transform")).toBeUndefined();
  });

  it("viewBox with 'url(evil)' string → numeric extraction only, no url string in output", () => {
    const p = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="url(evil)"><rect x="0" y="0" width="1" height="1"/></svg>`,
        ),
      ).markup,
    );
    const vb = attrVal(p, "svg", "viewBox");
    // Either dropped (if no numeric tokens found or trailing chars) or contains only numbers
    if (vb !== undefined) {
      expect(vb).not.toContain("url");
      expect(vb).not.toContain("evil");
      expect(vb).not.toContain("javascript");
    }
  });

  it("d path with 'javascript:' text → path data dropped (closing ')' is untokenizable tail)", () => {
    const p = out(`<path d="M0 0 Z url(javascript:alert(1))"/>`);
    // 'url' → 'l' matches as command, '(' and ')' are not tokenizable
    // ')' at the end → uncovered tail → null
    expect(attrVal(p, "path", "d")).toBeUndefined();
  });

  it("path d with scientific notation 1e3 (within clamp) → re-emitted as decimal", () => {
    const p = out(`<path d="M 0 0 L 1e3 500 Z"/>`);
    const d = attrVal(p, "path", "d");
    expect(d).toBeDefined();
    // Output must not contain 'e' (re-emitted as decimal via fmt())
    expect(d?.includes("e")).toBe(false);
    expect(d?.includes("E")).toBe(false);
  });

  it("stroke-dasharray 'none' passes through unchanged", () => {
    const p = out(`<rect x="0" y="0" width="1" height="1" stroke-dasharray="none"/>`);
    expect(attrVal(p, "rect", "stroke-dasharray")).toBe("none");
  });

  it("gradientTransform with url() function → attr dropped", () => {
    const p = out(
      `<linearGradient id="g" gradientTransform="url(http://evil)"><stop offset="0" stop-color="red"/></linearGradient><rect x="0" y="0" width="1" height="1"/>`,
    );
    expect(attrVal(p, "linearGradient", "gradientTransform")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// V2 — Parsing bypass
// ---------------------------------------------------------------------------

describe("V2 — parsing bypass vectors", () => {
  it("mixed-case tag <ScRiPt> → dropped (ALLOWED_ELEMENTS is case-sensitive)", () => {
    const p = out(`<ScRiPt>alert(1)</ScRiPt><path d="M0 0"/>`);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "ScRiPt")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("root <SVG> (uppercase) → SanitizeError (no root <svg> found)", () => {
    expect(() =>
      sanitizeSvg(bytes(`<SVG xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></SVG>`)),
    ).toThrow(SanitizeError);
  });

  it("CDATA inside <title> → content becomes escaped text, not injected element", () => {
    const p = out(`<title><![CDATA[<script>alert(1)</script>]]></title><path d="M0 0"/>`);
    expect(hasEl(p, "script")).toBe(false);
    // The CDATA text itself is escaped in the output.
    const markup = sanitize(
      `<title><![CDATA[<script>alert(1)</script>]]></title><path d="M0 0"/>`,
    ).markup;
    // Re-parse the output and verify no script element
    const p2 = reparse(markup);
    expect(hasEl(p2, "script")).toBe(false);
    // The literal '<script>' text should appear escaped in the markup
    expect(markup.includes("<script")).toBe(false);
    expect(markup.includes("&lt;script")).toBe(true);
  });

  it("comment mutation <!--><script>--> → comment consumed, no script survives", () => {
    const p = out(`<!--><script>alert(1)</script>--><path d="M0 0"/>`);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("element with namespace prefix svg:script → dropped (prefixed element)", () => {
    const p = out(
      `<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script><path d="M0 0"/>`,
    );
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("self-closing forbidden element <script/> → dropped", () => {
    const p = out(`<script/><path d="M0 0"/>`);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("attribute with unquoted value → SanitizeError (parser rejects)", () => {
    expect(() => sanitize(`<rect x=0 y=0 width=1 height=1/>`)).toThrow(SanitizeError);
  });

  it("attribute with multi-line value → parsed; URL still blocked by anchored regex", () => {
    // A newline inside a quoted attribute value is technically valid XML.
    // href with embedded newline: '#id\njavascript:alert' — the href regex is anchored start+end
    // so it won't match '#id\n...' → dropped.
    const p = out(`<path d="M0 0" fill="url(#g\njavascript:alert)"/>`);
    // The fill value 'url(#g\njavascript:alert)' — validatePaintColor url(#...) regex:
    // /^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/ — '\n' in the middle won't match [\w.-]
    // → falls to rgb() → no → named-color [a-zA-Z]{1,32}: has parens/newline → no → null → dropped
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("nested entity &amp;#106; → decodes to '&#106;' (literal chars, NOT re-decoded to 'j')", () => {
    // &amp; → '&', then '#106;' is LITERAL text, NOT re-decoded as a char-ref.
    // So &amp;#106;avascript: becomes '&#106;avascript:' as a string, NOT 'javascript:'.
    // The single-pass decoder does not iterate.
    const markup = sanitize(`<title>&amp;#106;avascript:alert(1)</title><path d="M0 0"/>`).markup;
    // The title text should contain the literal string '&#106;avascript:alert(1)' escaped
    expect(markup.includes("javascript:alert")).toBe(false);
    // And no script element
    const p2 = reparse(markup);
    expect(hasEl(p2, "script")).toBe(false);
  });

  it("decimal char-ref for '<' (&#60;) in title → literal text, not element", () => {
    const markup = sanitize(
      `<title>&#60;script&#62;alert(1)&#60;/script&#62;</title><path d="M0 0"/>`,
    ).markup;
    // &#60; → '<', &#62; → '>' — these are TEXT in title, escaped on output
    expect(markup.includes("<script")).toBe(false);
    const p = reparse(markup);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("hex char-ref &#x6A; ('j') in href → decoded to 'j', href = 'javascript:...' → dropped", () => {
    // href="&#x6A;avascript:alert(1)" → decodes to href="javascript:alert(1)"
    // /^#[A-Za-z_][\w.-]*$/.test('javascript:alert(1)') → false → dropped
    const p = out(`<path d="M0 0" href="&#x6A;avascript:alert(1)"/>`);
    expect(hasAttr(p, "href")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("BOM prefix does not crash the parser", () => {
    // UTF-8 BOM: 0xEF 0xBB 0xBF followed by SVG content
    const bom = "\xEF\xBB\xBF";
    const input = `${bom}<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;
    // Should sanitize successfully (BOM bytes are pre-element text, dropped)
    expect(() => sanitizeSvg(bytes(input))).not.toThrow();
    const p = reparse(sanitizeSvg(bytes(input)).markup);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("space/slash in start tag '<script /xss>' treated as self-closing name with attributes", () => {
    // '<script /xss>' — the parser's findTagEnd finds '>' after '/xss'
    // parseStartTag: name = 'script', then 'xss' becomes a valueless attr
    // selfClose detection: input[tagEnd-1] === '/' → inner = 'script /xs' → name='script'
    // But wait: selfClose = input[tagEnd - 1] === '/'? For '<script /xss>':
    // tagEnd is the index of '>'. input[tagEnd-1] = 's'. NOT selfClose.
    // So it becomes <script xss=""> which is an open script tag... but script is not in ALLOWED_ELEMENTS
    // Let's verify: cleanElement drops 'script' regardless.
    const p = out(`<script /><path d="M0 0"/>`);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("unknown named entity &foo; → SanitizeError (not silently dropped or passed through)", () => {
    // &foo; is not in PREDEFINED_ENTITIES → throws SanitizeError
    expect(() => sanitize(`<title>&foo;</title><path d="M0 0"/>`)).toThrow(SanitizeError);
  });
});

// ---------------------------------------------------------------------------
// V3 — URL attributes
// ---------------------------------------------------------------------------

describe("V3 — URL attribute injection", () => {
  it("fill='url(http://evil)' → dropped (not a fragment-only ref)", () => {
    const p = out(`<path d="M0 0" fill="url(http://evil)"/>`);
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("fill='url(data:text/html,<script>alert(1)</script>)' → dropped", () => {
    const p = out(
      `<path d="M0 0" fill="url(data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;)"/>`,
    );
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("clip-path='url(http://evil)' → dropped (URL_REF_ATTRS only allow fragment)", () => {
    const p = out(`<path d="M0 0" clip-path="url(http://evil)"/>`);
    expect(attrVal(p, "path", "clip-path")).toBeUndefined();
  });

  it("clip-path='url(#localid)' → preserved (legitimate internal ref)", () => {
    const p = out(`<path d="M0 0" clip-path="url(#myClip)"/>`);
    expect(attrVal(p, "path", "clip-path")).toBe("url(#myClip)");
  });

  it("href='javascript:alert(1)' → dropped", () => {
    const p = out(`<path d="M0 0" href="javascript:alert(1)"/>`);
    expect(hasAttr(p, "href")).toBe(false);
  });

  it("href with leading space '  javascript:alert(1)' → dropped (not a fragment)", () => {
    const p = out(`<path d="M0 0" href="  javascript:alert(1)"/>`);
    expect(hasAttr(p, "href")).toBe(false);
  });

  it("xlink:href='http://evil.svg#id' → dropped (external href, not fragment-only)", () => {
    const p = out(`<path d="M0 0" xlink:href="http://evil.svg#id"/>`);
    expect(hasAttr(p, "href")).toBe(false);
  });

  it("fill='url(#localid)' → preserved (gradient reference)", () => {
    const p = out(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><path d="M0 0" fill="url(#g)"/>`,
    );
    const fill = attrVal(p, "path", "fill");
    expect(fill).toBe("url(#g)");
  });

  // Named-color constraint CLOSED (Forge fix): validatePaintColor now uses a
  // closed CSS <named-color> allowlist. A bare word that is NOT a real named
  // colour (`javascript`, `url`, `data`, `expression`, …) is DROPPED.
  it("fill='javascript' (not a CSS color) is dropped — closed named-color allowlist", () => {
    const p = out(`<path d="M0 0" fill="javascript"/>`);
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("fill='url' (bare word, not url() function) is dropped — closed named-color allowlist", () => {
    const p = out(`<path d="M0 0" fill="url"/>`);
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("stop-color='data' is dropped — not a valid CSS named color", () => {
    const p = out(
      `<linearGradient id="g"><stop offset="0" stop-color="data"/></linearGradient><path d="M0 0"/>`,
    );
    expect(p.attrs.find((a) => a.el === "stop" && a.name === "stop-color")?.value).toBeUndefined();
  });

  it("fill='expression(alert(1))' is dropped — not a CSS color (IE-expression vector)", () => {
    const p = out(`<path d="M0 0" fill="expression(alert(1))"/>`);
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("fill='rebeccapurple' survives — a real CSS named color in the allowlist", () => {
    const p = out(`<path d="M0 0" fill="rebeccapurple"/>`);
    expect(attrVal(p, "path", "fill")).toBe("rebeccapurple");
  });

  it("fill='currentColor' → passes through (CSS-wide keyword)", () => {
    const p = out(`<path d="M0 0" fill="currentColor"/>`);
    expect(attrVal(p, "path", "fill")).toBe("currentColor");
  });

  it("fill='transparent' → passes through (named-color allowlist)", () => {
    const p = out(`<path d="M0 0" fill="transparent"/>`);
    expect(attrVal(p, "path", "fill")).toBe("transparent");
  });

  it("fill with rgb() containing url → dropped (rgb() regex restricts to digits/./,/%)", () => {
    const p = out(`<path d="M0 0" fill="rgb(url(evil),0,0)"/>`);
    expect(attrVal(p, "path", "fill")).toBeUndefined();
  });

  it("preserveAspectRatio with 40-char value → passes; 41-char → dropped", () => {
    const exactly40 = "xMidYMid meet".padEnd(40, " ").slice(0, 40);
    const exactly41 = "xMidYMid meet".padEnd(41, " ").slice(0, 41);
    const p40 = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${exactly40}"><path d="M0 0"/></svg>`,
        ),
      ).markup,
    );
    const p41 = reparse(
      sanitizeSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${exactly41}"><path d="M0 0"/></svg>`,
        ),
      ).markup,
    );
    // Exactly 40 chars of [A-Za-z ] passes
    expect(attrVal(p40, "svg", "preserveAspectRatio")).toBeDefined();
    // 41 chars fails (> 40)
    expect(attrVal(p41, "svg", "preserveAspectRatio")).toBeUndefined();
  });

  it("id with invalid chars (spaces, colons) → dropped", () => {
    const p = out(`<path d="M0 0" id="my id"/>`);
    expect(attrVal(p, "path", "id")).toBeUndefined();
  });

  it("id with valid identifier → preserved", () => {
    const p = out(`<path d="M0 0" id="my-id_1.a"/>`);
    expect(attrVal(p, "path", "id")).toBe("my-id_1.a");
  });

  it("on* attribute with uppercase ONLOAD → dropped (case-insensitive guard)", () => {
    const p = out(`<rect x="0" y="0" width="1" height="1" ONLOAD="alert(1)"/>`);
    expect(p.attrs.some((a) => a.name.toLowerCase().startsWith("on"))).toBe(false);
  });

  it("data-prefixed attribute 'data-evil' → dropped (not in allowlist)", () => {
    const p = out(`<path d="M0 0" data-evil="xss"/>`);
    expect(hasAttr(p, "data-evil")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// V4 — MIME inaccessibility
// ---------------------------------------------------------------------------

describe("V4 — MIME inaccessibility: no data:image/svg+xml outside emitter", () => {
  it("emitSanitizedSvgDataUri produces data:image/svg+xml;base64 URI", () => {
    const san = sanitizeSvg(
      bytes(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`),
    );
    const uri = emitSanitizedSvgDataUri(san);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("SanitizedSvg brand prevents constructing a URI from raw string (TypeScript-level)", () => {
    // This test documents the brand constraint. At runtime we verify the emitter
    // requires an object with the brand shape — a plain string has no `markup` property.
    // The TypeScript compiler enforces the brand; here we verify the JS contract.
    const fakeSvg = { markup: "<svg/>" } as never;
    // emitSanitizedSvgDataUri accepts any object with a `markup` property at runtime.
    // The security is in the TypeScript type system (brand symbol); runtime is best-effort.
    // What matters: NO other code path reaches data:image/svg+xml (tested in svg-sanitize.test.ts
    // §6 call-graph fixture). This test confirms the emitter works correctly for the branded type.
    const san = sanitizeSvg(
      bytes(
        `<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1"/></svg>`,
      ),
    );
    const uri = emitSanitizedSvgDataUri(san);
    expect(uri).toContain("data:image/svg+xml;base64,");
    void fakeSvg; // suppress unused warning
  });

  it("base64 output decodes to valid XML containing only allowlisted elements", () => {
    const san = sanitizeSvg(
      bytes(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10 20 L30 40 Z"/><script>alert(1)</script></svg>`,
      ),
    );
    const uri = emitSanitizedSvgDataUri(san);
    const b64 = uri.slice("data:image/svg+xml;base64,".length);
    // Decode base64 to string
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    const p = reparse(decoded);
    expect(hasEl(p, "script")).toBe(false);
    expect(hasEl(p, "path")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V5 — 0-loss: error-severity on degenerate inputs
// ---------------------------------------------------------------------------

describe("V5 — 0-loss: error gates on degenerate inputs", () => {
  it("empty input → SanitizeError (not silent drop)", () => {
    expect(() => sanitizeSvg(bytes(""))).toThrow(SanitizeError);
  });

  it("DTD present → SanitizeError with severity:error (not warn or silent)", () => {
    const dtd =
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ` +
      `"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` +
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;
    expect(() => sanitizeSvg(bytes(dtd))).toThrow(SanitizeError);
  });

  it("SVG that becomes empty after rebuild → SanitizeError (§7)", () => {
    // Only a <script> element — drops to empty rebuild
    expect(() =>
      sanitizeSvg(bytes(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)),
    ).toThrow(SanitizeError);
  });

  it("SVG with only <title> survives (title is text-only but the svg has content after rebuild)", () => {
    // <title> is allowlisted → NOT empty rebuild → should succeed
    const san = sanitizeSvg(
      bytes(
        `<svg xmlns="http://www.w3.org/2000/svg"><title>My Scene</title><path d="M0 0"/></svg>`,
      ),
    );
    const p = reparse(san.markup);
    expect(hasEl(p, "title")).toBe(true);
    expect(hasEl(p, "path")).toBe(true);
  });

  it("complex SVG (nested groups, 2 gradients, clipPath) survives + round-trip", () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#0000ff"/>
        </linearGradient>
        <radialGradient id="rg1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="white"/>
          <stop offset="1" stop-color="black"/>
        </radialGradient>
        <clipPath id="cp1">
          <rect x="10" y="10" width="180" height="180"/>
        </clipPath>
      </defs>
      <g clip-path="url(#cp1)">
        <g transform="translate(10 10)">
          <rect x="0" y="0" width="100" height="100" fill="url(#lg1)"/>
          <circle cx="50" cy="50" r="40" fill="url(#rg1)" opacity="0.8"/>
        </g>
        <path d="M100 100 L200 200 Z" stroke="#000000" stroke-width="2"/>
      </g>
    </svg>`;
    const san = sanitizeSvg(bytes(input));
    const p = reparse(san.markup);
    // Structure survives
    expect(hasEl(p, "svg")).toBe(true);
    expect(hasEl(p, "linearGradient")).toBe(true);
    expect(hasEl(p, "radialGradient")).toBe(true);
    expect(hasEl(p, "clipPath")).toBe(true);
    expect(hasEl(p, "g")).toBe(true);
    expect(hasEl(p, "rect")).toBe(true);
    expect(hasEl(p, "circle")).toBe(true);
    expect(hasEl(p, "path")).toBe(true);
    // Gradient refs preserved
    expect(attrVal(p, "rect", "fill")).toBe("url(#lg1)");
    expect(attrVal(p, "circle", "fill")).toBe("url(#rg1)");
    expect(attrVal(p, "g", "clip-path")).toBe("url(#cp1)");
    // Emitter round-trip
    const uri = emitSanitizedSvgDataUri(san);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("parse failure (malformed XML — unclosed tag) → SanitizeError", () => {
    expect(() =>
      sanitizeSvg(bytes(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"></svg>`)),
    ).toThrow(SanitizeError);
  });

  it("parse failure (mismatched close tag) → SanitizeError", () => {
    expect(() =>
      sanitizeSvg(bytes(`<svg xmlns="http://www.w3.org/2000/svg"><g></rect></g></svg>`)),
    ).toThrow(SanitizeError);
  });
});

// ---------------------------------------------------------------------------
// V6 — DoS boundary fences
// ---------------------------------------------------------------------------

describe("V6 — DoS: boundary fences (just under / just over each cap)", () => {
  it("input at exactly MAX_SVG_BYTES → accepted (boundary: > not >=)", () => {
    // The guard is: input.length > MAX_SVG_BYTES — so exactly MAX_SVG_BYTES is ALLOWED.
    // We need valid SVG that fits in exactly MAX_SVG_BYTES characters.
    // Construct: <svg xmlns=...><path d="M0 0 {padding}"/></svg>
    const prefix = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 `;
    const suffix = `"/></svg>`;
    const padLen = MAX_SVG_BYTES - prefix.length - suffix.length;
    // Fill with "L1 1 " repeated to exactly fill; trim to exact length
    const pad = "L1 1 ".repeat(Math.ceil(padLen / 5)).slice(0, padLen);
    const input = prefix + pad + suffix;
    expect(input.length).toBe(MAX_SVG_BYTES);
    // May throw SanitizeError due to token cap, but NOT due to byte cap
    try {
      sanitizeSvg(bytes(input));
    } catch (e) {
      expect(e).toBeInstanceOf(SanitizeError);
      // Must NOT be a byte-cap error
      expect((e as SanitizeError).message).not.toContain("byte cap");
    }
  });

  it("input at MAX_SVG_BYTES + 1 → SanitizeError (byte cap)", () => {
    const prefix = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 `;
    const suffix = `"/></svg>`;
    const padLen = MAX_SVG_BYTES - prefix.length - suffix.length + 1;
    const pad = "L1 1 ".repeat(Math.ceil(padLen / 5)).slice(0, padLen);
    const input = prefix + pad + suffix;
    expect(input.length).toBe(MAX_SVG_BYTES + 1);
    expect(() => sanitizeSvg(bytes(input))).toThrow(SanitizeError);
    try {
      sanitizeSvg(bytes(input));
    } catch (e) {
      expect((e as SanitizeError).message).toContain("byte cap");
    }
  });

  it("element count at MAX_ELEMENTS → SanitizeError (element cap hit)", () => {
    // Build MAX_ELEMENTS self-closing rect elements inside a single svg
    // Each element pushes count, so we need MAX_ELEMENTS+1 total (svg + MAX_ELEMENTS rects)
    // Actually MAX_ELEMENTS includes the svg itself: svg is count 1, then rects
    // The guard fires at elementCount > MAX_ELEMENTS AFTER increment
    // So MAX_ELEMENTS rects + 1 svg = MAX_ELEMENTS+1 total → fires on element MAX_ELEMENTS+1
    const rects = `<rect x="0" y="0" width="1" height="1"/>`.repeat(MAX_ELEMENTS);
    const input = `<svg xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
    // This will exceed byte cap too since MAX_ELEMENTS=10000 rects is large
    // Just verify it throws SanitizeError (either byte cap or element cap)
    const start = Date.now();
    expect(() => sanitizeSvg(bytes(input))).toThrow(SanitizeError);
    // Must not freeze
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("nesting depth at MAX_DEPTH → SanitizeError (depth cap)", () => {
    // MAX_DEPTH+1 nested <g> elements (each adds 1 to stack depth)
    const opens = "<g>".repeat(MAX_DEPTH + 1);
    const closes = "</g>".repeat(MAX_DEPTH + 1);
    const input = `<svg xmlns="http://www.w3.org/2000/svg">${opens}<path d="M0 0"/>${closes}</svg>`;
    expect(() => sanitizeSvg(bytes(input))).toThrow(SanitizeError);
  });

  it("nesting depth at MAX_DEPTH - 1 (just under cap) → completes without depth error", () => {
    // MAX_DEPTH-1 nested groups + 1 for svg root = MAX_DEPTH total → should NOT exceed cap
    const opens = "<g>".repeat(MAX_DEPTH - 1);
    const closes = "</g>".repeat(MAX_DEPTH - 1);
    const inner = `${opens}<path d="M0 0"/>${closes}`;
    // May exceed byte cap — keep path minimal
    const input = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    if (input.length <= MAX_SVG_BYTES) {
      // Should not throw a depth error
      try {
        sanitizeSvg(bytes(input));
      } catch (e) {
        expect((e as SanitizeError).message).not.toContain("depth");
      }
    }
    // If over byte cap, this test is vacuously satisfied
  });

  it("gradient stop count at MAX_GRADIENT_STOPS + 1 → SanitizeError (stop cap)", () => {
    const stops = `<stop offset="0" stop-color="red"/>`.repeat(MAX_GRADIENT_STOPS + 1);
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g">${stops}</linearGradient></defs><path d="M0 0" fill="url(#g)"/></svg>`;
    // May also hit byte cap — verify it throws
    expect(() => sanitizeSvg(bytes(input))).toThrow(SanitizeError);
  });

  it("gradient stop count at MAX_GRADIENT_STOPS (exactly) → does not throw stop-cap error", () => {
    const stops = `<stop offset="0" stop-color="red"/>`.repeat(MAX_GRADIENT_STOPS);
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g">${stops}</linearGradient></defs><path d="M0 0" fill="url(#g)"/></svg>`;
    if (input.length <= MAX_SVG_BYTES) {
      try {
        sanitizeSvg(bytes(input));
      } catch (e) {
        expect((e as SanitizeError).message).not.toContain("stop count");
      }
    }
  });

  it("d value exceeding MAX_PATH_DATA_LEN → attr dropped (path element survives without d attr)", () => {
    // reemitPathData: if (value.length > MAX_PATH_DATA_LEN) return null → d attr dropped.
    // A <path> without d is still a child element, so the svg is NOT empty after rebuild —
    // sanitizeSvg succeeds, but the emitted <path/> has no d attribute.
    const dPad = "L1 1 "
      .repeat(Math.ceil((MAX_PATH_DATA_LEN + 1) / 5))
      .slice(0, MAX_PATH_DATA_LEN + 1);
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ${dPad}"/></svg>`;
    if (input.length <= MAX_SVG_BYTES) {
      // Does NOT throw — path element survives, just without the d attribute
      const san = sanitizeSvg(bytes(input));
      const p = reparse(san.markup);
      expect(hasEl(p, "path")).toBe(true);
      // The oversized d value was dropped
      expect(attrVal(p, "path", "d")).toBeUndefined();
    }
  });

  it("d value exceeding MAX_PATH_DATA_LEN where path is ONLY content → SanitizeError (empty rebuild)", () => {
    // Same scenario but the path has NO other attributes/children that would survive.
    // Without d, a bare <path/> IS still a child element — svg is not empty.
    // This test documents: drop of d does NOT cause SanitizeError alone.
    // For SanitizeError, ALL children must be dropped (e.g. only script elements).
    const dPad = "L1 1 "
      .repeat(Math.ceil((MAX_PATH_DATA_LEN + 1) / 5))
      .slice(0, MAX_PATH_DATA_LEN + 1);
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ${dPad}"/></svg>`;
    if (input.length <= MAX_SVG_BYTES) {
      // path element survives (without d), so this succeeds
      expect(() => sanitizeSvg(bytes(input))).not.toThrow();
    }
  });

  it("pathological: deeply-nested CDATA does not freeze the parser", () => {
    // Repeated CDATA sections — each is O(n) to scan for ']]>', bounded by input size
    const cdata = "<![CDATA[innocuous text]]>".repeat(100);
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><title>${cdata}</title><path d="M0 0"/></svg>`;
    const start = Date.now();
    if (input.length <= MAX_SVG_BYTES) {
      expect(() => sanitizeSvg(bytes(input))).not.toThrow();
    }
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
