import { describe, it, expect } from "vitest";
import {
  decomposeSvg,
  DecomposeError,
  fitDecomposedToBox,
} from "../../../src/export/svg-decompose";

function bytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

describe("decomposeSvg — N1 native geometry (ADR 002 #M)", () => {
  it("decomposes a pure path into a native shape{geometry:path} with no data:URI", () => {
    const d = decomposeSvg(
      bytes(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
          '<path d="M0 0 L10 0 L10 10 Z" fill="#ff0000"/></svg>',
      ),
    );
    expect(d.shapes).toHaveLength(1);
    const shape = d.shapes[0]!;
    expect(shape.kind).toBe("shape");
    expect(shape.geometry).toBe("path");
    expect(shape.pathData).toBe("M 0 0 L 10 0 L 10 10 Z");
    expect(shape.fill).toBe("#ff0000");
    // NOTHING resembling a data: URI / SVG markup is produced.
    expect(JSON.stringify(d)).not.toContain("data:");
    expect(JSON.stringify(d)).not.toContain("<svg");
    expect(d.viewBox).toEqual([0, 0, 10, 10]);
  });

  it("carries the path winding rule (fill-rule=evenodd → EVENODD)", () => {
    const d = decomposeSvg(
      bytes('<svg viewBox="0 0 4 4"><path d="M0 0 L4 4 Z" fill-rule="evenodd" fill="#000"/></svg>'),
    );
    expect(d.shapes[0]!.paths).toEqual([{ data: "M 0 0 L 4 4 Z", windingRule: "EVENODD" }]);
  });

  it("maps rect → path (M/L/Z, no H/V) and rounded rect → arcs", () => {
    const plain = decomposeSvg(
      bytes('<svg viewBox="0 0 10 10"><rect x="1" y="2" width="4" height="6" fill="#0f0"/></svg>'),
    );
    expect(plain.shapes[0]!.pathData).toBe("M 1 2 L 5 2 L 5 8 L 1 8 Z");
    // Paint colours are kept verbatim by the shared validator (no hex expansion).
    expect(plain.shapes[0]!.fill).toBe("#0f0");

    const rounded = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" rx="2" fill="#000"/></svg>',
      ),
    );
    expect(rounded.shapes[0]!.pathData).toContain("A 2 2 0 0 1");
  });

  it("maps circle and ellipse → two-arc path", () => {
    const c = decomposeSvg(
      bytes('<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="#000"/></svg>'),
    );
    expect(c.shapes[0]!.pathData).toBe("M 15 10 A 5 5 0 0 1 5 10 A 5 5 0 0 1 15 10 Z");
    const e = decomposeSvg(
      bytes('<svg viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="6" ry="3" fill="#000"/></svg>'),
    );
    expect(e.shapes[0]!.pathData).toBe("M 16 10 A 6 3 0 0 1 4 10 A 6 3 0 0 1 16 10 Z");
  });

  it("maps polygon / polyline / line → path", () => {
    const poly = decomposeSvg(
      bytes('<svg viewBox="0 0 10 10"><polygon points="0,0 10,0 5,8" fill="#000"/></svg>'),
    );
    expect(poly.shapes[0]!.pathData).toBe("M 0 0 L 10 0 L 5 8 Z");
    const line = decomposeSvg(
      bytes('<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="9" y2="9" stroke="#000"/></svg>'),
    );
    expect(line.shapes[0]!.pathData).toBe("M 0 0 L 9 9");
    expect(line.shapes[0]!.stroke).toEqual({ color: "#000", width: 1 });
  });

  it("bakes a group transform into the child path data (g/transform nesting)", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 100 100">' +
          '<g transform="translate(10 20)"><path d="M0 0 L5 0" fill="#000"/></g></svg>',
      ),
    );
    expect(d.shapes[0]!.pathData).toBe("M 10 20 L 15 20");
  });

  it("composes nested group transforms (translate then scale)", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 100 100">' +
          '<g transform="translate(10 10)"><g transform="scale(2)">' +
          '<path d="M1 1 L2 2" fill="#000"/></g></g></svg>',
      ),
    );
    // (1,1) → scale2 → (2,2) → translate(10,10) → (12,12)
    expect(d.shapes[0]!.pathData).toBe("M 12 12 L 14 14");
  });

  it("maps a linearGradient fill → LSML linear-gradient with stops + 6-float transform", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 10 10">' +
          '<defs><linearGradient id="g" gradientTransform="matrix(1 0 0 1 2 3)">' +
          '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>' +
          "</linearGradient></defs>" +
          '<rect x="0" y="0" width="10" height="10" fill="url(#g)"/></svg>',
      ),
    );
    const fills = d.shapes[0]!.fills!;
    expect(fills).toHaveLength(1);
    const grad = fills[0]!;
    expect(grad.kind).toBe("linear-gradient");
    expect((grad as { stops: unknown[] }).stops).toEqual([
      { offset: 0, color: "#000" },
      { offset: 1, color: "#fff" },
    ]);
    expect((grad as { transform?: number[] }).transform).toEqual([1, 0, 0, 1, 2, 3]);
  });

  it("maps a radialGradient fill → LSML radial-gradient", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 10 10">' +
          '<radialGradient id="r"><stop offset="0" stop-color="red"/>' +
          '<stop offset="1" stop-color="blue"/></radialGradient>' +
          '<circle cx="5" cy="5" r="5" fill="url(#r)"/></svg>',
      ),
    );
    expect(d.shapes[0]!.fills![0]!.kind).toBe("radial-gradient");
  });

  it("inherits paint down a group (fill set on <g>)", () => {
    const d = decomposeSvg(
      bytes('<svg viewBox="0 0 10 10"><g fill="#abcdef"><path d="M0 0 L1 1" /></g></svg>'),
    );
    expect(d.shapes[0]!.fill).toBe("#abcdef");
  });

  // --- N1 → N2 BAILOUT: a single non-decomposable element aborts (A3.4) ---

  it("bails (throws DecomposeError) on <text> — font-dependent glyphs", () => {
    expect(() =>
      decomposeSvg(bytes('<svg viewBox="0 0 10 10"><text x="0" y="5">hi</text></svg>')),
    ).toThrow(DecomposeError);
  });

  it("bails on a <filter> reference attribute on a kept element", () => {
    expect(() =>
      decomposeSvg(bytes('<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" filter="url(#f)"/></svg>')),
    ).toThrow(DecomposeError);
  });

  it("bails on an embedded raster <image>", () => {
    expect(() =>
      decomposeSvg(
        bytes('<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAA"/></svg>'),
      ),
    ).toThrow(DecomposeError);
  });

  it("bails on a <pattern>", () => {
    expect(() => decomposeSvg(bytes('<svg viewBox="0 0 10 10"><pattern id="p"/></svg>'))).toThrow(
      DecomposeError,
    );
  });

  it("bails — NO PARTIAL decomposition — when one of several elements is bad", () => {
    // A valid path AND a <text>: the whole document must bail (no half-render).
    expect(() =>
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="#000"/>' + "<text>x</text></svg>",
        ),
      ),
    ).toThrow(DecomposeError);
  });

  it("bails on a foreign-namespace element / attribute", () => {
    expect(() => decomposeSvg(bytes('<svg viewBox="0 0 10 10"><foo:bar/></svg>'))).toThrow(
      DecomposeError,
    );
  });

  it("bails on a DTD/entity document (parser rejects, surfaced as DecomposeError)", () => {
    expect(() => decomposeSvg(bytes('<!DOCTYPE svg><svg><path d="M0 0"/></svg>'))).toThrow(
      DecomposeError,
    );
  });

  it("bails when fill references a missing gradient id", () => {
    expect(() =>
      decomposeSvg(
        bytes('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(#nope)"/></svg>'),
      ),
    ).toThrow(DecomposeError);
  });

  it("bails on a gradient stroke (not expressible as scalar LSML stroke)", () => {
    expect(() =>
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 10 10"><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient>' +
            '<path d="M0 0 L1 1" stroke="url(#g)"/></svg>',
        ),
      ),
    ).toThrow(DecomposeError);
  });

  // --- geometry LEAF with an ELEMENT child → bail to N2 (A3.4 all-or-nothing).
  // A leaf primitive is geometry only; a nested element (animate/script/…) is
  // outside the decomposable set and must NOT be silently dropped (the trap
  // Probe found: <path><animate/></path> was passing to N1 mute). ---

  it("bails on <path><animate/></path> — SMIL child must not be silently dropped", () => {
    expect(() =>
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="#000">' +
            '<animate attributeName="fill" to="#fff" dur="1s"/></path></svg>',
        ),
      ),
    ).toThrow(DecomposeError);
  });

  it("bails on <rect><script/></rect> — element child on a geometry leaf", () => {
    expect(() =>
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000">' +
            "<script>alert(1)</script></rect></svg>",
        ),
      ),
    ).toThrow(DecomposeError);
  });

  it("bails on <circle><foreignObject/></circle> — element child on a geometry leaf", () => {
    expect(() =>
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="#000">' +
            "<foreignObject></foreignObject></circle></svg>",
        ),
      ),
    ).toThrow(DecomposeError);
  });

  it("produces NO partial native geometry when a leaf hides a forbidden child", () => {
    // A perfectly valid <path> sits beside a poisoned one; the WHOLE document
    // must bail — never emit the good path while dropping the animate.
    let caught: unknown;
    try {
      decomposeSvg(
        bytes(
          '<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="#000"/>' +
            '<path d="M2 2 L3 3" fill="#000"><animate attributeName="d" dur="1s"/></path></svg>',
        ),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DecomposeError);
  });

  it("keeps legitimate leaves green — a normal <path>/<rect>/<circle> with only text is fine", () => {
    // text/whitespace children are inert and must NOT trigger the leaf guard.
    expect(() =>
      decomposeSvg(
        bytes('<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="#000">  </path></svg>'),
      ),
    ).not.toThrow();
  });
});

