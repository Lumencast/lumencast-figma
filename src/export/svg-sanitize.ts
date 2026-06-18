// SVG geometry-only sanitizer (Bastion contract #N, ADR 002 Amendment 3).
//
// An SVG-as-asset is an IMAGE paint whose bytes are SVG. It was DROPPED since
// the VETO #H (fcc6d79) because an inline `data:image/svg+xml` can carry
// `<script>`, event handlers, SMIL, `<foreignObject><iframe>`, external
// `<image>`/`<use>` href, `style`/CSS, and XXE — all executable / exfiltrating
// surface in a CEF host. This module restores the 0-loss SVG path WITHOUT
// reopening that surface, by a strict PARSE-THEN-REBUILD-TYPED discipline:
//
//   1. Parse the SVG bytes with a pure in-process XML reader (no DOMParser,
//      no `document`, no host round-trip — none exist in the plugin sandbox
//      anyway). The reader REJECTS `<!DOCTYPE>` / `<!ENTITY>` / any DTD and
//      resolves NO entity (§4 XXE / billion-laughs), drops PIs (except the
//      XML prologue) and comments, and is bounded (§5 anti-DoS).
//   2. Rebuild a BRAND-NEW document, copying ONLY allowlisted elements (§2),
//      allowlisted attributes per element (§3), with every numeric-bearing
//      value (`transform`/`viewBox`/`points`/`d`/…) re-parsed into finite
//      bounded numeric tokens and RE-EMITTED — never a raw string passthrough.
//   3. Serialise the rebuilt tree with a serialiser that NEVER writes a DTD,
//      entity, PI or comment, and emit it as `data:image/svg+xml;base64` via
//      the SINGLE emitter `emitSanitizedSvgDataUri`, which only accepts the
//      nominal `SanitizedSvg` brand. Raw SVG bytes are therefore NOT typable
//      into the emitter — the only path to `data:image/svg+xml` runs through
//      `sanitizeSvg` first.
//
// Anything not explicitly allowed is DROPPED (never "cleaned"): no regex-strip,
// no deny-list, no `.replace`. A document that cannot be parsed (DTD/entity,
// malformed) or that is empty after rebuild yields a SanitizeError so the
// caller can raise an `error`-severity gate diagnostic (§7) — never a silent
// drop or partial render.

// ---------------------------------------------------------------------------
// §5 bounds (anti-DoS). Refused BEFORE / DURING parse, never a freeze.
// ---------------------------------------------------------------------------

/** Max input size. A `data:` SVG larger than this is refused outright; an
 *  authored vector glyph/icon is kilobytes, 256 KiB is generous. */
export const MAX_SVG_BYTES = 256 * 1024;
/** Max total element count across the whole document. */
export const MAX_ELEMENTS = 10_000;
/** Max nesting depth. Bounds the (iterative) tree builder's working stack. */
export const MAX_DEPTH = 64;
/** Max length of a `d` / `points` value (characters). Caps path-data DoS. */
export const MAX_PATH_DATA_LEN = 100_000;
/** Max number of numeric tokens parsed out of a single geometry value. */
export const MAX_NUMERIC_TOKENS = 20_000;
/** Max `<stop>` children under a single gradient. */
export const MAX_GRADIENT_STOPS = 256;
/** Absolute clamp on any emitted finite numeric token (reuses the T4 spirit:
 *  a value outside this range is dropped, not emitted as a free value). */
const NUMERIC_ABS_MAX = 1e7;

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

// ---------------------------------------------------------------------------
// Nominal brand. `SanitizedSvg` is structurally a string but carries a private
// brand symbol, so a raw `string` / `Uint8Array` is NOT assignable to it. The
// brand is ONLY minted inside `sanitizeSvg` after a full rebuild — making the
// `data:image/svg+xml` emitter unreachable for un-sanitized bytes (§6).
// ---------------------------------------------------------------------------

declare const SANITIZED_SVG_BRAND: unique symbol;

export interface SanitizedSvg {
  readonly [SANITIZED_SVG_BRAND]: true;
  /** The reconstructed, serialised SVG markup. Read-only; do not hand-build. */
  readonly markup: string;
}

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizeError";
  }
}

