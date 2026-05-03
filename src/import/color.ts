// CSS color string → Figma RGB(A). Only handles the forms the plugin emits
// (`#rrggbb` and `rgba(r, g, b, a)`). Returns null on unrecognised input.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;
const RGBA_RE = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/;
const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;

export function cssToRgba(css: string): RGBA | null {
  const m6 = HEX6.exec(css);
  if (m6) {
    const v = m6[1] ?? "";
    return {
      r: parseInt(v.slice(0, 2), 16) / 255,
      g: parseInt(v.slice(2, 4), 16) / 255,
      b: parseInt(v.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  const m3 = HEX3.exec(css);
  if (m3) {
    const v = m3[1] ?? "";
    const r = parseInt(v.charAt(0) + v.charAt(0), 16) / 255;
    const g = parseInt(v.charAt(1) + v.charAt(1), 16) / 255;
    const b = parseInt(v.charAt(2) + v.charAt(2), 16) / 255;
    return { r, g, b, a: 1 };
  }
  const ma = RGBA_RE.exec(css);
  if (ma) {
    return {
      r: clamp01(parseInt(ma[1] ?? "0", 10) / 255),
      g: clamp01(parseInt(ma[2] ?? "0", 10) / 255),
      b: clamp01(parseInt(ma[3] ?? "0", 10) / 255),
      a: clamp01(parseFloat(ma[4] ?? "1")),
    };
  }
  const mr = RGB_RE.exec(css);
  if (mr) {
    return {
      r: clamp01(parseInt(mr[1] ?? "0", 10) / 255),
      g: clamp01(parseInt(mr[2] ?? "0", 10) / 255),
      b: clamp01(parseInt(mr[3] ?? "0", 10) / 255),
      a: 1,
    };
  }
  return null;
}

export function cssToRgb(css: string): { rgb: RGB; opacity: number } | null {
  const rgba = cssToRgba(css);
  if (!rgba) return null;
  return { rgb: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
