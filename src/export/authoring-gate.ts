// Authoring validation gate — early author feedback (ADR 002 §3.4 T6 / #I ;
// Bastion conditions 1.2 T5+T6, threat-model 2026-06-17).
//
// This runs INSIDE the figma plugin, at export, before the `.lsml` is
// written — so the author learns AT AUTHORING TIME that a bundle would be
// refused at the antenna, rather than after a round-trip to Orion. It is a
// FEEDBACK gate; the AUTHORITATIVE barrier is Orion's independent re-gate at
// the authoring→Orion frontier (`internal/compiler/authoring_gate.go`), and
// Solar re-gates again at render (defence in depth). The same invariants are
// enforced in all three places — figma cannot weaken them, only surface them
// earlier.
//
// What it refuses (each → an `error`-severity ValidationError):
//   - T1/T2 — an image `src` / `mask.source` whose host is not in
//     `assets.allowedHosts`, or whose scheme is not https / a bounded
//     `data:image/*` payload.
//   - T4 — a `blendMode` / `mask.type` / `mask.op` / `objectFit` outside the
//     closed enum.
//   - #K — a `mask.source.kind === "shape"` whose `ref` names no node id in
//     the bundle, or a mask→shape→mask cycle.
//   - T5 — the complexity budget: too many blend-bearing nodes, mask nesting
//     too deep, too many image nodes, or too many total nodes.
//
// The blur cap is NOT re-opened here (owned by the filter clamp upstream).
// A rejected URL is NEVER echoed into a message (Bastion R9).

import type { AssetsDecl, Fill, LSMLMask, PrimitiveNode, SceneBundle } from "~shared/lsml-types";

export interface GateError {
  code:
    | "GATE_HOST_NOT_ALLOWED"
    | "GATE_SCHEME_NOT_ALLOWED"
    | "GATE_ENUM_NOT_ALLOWED"
    | "GATE_DANGLING_MASK_REF"
    | "GATE_MASK_CYCLE"
    | "GATE_BUDGET_EXCEEDED";
  path: string;
  message: string;
}

/** Complexity budget (T5). Mirrors the Orion gate's DefaultAuthoringBudget
 *  verbatim — the two MUST agree or figma would pass a bundle Orion refuses.
 *  Numbers are 20–25× the real 817:3 ceiling (see authoring_gate.go). */
export interface AuthoringBudget {
  maxBlendNodes: number;
  maxMaskDepth: number;
  maxImageNodes: number;
  maxTotalNodes: number;
}

export const DEFAULT_BUDGET: AuthoringBudget = {
  maxBlendNodes: 512,
  maxMaskDepth: 16,
  maxImageNodes: 4096,
  maxTotalNodes: 16384,
};

// Closed enums (T4) — single source of truth is the spec; these mirror
// `@lumencast/compiler` lsml-1_2.ts and the Orion gate.
const BLEND_MODES = new Set<string>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);
const OBJECT_FITS = new Set<string>(["cover", "contain", "fill", "none", "scale-down"]);
const MASK_TYPES = new Set<string>(["alpha", "luminance"]);
const MASK_OPS = new Set<string>(["intersect", "subtract", "union"]);

const MAX_URL_LEN = 8192; // mirrors host-allow.ts MAX_URL_LEN.
const ALLOWED_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon);base64,/i;

/** Run the authoring gate over a bundle with the default budget. */
export function gateBundle(bundle: SceneBundle): GateError[] {
  return gateBundleWithBudget(bundle, DEFAULT_BUDGET);
}

export function gateBundleWithBudget(bundle: SceneBundle, budget: AuthoringBudget): GateError[] {
  const errors: GateError[] = [];
  const allowed = normaliseAllowed(bundle.assets);

  const ids = new Set<string>();
  const byId = new Map<string, PrimitiveNode>();
  collectIds(bundle.layout, ids, byId);

  const counts = { total: 0, blend: 0, image: 0 };
  walk(bundle.layout, "/layout", { errors, allowed, ids, byId, budget, counts });

  if (counts.total > budget.maxTotalNodes) {
    errors.push(budgetErr(`node count ${counts.total} exceeds budget ${budget.maxTotalNodes}`));
  }
  if (counts.blend > budget.maxBlendNodes) {
    errors.push(
      budgetErr(`blend-bearing node count ${counts.blend} exceeds budget ${budget.maxBlendNodes}`),
    );
  }
  if (counts.image > budget.maxImageNodes) {
    errors.push(
      budgetErr(`image node count ${counts.image} exceeds budget ${budget.maxImageNodes}`),
    );
  }
  return errors;
}