// ---------------------------------------------------------------------------
// §2 element allowlist (closed). Anything else → drop element + its subtree.
// ---------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set<string>([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
]);

// Elements whose only allowed payload is escaped text (no child elements).
const TEXT_ONLY_ELEMENTS = new Set<string>(["title", "desc"]);

// ---------------------------------------------------------------------------
// §3 attribute allowlist, per element. Geometry / paint / gradient / internal
// refs only. Anything not listed for an element is dropped.
// ---------------------------------------------------------------------------

// Paint attributes admitted on any shape/group/gradient-bearing element.
const PAINT_ATTRS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "clip-rule",
];
// Internal-reference attributes (value restricted to `url(#id)`/`none`/`inherit`).
const REF_ATTRS = ["clip-path", "mask"];
const COMMON_ATTRS = ["id", "transform", ...PAINT_ATTRS, ...REF_ATTRS];

const ATTR_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  svg: new Set(["viewBox", "width", "height", "preserveAspectRatio", ...COMMON_ATTRS]),
  g: new Set([...COMMON_ATTRS]),
  defs: new Set(["id"]),
  path: new Set(["d", ...COMMON_ATTRS]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", ...COMMON_ATTRS]),
  circle: new Set(["cx", "cy", "r", ...COMMON_ATTRS]),
  ellipse: new Set(["cx", "cy", "rx", "ry", ...COMMON_ATTRS]),
  line: new Set(["x1", "y1", "x2", "y2", ...COMMON_ATTRS]),
  polyline: new Set(["points", ...COMMON_ATTRS]),
  polygon: new Set(["points", ...COMMON_ATTRS]),
  linearGradient: new Set([
    "x1",
    "y1",
    "x2",
    "y2",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "id",
  ]),
  radialGradient: new Set([
    "cx",
    "cy",
    "r",
    "fx",
    "fy",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "id",
  ]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
  clipPath: new Set(["id", "clipPathUnits", "transform"]),
  mask: new Set(["id", "maskUnits", "maskContentUnits", "x", "y", "width", "height"]),
  title: new Set<string>([]),
  desc: new Set<string>([]),
};

// Geometry / numeric-bearing attributes whose value is RE-PARSED into finite
// bounded numeric tokens and re-emitted (§3), never passed through raw.
const NUMERIC_LIST_ATTRS = new Set(["viewBox", "points", "transform", "gradientTransform"]);
const SCALAR_NUMERIC_ATTRS = new Set([
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "fx",
  "fy",
  "offset",
  "stroke-width",
  "stroke-miterlimit",
  "stroke-dashoffset",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "stop-opacity",
]);

// Reference-valued attributes restricted to `url(#localid)` / `none` / `inherit`.
const URL_REF_ATTRS = new Set(["clip-path", "mask"]);

// Closed allowlist of CSS <named-color> keywords (the 148 CSS Color Module
// Level 4 names + the legacy `transparent`). A bare paint value that is not in
// this table, nor a `#hex`, `rgb()/rgba()/hsl()/hsla()`, `url(#localid)`, nor a
// CSS-wide keyword (`currentColor`/`inherit`/`none`) is DROPPED — never passed
// through. This closes the gap where any `[a-zA-Z]{1,32}` (e.g. `javascript`,
// `url`, `data`, `expression`, `script`) survived as a "named colour".
const CSS_NAMED_COLORS = new Set<string>([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
  "transparent",
]);

// Enumerated attributes restricted to a fixed token set.
const ENUM_ATTRS: Record<string, ReadonlySet<string>> = {
  "fill-rule": new Set(["nonzero", "evenodd", "inherit"]),
  "clip-rule": new Set(["nonzero", "evenodd", "inherit"]),
  "stroke-linecap": new Set(["butt", "round", "square", "inherit"]),
  "stroke-linejoin": new Set(["miter", "round", "bevel", "inherit"]),
  gradientUnits: new Set(["userSpaceOnUse", "objectBoundingBox"]),
  clipPathUnits: new Set(["userSpaceOnUse", "objectBoundingBox"]),
  maskUnits: new Set(["userSpaceOnUse", "objectBoundingBox"]),
  maskContentUnits: new Set(["userSpaceOnUse", "objectBoundingBox"]),
  spreadMethod: new Set(["pad", "reflect", "repeat"]),
};

// ---------------------------------------------------------------------------
// Pure in-process XML reader. Token-based, single forward pass, non-recursive.
// REJECTS DTD/DOCTYPE/ENTITY (§4). Resolves only the five predefined XML
// entities and numeric char-refs; NO custom/external entity. Drops PI (except
// the prologue, which is ignored anyway) and comments.
// ---------------------------------------------------------------------------

// Exported so the geometry-decomposer (#M, `svg-decompose.ts`) can REUSE this
// audited parser rather than introduce a second, separately-attackable XML
// reader. The parse contract (DTD/entity rejection §4, anti-DoS bounds §5) is
// shared by both consumers — there is exactly one SVG parser in the codebase.
export interface XmlElement {
  name: string;
  /** Local name (prefix stripped). */
  local: string;
  /** Raw attributes as parsed; prefix kept so namespace checks can run. */
  attrs: { name: string; value: string }[];
  children: XmlNode[];
}
export interface XmlText {
  text: string;
}
export type XmlNode = XmlElement | XmlText;

export function isElement(n: XmlNode): n is XmlElement {
  return (n as XmlElement).name !== undefined;
}

const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode XML text/attribute content. ONLY the five predefined entities and
 *  numeric character references are resolved. An unknown `&name;` is a parse
 *  error (it could be a custom/DTD-defined entity, which we reject wholesale —
 *  §4: no custom entity expansion). This guarantees an HTML-entity-encoding
 *  bypass (fixture 9) cannot reconstitute markup, since decoding produces a
 *  literal `<`/`>` as TEXT, never a new element. */
function decodeEntities(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch !== "&") {
      out += ch;
      i++;
      continue;
    }
    const semi = s.indexOf(";", i + 1);
    if (semi === -1 || semi - i > 32) {
      throw new SanitizeError("unterminated or oversized entity reference");
    }
    const body = s.slice(i + 1, semi);
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const digits = hex ? body.slice(2) : body.slice(1);
      if (!/^[0-9]+$/.test(hex ? "" : digits) && !(hex && /^[0-9a-fA-F]+$/.test(digits))) {
        throw new SanitizeError(`malformed numeric character reference &${body};`);
      }
      const code = parseInt(digits, hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        throw new SanitizeError("numeric character reference out of range");
      }
      out += String.fromCodePoint(code);
    } else {
      const repl = PREDEFINED_ENTITIES[body];
      if (repl === undefined) {
        // Unknown named entity → would require a DTD/custom entity. Reject.
        throw new SanitizeError(`unknown entity reference &${body};`);
      }
      out += repl;
    }
    i = semi + 1;
  }
  return out;
}