describe("fitDecomposedToBox — viewBox → host box fit", () => {
  it("scales geometry to the host box (object-fit fill) and rebases the viewBox", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#000"/></svg>',
      ),
    );
    const fitted = fitDecomposedToBox(d, { w: 20, h: 30 });
    // 10×10 viewBox → 20×30 box: scale (2,3).
    expect(fitted.shapes[0]!.pathData).toBe("M 0 0 L 20 0 L 20 30 L 0 30 Z");
    expect(fitted.viewBox).toEqual([0, 0, 20, 30]);
  });

  it("applies a non-zero viewBox origin offset", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="5 5 10 10"><rect x="5" y="5" width="10" height="10" fill="#000"/></svg>',
      ),
    );
    const fitted = fitDecomposedToBox(d, { w: 10, h: 10 });
    // translate(-5,-5) then scale(1,1): the rect origin moves to (0,0).
    expect(fitted.shapes[0]!.pathData).toBe("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  });

  it("is a no-op when box is null", () => {
    const d = decomposeSvg(
      bytes('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>'),
    );
    expect(fitDecomposedToBox(d, null)).toBe(d);
  });

  it("fits gradient transforms too", () => {
    const d = decomposeSvg(
      bytes(
        '<svg viewBox="0 0 10 10">' +
          '<linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
          '<rect x="0" y="0" width="10" height="10" fill="url(#g)"/></svg>',
      ),
    );
    const fitted = fitDecomposedToBox(d, { w: 20, h: 20 });
    const grad = fitted.shapes[0]!.fills![0]!;
    // The gradient had no own transform; the fit scale(2,2) becomes its transform.
    expect((grad as { transform?: number[] }).transform).toEqual([2, 0, 0, 2, 0, 0]);
  });
});
