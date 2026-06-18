import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  sanitizeSvg,
  emitSanitizedSvgDataUri,
  looksLikeSvg,
  SanitizeError,
  MAX_SVG_BYTES,
  type SanitizedSvg,
} from "../../../src/export/svg-sanitize";

// --- Test helpers -----------------------------------------------------------

function bytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

/** A minimal, dependency-free re-parser used ONLY by the tests to assert on the
 *  STRUCTURE of the sanitizer output (re-parse, never regex-on-string per the
 *  contract §8). Returns the set of element local-names and a list of
 *  (element, attrName) pairs present in the output. */
interface Parsed {
  elements: string[];
  attrs: { el: string; name: string; value: string }[];
}
function reparse(markup: string): Parsed {
  const elements: string[] = [];
  const attrs: { el: string; name: string; value: string }[] = [];
  // Drop the prologue.
  const s = markup.replace(/^<\?xml[^?]*\?>/, "");
  const tagRe = /<([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    const el = m[1]!;
    elements.push(localName(el));
    const attrBlock = m[2] ?? "";
    const aRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = aRe.exec(attrBlock)) !== null) {
      attrs.push({ el: localName(el), name: a[1]!, value: a[2]! });
    }
  }
  return { elements, attrs };
}
function localName(n: string): string {
  const i = n.indexOf(":");
  return i === -1 ? n : n.slice(i + 1);
}
function out(input: string): Parsed {
  return reparse(sanitizeSvg(bytes(input)).markup);
}
function hasElement(p: Parsed, name: string): boolean {
  return p.elements.includes(name);
}
function hasAttr(p: Parsed, name: string): boolean {
  return p.attrs.some((a) => a.name === name || localName(a.name) === name);
}

// --- Fixture 1: <script> dropped -------------------------------------------