/** Parse the raw bytes into a bounded XML tree, or throw SanitizeError. The
 *  SINGLE SVG parser in the codebase — exported for reuse by `svg-decompose.ts`
 *  (#M) so geometry decomposition shares the same DTD/entity rejection (§4) and
 *  anti-DoS bounds (§5) Bastion already audited. Returns the root `<svg>`. */
export function parseXml(input: string): XmlElement {
  if (input.length > MAX_SVG_BYTES) {
    throw new SanitizeError(`SVG exceeds byte cap (${input.length} > ${MAX_SVG_BYTES})`);
  }
  // §4: structurally reject any DTD construct. A `<!DOCTYPE` (and therefore
  // any inline `<!ENTITY>`) is a PARSE FAILURE, not a strip.
  if (/<!DOCTYPE/i.test(input) || /<!ENTITY/i.test(input)) {
    throw new SanitizeError("DTD / DOCTYPE / ENTITY is forbidden (XXE guard)");
  }

  const root: XmlElement = { name: "#root", local: "#root", attrs: [], children: [] };
  const stack: XmlElement[] = [root];
  let elementCount = 0;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      appendText(stack[stack.length - 1]!, input.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1]!, input.slice(i, lt));

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      if (end === -1) throw new SanitizeError("unterminated comment");
      i = end + 3; // drop comment
      continue;
    }
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt + 9);
      if (end === -1) throw new SanitizeError("unterminated CDATA");
      // CDATA content is literal text — appended without entity decoding.
      const top = stack[stack.length - 1]!;
      top.children.push({ text: input.slice(lt + 9, end) });
      i = end + 3;
      continue;
    }
    if (input.startsWith("<!", lt)) {
      // Any other declaration (`<!DOCTYPE` already rejected above, `<!ENTITY`
      // too). Anything else here is unexpected — reject rather than guess.
      throw new SanitizeError("unsupported `<!` declaration");
    }
    if (input.startsWith("<?", lt)) {
      const end = input.indexOf("?>", lt + 2);
      if (end === -1) throw new SanitizeError("unterminated processing instruction");
      i = end + 2; // drop PI (prologue included — we re-emit our own header)
      continue;
    }
    if (input.startsWith("</", lt)) {
      const end = input.indexOf(">", lt + 2);
      if (end === -1) throw new SanitizeError("unterminated end tag");
      const name = input.slice(lt + 2, end).trim();
      const top = stack[stack.length - 1]!;
      if (stack.length <= 1 || top.name !== name) {
        throw new SanitizeError(`mismatched end tag </${name}>`);
      }
      stack.pop();
      i = end + 1;
      continue;
    }

    // Start tag. Find the matching `>` that is not inside a quoted value.
    const tagEnd = findTagEnd(input, lt + 1);
    if (tagEnd === -1) throw new SanitizeError("unterminated start tag");
    const selfClose = input[tagEnd - 1] === "/";
    const inner = input.slice(lt + 1, selfClose ? tagEnd - 1 : tagEnd);
    const { name, attrs } = parseStartTag(inner);

    if (++elementCount > MAX_ELEMENTS) {
      throw new SanitizeError(`element count exceeds cap (${MAX_ELEMENTS})`);
    }
    const el: XmlElement = {
      name,
      local: localName(name),
      attrs,
      children: [],
    };
    stack[stack.length - 1]!.children.push(el);
    if (!selfClose) {
      stack.push(el);
      if (stack.length - 1 > MAX_DEPTH) {
        throw new SanitizeError(`nesting depth exceeds cap (${MAX_DEPTH})`);
      }
    }
    i = tagEnd + 1;
  }

  if (stack.length !== 1) {
    throw new SanitizeError("unclosed element(s) at end of input");
  }
  const top = root.children.find((c): c is XmlElement => isElement(c) && c.local === "svg");
  if (!top) throw new SanitizeError("no root <svg> element");
  return top;
}