function budgetErr(message: string): GateError {
  return { code: "GATE_BUDGET_EXCEEDED", path: "/layout", message: `${message} (T5)` };
}

function normaliseAllowed(assets: AssetsDecl | undefined): string[] {
  if (!assets?.allowedHosts) return [];
  return assets.allowedHosts.map((h) => h.trim().toLowerCase());
}

function collectIds(node: PrimitiveNode, ids: Set<string>, byId: Map<string, PrimitiveNode>): void {
  const n = node as PrimitiveNode & { id?: string; children?: PrimitiveNode[] };
  if (typeof n.id === "string" && n.id.length > 0) {
    ids.add(n.id);
    byId.set(n.id, node);
  }
  if (Array.isArray(n.children)) {
    for (const c of n.children) collectIds(c, ids, byId);
  }
}

interface WalkCtx {
  errors: GateError[];
  allowed: string[];
  ids: Set<string>;
  byId: Map<string, PrimitiveNode>;
  budget: AuthoringBudget;
  counts: { total: number; blend: number; image: number };
}

function walk(node: PrimitiveNode, path: string, ctx: WalkCtx): void {
  ctx.counts.total++;
  const n = node as PrimitiveNode & {
    id?: string;
    kind?: string;
    blendMode?: string;
    objectFit?: string;
    src?: string;
    mask?: LSMLMask;
    fills?: Fill[];
    backgrounds?: Fill[];
    children?: PrimitiveNode[];
  };

  let bearsBlend = false;
  if (n.blendMode !== undefined) {
    bearsBlend = true;
    if (!BLEND_MODES.has(n.blendMode)) {
      ctx.errors.push(enumErr(`${path}/blendMode`, "blendMode", n.blendMode));
    }
  }
  if (n.objectFit !== undefined && !OBJECT_FITS.has(n.objectFit)) {
    ctx.errors.push(enumErr(`${path}/objectFit`, "objectFit", n.objectFit));
  }
  if (typeof n.src === "string") checkSrc(n.src, `${path}/src`, ctx);
  if (n.kind === "image") ctx.counts.image++;

  bearsBlend = checkFills(n.fills, `${path}/fills`, ctx) || bearsBlend;
  bearsBlend = checkFills(n.backgrounds, `${path}/backgrounds`, ctx) || bearsBlend;
  if (bearsBlend) ctx.counts.blend++;

  if (n.mask) {
    const chain = typeof n.id === "string" && n.id.length > 0 ? [n.id] : [];
    checkMask(n.mask, `${path}/mask`, 0, chain, ctx);
  }

  if (Array.isArray(n.children)) {
    n.children.forEach((c, i) => walk(c, `${path}/children/${i}`, ctx));
  }
}

function checkFills(fills: Fill[] | undefined, path: string, ctx: WalkCtx): boolean {
  if (!Array.isArray(fills)) return false;
  let bearsBlend = false;
  fills.forEach((f, i) => {
    const fp = `${path}/${i}`;
    const fill = f as Fill & {
      blendMode?: string;
      objectFit?: string;
      kind?: string;
      src?: string;
    };
    if (fill.blendMode !== undefined) {
      bearsBlend = true;
      if (!BLEND_MODES.has(fill.blendMode)) {
        ctx.errors.push(enumErr(`${fp}/blendMode`, "fill blendMode", fill.blendMode));
      }
    }
    if (fill.objectFit !== undefined && !OBJECT_FITS.has(fill.objectFit)) {
      ctx.errors.push(enumErr(`${fp}/objectFit`, "fill objectFit", fill.objectFit));
    }
    if (fill.kind === "image" && typeof fill.src === "string") {
      checkSrc(fill.src, `${fp}/src`, ctx);
    }
  });
  return bearsBlend;
}