describe("svg-sanitize §8 fixtures", () => {
  it("1 — <script> is absent from the output", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>`,
    );
    expect(hasElement(p, "script")).toBe(false);
    expect(hasElement(p, "path")).toBe(true);
  });

  it("2 — <foreignObject><iframe> is absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject><rect x="0" y="0" width="1" height="1"/></svg>`,
    );
    expect(hasElement(p, "foreignObject")).toBe(false);
    expect(hasElement(p, "iframe")).toBe(false);
    expect(hasElement(p, "rect")).toBe(true);
  });

  it("3 — on* event handlers (onload/onmouseover/onbegin) are absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onmouseover="x()" onbegin="y()" x="0" y="0" width="1" height="1"/></svg>`,
    );
    expect(p.attrs.some((a) => a.name.toLowerCase().startsWith("on"))).toBe(false);
    expect(hasElement(p, "rect")).toBe(true);
  });

  it("4 — <image href=http://evil> and xlink:href are absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="http://evil/x.png" xlink:href="http://evil/y.png"/><circle cx="1" cy="1" r="1"/></svg>`,
    );
    expect(hasElement(p, "image")).toBe(false);
    expect(p.attrs.some((a) => localName(a.name) === "href")).toBe(false);
    expect(hasElement(p, "circle")).toBe(true);
  });

  it("5 — <use href external> is absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><use href="http://evil/x.svg#a"/><path d="M0 0 L1 1"/></svg>`,
    );
    expect(hasElement(p, "use")).toBe(false);
    expect(hasElement(p, "path")).toBe(true);
  });

  it("6 — style attribute and <style>@import are absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(http://evil/x.css);</style><rect style="background:url(javascript:alert(1))" x="0" y="0" width="1" height="1"/></svg>`,
    );
    expect(hasElement(p, "style")).toBe(false);
    expect(hasAttr(p, "style")).toBe(false);
    expect(hasAttr(p, "class")).toBe(false);
    expect(hasElement(p, "rect")).toBe(true);
  });

  it("7 — SMIL <animate>/<set>/<animateTransform> are absent", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1"><animate attributeName="x" to="100"/><set attributeName="y" to="50"/><animateTransform attributeName="transform" type="rotate"/></rect></svg>`,
    );
    expect(hasElement(p, "animate")).toBe(false);
    expect(hasElement(p, "set")).toBe(false);
    expect(hasElement(p, "animateTransform")).toBe(false);
    expect(hasElement(p, "rect")).toBe(true);
  });

  it("8 — namespace confusion / foreign-prefix attrs and elements are dropped", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:ev="http://evil/ns"><ev:script>x</ev:script><rect ev:onload="alert(1)" data-x:href="javascript:alert(1)" x="0" y="0" width="1" height="1"/></svg>`,
    );
    // Foreign-prefixed element dropped.
    expect(hasElement(p, "script")).toBe(false);
    // Foreign-prefixed / data-x: attributes dropped; rect's geometry kept.
    expect(p.attrs.some((a) => a.name.includes(":") && localName(a.name) !== "href")).toBe(false);
    expect(p.attrs.some((a) => localName(a.name) === "href")).toBe(false);
    expect(hasElement(p, "rect")).toBe(true);
    // No prefixed xmlns:* declaration is ever copied — only the single
    // hard-set default `xmlns` on the root survives.
    expect(p.attrs.filter((a) => a.name.startsWith("xmlns:")).map((a) => a.name)).toEqual([]);
    expect(p.attrs.filter((a) => a.name === "xmlns").length).toBe(1);
  });

  it("9 — HTML-entity-encoding bypass does not reconstitute markup", () => {
    // The encoded `<script>` decodes to LITERAL text, never an element.
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><desc>&lt;script&gt;alert(1)&lt;/script&gt;</desc><path d="M0 0"/></svg>`,
    );
    expect(hasElement(p, "script")).toBe(false);
    expect(hasElement(p, "path")).toBe(true);
    // And re-parsing the emitted markup yields no script element.
    const markup = sanitizeSvg(
      bytes(
        `<svg xmlns="http://www.w3.org/2000/svg"><desc>&lt;script&gt;x&lt;/script&gt;</desc><path d="M0 0"/></svg>`,
      ),
    ).markup;
    // The literal `<` is re-escaped on output, so no `<script` substring exists.
    expect(markup.includes("<script")).toBe(false);
  });

  it("10 — XXE / billion-laughs DOCTYPE+ENTITY → parse failure (error), no freeze", () => {
    const xxe =
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>` +
      `<svg xmlns="http://www.w3.org/2000/svg"><desc>&lol2;</desc></svg>`;
    const start = Date.now();
    expect(() => sanitizeSvg(bytes(xxe))).toThrow(SanitizeError);
    // No freeze: rejected structurally, well under any expansion budget.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("10b — external SYSTEM entity DOCTYPE → parse failure", () => {
    const xxe =
      `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
      `<svg xmlns="http://www.w3.org/2000/svg"><desc>&xxe;</desc></svg>`;
    expect(() => sanitizeSvg(bytes(xxe))).toThrow(SanitizeError);
  });

  it("11 — pathological DoS (giant / deep / huge d) is refused, bounded", () => {
    // Oversized input → refused before parse.
    const giant = `<svg xmlns="http://www.w3.org/2000/svg">${"<g>".repeat(0)}${"x".repeat(MAX_SVG_BYTES + 10)}</svg>`;
    const start = Date.now();
    expect(() => sanitizeSvg(bytes(giant))).toThrow(SanitizeError);

    // Deeply nested → depth cap.
    const deep =
      `<svg xmlns="http://www.w3.org/2000/svg">` +
      "<g>".repeat(500) +
      "</g>".repeat(500) +
      `</svg>`;
    expect(() => sanitizeSvg(bytes(deep))).toThrow(SanitizeError);

    // Huge `d` token list → path-data length / token cap (attr dropped, but a
    // pathological million-point path is refused at the length bound).
    const hugeD = "M0 0 " + "L1 1 ".repeat(60_000);
    const hugePath = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${hugeD}"/></svg>`;
    // d attribute is dropped (over MAX_PATH_DATA_LEN) but the svg itself has no
    // other geometry survivor → empty rebuild → error. Either way: bounded.
    expect(() => sanitizeSvg(bytes(hugePath))).toThrow(SanitizeError);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("12 — SVG empty after sanitization → SanitizeError (gate, not silent drop)", () => {
    const p = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    expect(() => sanitizeSvg(bytes(p))).toThrow(SanitizeError);
    expect(() => sanitizeSvg(bytes(""))).toThrow(SanitizeError);
  });

  it("13 — nominal (path + linearGradient) survives + round-trips via the emitter", () => {
    const input =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="matrix(1 0 0 1 0 0)">` +
      `<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>` +
      `<path d="M10 10 L90 90 Z" fill="url(#g)" transform="translate(5 5)"/>` +
      `</svg>`;
    const san: SanitizedSvg = sanitizeSvg(bytes(input));
    const p = reparse(san.markup);
    expect(hasElement(p, "svg")).toBe(true);
    expect(hasElement(p, "linearGradient")).toBe(true);
    expect(p.elements.filter((e) => e === "stop").length).toBe(2);
    expect(hasElement(p, "path")).toBe(true);
    // Geometry / paint / gradient attributes survive.
    expect(p.attrs.some((a) => a.el === "path" && a.name === "d")).toBe(true);
    expect(p.attrs.some((a) => a.el === "path" && a.name === "fill" && a.value === "url(#g)")).toBe(
      true,
    );
    expect(p.attrs.some((a) => a.el === "svg" && a.name === "viewBox")).toBe(true);
    // Round-trip via the SINGLE emitter.
    const uri = emitSanitizedSvgDataUri(san);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(uri.length).toBeGreaterThan("data:image/svg+xml;base64,".length);
  });

  // --- Additional structural guarantees -------------------------------------

  it("output is always in the hard-set SVG default namespace", () => {
    const san = sanitizeSvg(
      bytes(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`),
    );
    expect(san.markup.includes(`xmlns="http://www.w3.org/2000/svg"`)).toBe(true);
  });

  it("numeric values are re-emitted (non-finite / smuggled tokens dropped)", () => {
    const p = out(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect x="NaN" y="0" width="1" height="1" transform="evil(1) translate(2 2)"/></svg>`,
    );
    // x=NaN dropped; transform with unknown fn `evil` dropped entirely.
    expect(p.attrs.some((a) => a.el === "rect" && a.name === "x")).toBe(false);
    expect(p.attrs.some((a) => a.el === "rect" && a.name === "transform")).toBe(false);
    expect(p.attrs.some((a) => a.el === "rect" && a.name === "y")).toBe(true);
  });

  it("looksLikeSvg sniffs SVG bytes and rejects raster magic", () => {
    expect(looksLikeSvg(bytes(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))).toBe(true);
    expect(looksLikeSvg(bytes(`<?xml version="1.0"?><svg></svg>`))).toBe(true);
    expect(looksLikeSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  // §6 call-graph guard: the literal `data:image/svg+xml` MUST appear in NO
  // source file other than the sanitizer (the single emitter). A new code path
  // that constructs a raw-byte SVG data URI elsewhere fails this test.
  it("no source file constructs data:image/svg+xml outside svg-sanitize.ts", () => {
    const srcRoot = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.ts$/.test(name)) continue;
        if (full.endsWith("svg-sanitize.ts")) continue; // the single emitter
        // Flag only CODE occurrences (a documentary mention in a `//` or `*`
        // comment line is not a construction site). Any non-comment line that
        // contains the literal is a new path to a raw SVG data URI → fail.
        for (const line of readFileSync(full, "utf8").split("\n")) {
          if (!line.includes("data:image/svg+xml")) continue;
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          offenders.push(`${full}: ${trimmed}`);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