function appendText(parent: XmlElement, raw: string): void {
  if (raw.length === 0) return;
  parent.children.push({ text: decodeEntities(raw) });
}

/** Index of the `>` closing a start tag, skipping any inside `"`/`'` quotes. */
function findTagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < s.length; j++) {
    const c = s[j]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return j;
    }
  }
  return -1;
}

function parseStartTag(inner: string): { name: string; attrs: { name: string; value: string }[] } {
  let j = 0;
  while (j < inner.length && !isSpace(inner[j]!)) j++;
  const name = inner.slice(0, j);
  if (name.length === 0) throw new SanitizeError("empty tag name");
  const attrs: { name: string; value: string }[] = [];
  while (j < inner.length) {
    while (j < inner.length && isSpace(inner[j]!)) j++;
    if (j >= inner.length) break;
    let k = j;
    while (k < inner.length && inner[k] !== "=" && !isSpace(inner[k]!)) k++;
    const attrName = inner.slice(j, k);
    while (k < inner.length && isSpace(inner[k]!)) k++;
    if (inner[k] !== "=") {
      // Valueless attribute (e.g. boolean). Treated as empty; it will be
      // dropped unless allowlisted, and allowlisted geometry needs a value.
      attrs.push({ name: attrName, value: "" });
      j = k;
      continue;
    }
    k++; // skip '='
    while (k < inner.length && isSpace(inner[k]!)) k++;
    const q = inner[k];
    if (q !== '"' && q !== "'") throw new SanitizeError(`unquoted attribute value for ${attrName}`);
    const close = inner.indexOf(q, k + 1);
    if (close === -1) throw new SanitizeError(`unterminated attribute value for ${attrName}`);
    const rawValue = inner.slice(k + 1, close);
    attrs.push({ name: attrName, value: decodeEntities(rawValue) });
    j = close + 1;
  }
  return { name, attrs };
}

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