function checkMask(
  mask: LSMLMask,
  path: string,
  maskDepth: number,
  maskChain: string[],
  ctx: WalkCtx,
): void {
  const m = mask as LSMLMask & { type?: string; op?: string };
  if (m.type !== undefined && !MASK_TYPES.has(m.type)) {
    ctx.errors.push(enumErr(`${path}/type`, "mask.type", m.type));
  }
  if (m.op !== undefined && !MASK_OPS.has(m.op)) {
    ctx.errors.push(enumErr(`${path}/op`, "mask.op", m.op));
  }
  if (maskDepth + 1 > ctx.budget.maxMaskDepth) {
    ctx.errors.push({
      code: "GATE_BUDGET_EXCEEDED",
      path,
      message: `mask nesting depth ${maskDepth + 1} exceeds budget ${ctx.budget.maxMaskDepth} (T5)`,
    });
    return;
  }
  const source = mask.source;
  if (!source) return;
  if (source.kind === "image") {
    if (typeof source.src === "string") checkSrc(source.src, `${path}/source/src`, ctx);
    return;
  }
  // kind === "shape"
  const ref = source.ref;
  if (typeof ref !== "string" || ref.length === 0) {
    ctx.errors.push({
      code: "GATE_DANGLING_MASK_REF",
      path: `${path}/source/ref`,
      message: "mask shape source has no ref (#K)",
    });
    return;
  }
  if (!ctx.ids.has(ref)) {
    ctx.errors.push({
      code: "GATE_DANGLING_MASK_REF",
      path: `${path}/source/ref`,
      message: `mask references unknown node id "${ref}" (#K)`,
    });
    return;
  }
  if (maskChain.includes(ref)) {
    ctx.errors.push({
      code: "GATE_MASK_CYCLE",
      path: `${path}/source/ref`,
      message: `mask cycle through node id "${ref}" (#K)`,
    });
    return;
  }
  const target = ctx.byId.get(ref) as (PrimitiveNode & { mask?: LSMLMask }) | undefined;
  if (target?.mask) {
    checkMask(target.mask, `${path}/source→${ref}/mask`, maskDepth + 1, [...maskChain, ref], ctx);
  }
}

/** T2 scheme then T1 host, mirroring host-allow.ts + the Orion gate. The
 *  rejected URL is never put into the message (Bastion R9). */
function checkSrc(raw: string, path: string, ctx: WalkCtx): void {
  if (raw.length === 0 || raw.length > MAX_URL_LEN) {
    ctx.errors.push(schemeErr(path, "asset url is empty or exceeds the length cap"));
    return;
  }
  if (ALLOWED_DATA_IMAGE_RE.test(raw)) return; // bounded inline raster.
  if (/^data:/i.test(raw)) {
    ctx.errors.push(schemeErr(path, "data: url is not a bounded image/* payload"));
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    ctx.errors.push(schemeErr(path, "asset url is not a parseable absolute URL"));
    return;
  }
  if (parsed.protocol !== "https:") {
    ctx.errors.push(schemeErr(path, "asset url scheme is not https"));
    return;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    ctx.errors.push(hostErr(path, "asset url carries userinfo"));
    return;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "" || !ctx.allowed.includes(host)) {
    ctx.errors.push(hostErr(path, "asset host is not in assets.allowedHosts"));
  }
}

function enumErr(path: string, label: string, value: string): GateError {
  return {
    code: "GATE_ENUM_NOT_ALLOWED",
    path,
    message: `${label} "${value}" is not a recognised value (T4)`,
  };
}
function schemeErr(path: string, message: string): GateError {
  return { code: "GATE_SCHEME_NOT_ALLOWED", path, message: `${message} (T2)` };
}
function hostErr(path: string, message: string): GateError {
  return { code: "GATE_HOST_NOT_ALLOWED", path, message: `${message} (T1)` };
}