export function prefixOf(name: string): string | null {
  const colon = name.indexOf(":");
  return colon === -1 ? null : name.slice(0, colon);
}

// ---------------------------------------------------------------------------
// Rebuild: copy ONLY allowlisted nodes/attrs into a fresh typed tree.
// ---------------------------------------------------------------------------

interface CleanElement {
  name: string; // local name only — we emit in the SVG default namespace
  attrs: { name: string; value: string }[];
  text?: string; // for title/desc only
  children: CleanElement[];
}

function rebuild(svg: XmlElement): CleanElement {
  // The root must be <svg> in the SVG namespace OR with no prefix (default NS
  // is asserted at emit time via a hard-written xmlns). A prefixed root whose
  // prefix is not the SVG default is namespace confusion → reject.
  if (prefixOf(svg.name) !== null) {
    throw new SanitizeError("root <svg> carries a namespace prefix");
  }
  const root = cleanElement(svg);
  if (!root) throw new SanitizeError("root <svg> dropped by allowlist");
  return root;
}

function cleanElement(el: XmlElement): CleanElement | null {
  // Namespace confusion: an element with a prefix is only kept if its local
  // name is allowlisted AND the prefix is not used to smuggle a foreign NS.
  // We do not honour `xmlns:*` declarations (we never copy them), so the ONLY
  // namespace we recognise is the unprefixed SVG default. A prefixed element
  // is therefore dropped (fixture 8: hors-NS / unknown prefix → drop).
  if (prefixOf(el.name) !== null) return null;
  const local = el.local;
  if (!ALLOWED_ELEMENTS.has(local)) return null;

  const out: CleanElement = { name: local, attrs: [], children: [] };

  for (const a of el.attrs) {
    const kept = cleanAttribute(local, a.name, a.value);
    if (kept) out.attrs.push(kept);
  }

  if (TEXT_ONLY_ELEMENTS.has(local)) {
    // title/desc: escaped text only, NO child elements.
    let text = "";
    for (const c of el.children) {
      if (!isElement(c)) text += c.text;
    }
    if (text.length > 0) out.text = text;
    return out;
  }

  let stops = 0;
  for (const c of el.children) {
    if (!isElement(c)) continue; // drop stray text in non-text elements
    if (c.local === "stop" && (local === "linearGradient" || local === "radialGradient")) {
      if (++stops > MAX_GRADIENT_STOPS) {
        throw new SanitizeError(`gradient stop count exceeds cap (${MAX_GRADIENT_STOPS})`);
      }
    }
    const child = cleanElement(c);
    if (child) out.children.push(child);
  }
  return out;
}

/** Validate + (where numeric) re-emit a single attribute, or return null to
 *  drop it. ALL validation is anchored at both ends of the string. */
function cleanAttribute(
  element: string,
  rawName: string,
  rawValue: string,
): { name: string; value: string } | null {
  // §3 hard interdicts, checked structurally (not by deny-list-on-content):
  // any namespace prefix other than `xlink` is dropped; `on*` carry a prefix
  // of none but are simply absent from every allowlist, so they are dropped
  // by the allowlist check below. We additionally hard-drop anything that
  // looks like an event handler or style/class regardless of element.
  const lower = rawName.toLowerCase();
  if (lower.startsWith("on")) return null; // on* — defence in depth
  if (lower === "style" || lower === "class") return null;
  if (lower.startsWith("xmlns")) return null; // never copy NS decls

  const prefix = prefixOf(rawName);
  if (prefix !== null && prefix !== "xlink") return null; // foreign-NS attr → drop

  // href / xlink:href: fragment-only `#localid`. Anything else (external,
  // data:, javascript:) is dropped. We do NOT add href to any element's
  // allowlist, so this only ever keeps an internal fragment ref.
  const local = localName(rawName);
  if (local === "href") {
    if (/^#[A-Za-z_][\w.-]*$/.test(rawValue)) {
      // Emit normalised to `xlink:href` only on elements that legitimately
      // reference internally. None of our allowlisted elements need an href
      // (gradients use stop children, masks/clipPaths nest content), so we
      // drop it rather than risk a dangling ref. Kept here for clarity.
      return null;
    }
    return null;
  }

  const allowed = ATTR_ALLOWLIST[element];
  if (!allowed || !allowed.has(local)) return null;

  // --- value validation / re-emission, per attribute class ---

  if (NUMERIC_LIST_ATTRS.has(local)) {
    const v =
      local === "transform" || local === "gradientTransform"
        ? reemitTransform(rawValue)
        : reemitNumericList(rawValue);
    return v === null ? null : { name: local, value: v };
  }
  if (local === "d") {
    const v = reemitPathData(rawValue);
    return v === null ? null : { name: "d", value: v };
  }
  if (SCALAR_NUMERIC_ATTRS.has(local)) {
    const v = reemitScalar(rawValue);
    return v === null ? null : { name: local, value: v };
  }
  if (URL_REF_ATTRS.has(local)) {
    const v = validateUrlRef(rawValue);
    return v === null ? null : { name: local, value: v };
  }
  if (ENUM_ATTRS[local]) {
    return ENUM_ATTRS[local]!.has(rawValue) ? { name: local, value: rawValue } : null;
  }
  if (local === "id") {
    return /^[A-Za-z_][\w.-]*$/.test(rawValue) ? { name: "id", value: rawValue } : null;
  }
  if (local === "fill" || local === "stroke" || local === "stop-color") {
    const v = validatePaintColor(rawValue);
    return v === null ? null : { name: local, value: v };
  }
  if (local === "preserveAspectRatio") {
    return /^[A-Za-z ]{0,40}$/.test(rawValue) ? { name: local, value: rawValue } : null;
  }
  if (local === "stroke-dasharray") {
    const v = reemitNumericList(rawValue);
    return v === null ? null : { name: local, value: v };
  }
  // No other attribute class is allowlisted; drop.
  return null;
}

// ---------------------------------------------------------------------------
// Value re-emitters: parse to finite bounded numeric tokens, then re-emit.
// ---------------------------------------------------------------------------

export function clampFinite(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (n > NUMERIC_ABS_MAX || n < -NUMERIC_ABS_MAX) return null;
  return n;
}

export function fmt(n: number): string {
  // Trim to a stable decimal form; -0 normalised to 0.
  const v = Object.is(n, -0) ? 0 : n;
  return String(v);
}

// A SINGLE complete finite number, anchored. Used to validate each token in a
// list — a token that is not WHOLLY a number (e.g. `Infinity`, `0x1F`, `1e`,
// `foo`) fails this test and triggers a drop of the whole attribute.
const SINGLE_NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Split a whitespace/comma/`/`-separated numeric value into its tokens, each
 *  of which MUST be a complete finite number. Returns the parsed numbers, or
 *  `null` if ANY token is not wholly a finite number (no partial extraction). */
export function splitNumericArgs(value: string): number[] | null {
  const tokens = value.split(/[\s,/]+/).filter((t) => t.length > 0);
  const out: number[] = [];
  for (const t of tokens) {
    if (!SINGLE_NUMBER_RE.test(t)) return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** Re-parse a whitespace/comma separated numeric list (`viewBox`, `points`,
 *  `stroke-dasharray`) into finite bounded tokens, re-emitted space-joined. A
 *  token that is not wholly a finite number drops the whole attribute (§3). */
export function reemitNumericList(value: string): string | null {
  if (value.length > MAX_PATH_DATA_LEN) return null;
  if (value === "none" || value === "inherit") return value;
  const nums = splitNumericArgs(value);
  if (nums === null || nums.length === 0) return null;
  if (nums.length > MAX_NUMERIC_TOKENS) return null;
  const out: number[] = [];
  for (const n of nums) {
    const c = clampFinite(n);
    if (c === null) return null;
    out.push(c);
  }
  return out.map(fmt).join(" ");
}

export function reemitScalar(value: string): string | null {
  const v = value.trim();
  // Percentages are valid for some scalars (offset, opacity, gradient coords).
  const pct = v.endsWith("%");
  const num = pct ? v.slice(0, -1) : v;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(num)) return null;
  const c = clampFinite(parseFloat(num));
  if (c === null) return null;
  return pct ? `${fmt(c)}%` : fmt(c);
}

/** Re-emit a `transform` / `gradientTransform` as a sequence of recognised
 *  function calls with finite bounded numeric arguments. Unknown functions
 *  drop the whole attribute (we do not partially trust a transform string). */
export function reemitTransform(value: string): string | null {
  if (value.length > MAX_PATH_DATA_LEN) return null;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  let consumed = 0;
  const ALLOWED_FN = new Set(["matrix", "translate", "scale", "rotate", "skewX", "skewY"]);
  while ((m = re.exec(value)) !== null) {
    consumed = re.lastIndex;
    const fn = m[1]!;
    if (!ALLOWED_FN.has(fn)) return null;
    const args = splitNumericArgs(m[2]!);
    // A non-finite / non-parsable token (e.g. `Infinity`, `NaN`, `1e9999`, a
    // bare word) makes the ENTIRE attribute drop — no partial digit extraction.
    if (args === null || args.length === 0 || args.length > 6) return null;
    const nums: number[] = [];
    for (const a of args) {
      const c = clampFinite(a);
      if (c === null) return null;
      nums.push(c);
    }
    parts.push(`${fn}(${nums.map(fmt).join(" ")})`);
  }
  // Reject if there was non-whitespace content the function regex didn't cover
  // (guards against a smuggled trailing token).
  if (parts.length === 0) return null;
  if (value.slice(consumed).trim().length > 0) return null;
  return parts.join(" ");
}

/** Re-emit path `d`: tokenize into command letters + finite bounded numbers,
 *  re-serialise. Anything else (letters outside the SVG path grammar) drops
 *  the attribute. */
export function reemitPathData(value: string): string | null {
  if (value.length > MAX_PATH_DATA_LEN) return null;
  const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
  const tokenRe = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([,\s]+)/g;
  let out = "";
  let m: RegExpExecArray | null;
  let consumed = 0;
  let tokenCount = 0;
  while ((m = tokenRe.exec(value)) !== null) {
    consumed = tokenRe.lastIndex;
    if (m[1]) {
      if (!COMMANDS.includes(m[1])) return null;
      out += (out.length && !out.endsWith(" ") ? " " : "") + m[1] + " ";
    } else if (m[2]) {
      if (++tokenCount > MAX_NUMERIC_TOKENS) return null;
      const c = clampFinite(parseFloat(m[2]));
      if (c === null) return null;
      out += fmt(c) + " ";
    }
    // separators collapse to the single spaces we already insert
  }
  if (value.slice(consumed).trim().length > 0) return null; // un-tokenised tail
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `url(#localid)` / `none` / `inherit`. Anything else dropped. */
function validateUrlRef(value: string): string | null {
  const v = value.trim();
  if (v === "none" || v === "inherit") return v;
  const m = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/.exec(v);
  return m ? `url(#${m[1]})` : null;
}

/** Paint color: a CSS-wide keyword (`none`/`inherit`/`currentColor`), a
 *  `#hex`, `rgb()/rgba()/hsl()/hsla()` with a bounded body, `url(#localid)`
 *  (internal gradient ref), or a member of the CLOSED CSS <named-color> table.
 *  Anything else — including a bare `[a-zA-Z]+` word that is not a real named
 *  colour (`javascript`, `url`, `data`, `script`, `expression`, …) — is
 *  DROPPED, never passed through. Anchored at both ends. */
export function validatePaintColor(value: string): string | null {
  const v = value.trim();
  if (v === "none" || v === "inherit" || v === "currentColor") return v;
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/.test(v)) return v.replace(/\s+/g, "");
  // rgb()/rgba()/hsl()/hsla() — body restricted to digits, sign, dot, %, comma,
  // whitespace and the `/` alpha separator. No identifiers, no nested calls.
  if (/^(?:rgba?|hsla?)\(\s*[-\d.%,\s/]+\)$/.test(v)) return v.replace(/\s+/g, " ");
  // Closed named-colour allowlist (case-insensitive per CSS).
  if (CSS_NAMED_COLORS.has(v.toLowerCase())) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Serialise the clean tree. NEVER writes DTD/entity/PI/comment. xmlns hard-set.
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serialise(node: CleanElement, isRoot: boolean): string {
  let attrs = "";
  if (isRoot) {
    // xmlns rewritten in hard at emission (§3): the output is unambiguously
    // in the SVG default namespace, regardless of the input's declarations.
    attrs += ` xmlns="${SVG_NS}"`;
  }
  for (const a of node.attrs) {
    attrs += ` ${a.name}="${escapeAttr(a.value)}"`;
  }
  if (node.text !== undefined && node.children.length === 0) {
    return `<${node.name}${attrs}>${escapeText(node.text)}</${node.name}>`;
  }
  if (node.children.length === 0 && node.text === undefined) {
    return `<${node.name}${attrs}/>`;
  }
  let inner = node.text !== undefined ? escapeText(node.text) : "";
  for (const c of node.children) inner += serialise(c, false);
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Sniff whether bytes look like SVG (XML prologue or a `<svg` root). Used by
 *  the asset choke-point to route SVG bytes to the sanitizer. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  // Inspect a bounded prefix only.
  const limit = Math.min(bytes.length, 512);
  let s = "";
  for (let i = 0; i < limit; i++) s += String.fromCharCode(bytes[i]!);
  return /<\s*svg[\s>]/i.test(s) || (/^\s*<\?xml/i.test(s) && /<\s*svg/i.test(s));
}

export function bytesToString(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Parse-then-rebuild-typed sanitization. Returns a branded `SanitizedSvg` on
 *  success, or throws `SanitizeError` (§7 — caller raises an `error`-severity
 *  gate diagnostic; never a silent drop). */
export function sanitizeSvg(bytes: Uint8Array): SanitizedSvg {
  if (bytes.length === 0) throw new SanitizeError("empty SVG input");
  const input = bytesToString(bytes);
  const tree = parseXml(input);
  const clean = rebuild(tree);
  // §7: a tree that rebuilds to a bare <svg> with no geometry survivors is
  // effectively empty — refuse rather than emit a render-nothing asset.
  if (clean.children.length === 0 && clean.text === undefined) {
    throw new SanitizeError("SVG is empty after sanitization (no geometry survived)");
  }
  const markup = `<?xml version="1.0" encoding="UTF-8"?>` + serialise(clean, true);
  // Mint the brand ONLY here, after a full rebuild.
  return { markup } as unknown as SanitizedSvg;
}

/** The SINGLE function that turns sanitized SVG into a `data:image/svg+xml`
 *  URI. It accepts ONLY the nominal `SanitizedSvg` brand, so no raw string /
 *  Uint8Array can reach it (§6). This is the one and only place in the
 *  codebase that constructs a `data:image/svg+xml` payload. */
export function emitSanitizedSvgDataUri(svg: SanitizedSvg): string {
  // Encode as base64. Reuse the local pure-JS base64 encoder via the caller's
  // utf-8 bytes — but to keep this module self-contained we inline a minimal
  // UTF-8 → bytes step and call into the shared encoder.
  return `data:image/svg+xml;base64,${base64Utf8(svg.markup)}`;
}

// Minimal UTF-8 → base64 (sandbox has no btoa/Buffer/TextEncoder reliably).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Utf8(s: string): string {
  const bytes = utf8Bytes(s);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=";
  }
  return out;
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}
