// LSML 1.1 type surface for the Figma plugin.
//
// Source of truth : `lumencast-protocol/spec/LSML-1.md` (v1.1) and
// `lumencast-protocol/spec/schema.json`. The shapes here mirror the
// spec exactly. When @lumencast/compiler ships its own canonical
// types, this file becomes a re-export — single source of truth across
// the JS ecosystem.
//
// Naming notes :
//   - The top-level field is `lsml`, NOT `lumen_schema`. (LSML §1)
//   - Field names use the spec's casing exactly (`scene_id`, `scene_version`,
//     `media_kind`, `angle_deg`, `cornerRadius`, `bindUniversal`, etc.).
//   - All 1.1-only fields are commented "(1.1+)".

// ---------- Primitives ----------

export type LeafPath = string;
export type SceneId = string;
export type SceneVersion = string; // "sha256:<64 hex>"

/**
 * The closed core catalog of LSML 1.1. Vendor-prefixed primitives use the
 * `x-<vendor>.<name>` form (LSML §17.1) and are typed separately as strings.
 */
export type CorePrimitiveKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat"
  | "instance"; // 1.1+

/** Vendor-prefixed primitive kind, per LSML §17.1.1 */
export type VendorPrimitiveKind = `x-${string}.${string}`;

export type PrimitiveKind = CorePrimitiveKind | VendorPrimitiveKind;

// ---------- Bind / style / animate ----------

export type Bind = Record<string, LeafPath>;
export type BindStyle = Record<string, LeafPath>;
export type BindAnimate = Record<string, LeafPath>;
export type BindUniversal = Partial<Record<"visible" | "opacity" | "rotation", LeafPath>>;

// ---------- Universal props (1.1+, LSML §5.4) ----------

export type SizingMode = "fixed" | "hug" | "fill";

export interface SizingPair {
  x: SizingMode;
  y: SizingMode;
}

export interface UniversalProps {
  /** Absolute position relative to the parent's coordinate origin.
   *  Universal in 1.1+ — honoured when the parent is a frame in absolute
   *  mode ; ignored under stack/grid layouts. (LSML §5.4) */
  position?: { x: number; y: number };
  /** Conditional rendering. (1.1+) */
  visible?: boolean;
  /** Auto-layout sizing intent. (1.1+) */
  sizing?: SizingPair;
  /** Composite alpha. (1.1+) */
  opacity?: number;
  /** Static rotation in degrees, applied around primitive centre. (1.1+) */
  rotation?: number;
}

// ---------- Fill / stroke (LSML §4.12) ----------

export interface GradientStop {
  offset: number; // 0..1
  color: string; // CSS color
  opacity?: number; // 0..1
}

export interface SolidFill {
  kind: "solid";
  color: string;
  opacity?: number;
}

export interface LinearGradientFill {
  kind: "linear-gradient";
  angle_deg?: number; // default 0 = bottom-to-top
  stops: GradientStop[];
  opacity?: number;
}

export interface RadialGradientFill {
  kind: "radial-gradient";
  center?: { x: number; y: number }; // default {0.5, 0.5}
  radius?: number; // default 0.5
  stops: GradientStop[];
  opacity?: number;
}

export type Fill = SolidFill | LinearGradientFill | RadialGradientFill;

export interface Stroke {
  color: string;
  width: number;
}

// ---------- Animate / keyframes (LSML §6) ----------

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";

export interface Transition {
  easing: Easing;
  duration?: number; // ms — required for tween easings, forbidden for spring
  stiffness?: number; // spring only, default 170
  damping?: number; // spring only, default 26
  mass?: number; // spring only, default 1
}

export interface Transform {
  translate?: [number, number];
  scale?: number | [number, number];
  rotate?: number;
}

export interface Filter {
  blur?: number;
  brightness?: number;
}

export interface AnimateBlock {
  transition?: Transition;
  transform?: Transform;
  opacity?: number;
  filter?: Filter;
}

export interface KeyframeStep {
  at: number; // 0..1
  transform?: Transform;
  opacity?: number;
  filter?: Filter;
}

export interface KeyframesBlock {
  /** Optional LeafPath whose value-change replays the sequence. */
  key?: LeafPath;
  steps: KeyframeStep[];
  duration_ms: number;
  easing?: Easing;
}

// ---------- Common base ----------

export interface BasePrimitive extends UniversalProps {
  kind: PrimitiveKind;
  bind?: Bind;
  bindStyle?: BindStyle;
  bindAnimate?: BindAnimate;
  bindUniversal?: BindUniversal;
  animate?: AnimateBlock;
  keyframes?: KeyframesBlock;
  /** Free-form authoring metadata. Runtime ignores. */
  metadata?: Record<string, unknown>;
}

// ---------- Stack (LSML §4.1) ----------

export interface StackPrimitive extends BasePrimitive {
  kind: "stack";
  direction: "horizontal" | "vertical";
  gap?: number;
  /** (1.1+) */
  crossGap?: number;
  /** (1.1+) */
  wrap?: boolean;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  padding?: number | [number, number, number, number];
  rtl?: "auto" | boolean;
  /** (1.1+) */
  stagger_ms?: number;
  children: PrimitiveNode[];
}

// ---------- Grid (LSML §4.2) ----------

export type GridTrack = number | string; // integer count or explicit track spec

export interface GridPrimitive extends BasePrimitive {
  kind: "grid";
  columns: number | GridTrack[];
  rows?: number | GridTrack[];
  gap?: number | [number, number];
  padding?: number | [number, number, number, number];
  children: PrimitiveNode[];
}

// ---------- Frame (LSML §4.3) ----------

export interface FramePrimitive extends BasePrimitive {
  kind: "frame";
  size?: { w: number; h: number }; // required for root, optional nested
  // `position` is inherited from UniversalProps — kept here in the spec text
  // for back-compat clarity (LSML §4.3) but uses the same field.
  /** Clip children that overflow the declared `size`. Default `true`. (1.1+) */
  clipsContent?: boolean;
  /** Single solid background. Mutually exclusive with `backgrounds`. */
  background?: string;
  /** Stacked backgrounds, top-to-bottom. (1.1+) Mutually exclusive with `background`. */
  backgrounds?: Fill[];
  children: PrimitiveNode[];
}

// ---------- Text (LSML §4.4) ----------

export interface TextStyle {
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  fontStyle?: "normal" | "italic";
  textDecoration?: string;
  /** Case transform applied at paint time (LSML §4.4.1). The literal
   *  `characters` are stored as authored ; the renderer applies the
   *  transform. Authoring tools mapping Figma `textCase` / Sketch
   *  `textTransform` MUST use this field, not metadata.* */
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export type TextFormatKind = "string" | "number" | "currency" | "date" | "time" | "relative-time";

export interface TextFormat {
  kind: TextFormatKind;
  options?: Record<string, unknown>; // pass-through to Intl.*
}

export interface TextPrimitive extends BasePrimitive {
  kind: "text";
  /** Either `bind.value` OR `i18n` — mutually exclusive. */
  bind?: Bind & { value?: LeafPath };
  /** Renders the localised string for the active locale. (LSML §12) */
  i18n?: string;
  style?: TextStyle;
  format?: TextFormat;
  maxLines?: number;
}

// ---------- Image (LSML §4.5) ----------

export interface ImagePrimitive extends BasePrimitive {
  kind: "image";
  /** `bind.src` is required per LSML §4.5 + schema. The asset URL is
   *  expressed via a LeafPath ; for content-addressed local assets the
   *  plugin synthesises a leaf path under `__lit.image.<id>` and plants the
   *  resolved asset path under `bundle.defaults`. */
  bind: Bind & { src: LeafPath };
  /** Required for accessibility (LSML §13). Empty string allowed for decorative. */
  alt: string;
  size: { w: number; h: number };
  fit?: "contain" | "cover" | "fill" | "none";
}

// ---------- Shape (LSML §4.6) ----------

export interface ShapePathEntry {
  data: string; // SVG path 'd'
  windingRule?: "NONZERO" | "EVENODD";
}

export interface ShapePrimitive extends BasePrimitive {
  kind: "shape";
  geometry: "rect" | "circle" | "path";
  size?: { w: number; h: number }; // required for rect/circle
  /** Single-path shorthand. Mutually exclusive with `paths`. */
  pathData?: string;
  /** Multi-subpath geometry with per-subpath winding rule. Mutually
   *  exclusive with `pathData`. (1.1+, LSML §4.6) */
  paths?: ShapePathEntry[];
  /** Single solid fill. Mutually exclusive with `fills`. */
  fill?: string;
  /** Stacked fills, top-to-bottom. (1.1+) */
  fills?: Fill[];
  /** Single stroke. Mutually exclusive with `strokes`. */
  stroke?: Stroke;
  /** (1.1+) */
  strokes?: Stroke[];
  /** rect only */
  cornerRadius?: number;
  ariaLabel?: string;
}

// ---------- Media (LSML §4.7) ----------

export interface MediaPrimitive extends BasePrimitive {
  kind: "media";
  media_kind: "video" | "audio";
  bind?: Bind & { src?: LeafPath };
  src?: string;
  controls?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  size?: { w: number; h: number }; // required when media_kind = video
}

// ---------- Repeat (LSML §4.8) ----------

export interface RepeatPrimitive extends BasePrimitive {
  kind: "repeat";
  bind: { items: LeafPath };
  scope: string;
  key?: string; // LeafPath template
  template: PrimitiveNode;
  limit?: number;
  /** (1.1+) Per-iteration animation delay in ms. */
  stagger_ms?: number;
}

// ---------- Instance (LSML §4.9, 1.1+) ----------

export interface InstancePrimitive extends BasePrimitive {
  kind: "instance";
  scene_id: SceneId;
  scene_version: SceneVersion;
  /** Static params. Mutually exclusive per-key with bindParams. */
  params?: Record<string, unknown>;
  /** Reactive params via LeafPath bindings. */
  bindParams?: Record<string, LeafPath>;
  fit?: "contain" | "cover" | "fill" | "none";
  size?: { w: number; h: number };
  // `position` inherited from UniversalProps.
}

// ---------- Vendor primitive (LSML §17.1, 1.1+) ----------

export interface VendorPrimitive extends BasePrimitive {
  kind: VendorPrimitiveKind;
  /** Vendor-defined props are typed as unknown — vendor's plugin is the contract. */
  [vendorProp: string]: unknown;
}

export type PrimitiveNode =
  | StackPrimitive
  | GridPrimitive
  | FramePrimitive
  | TextPrimitive
  | ImagePrimitive
  | ShapePrimitive
  | MediaPrimitive
  | RepeatPrimitive
  | InstancePrimitive
  | VendorPrimitive;

// ---------- Operator inputs (LSML §8) ----------

export type OperatorInputType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "color"
  | "date"
  | "time"
  | "path-ref"
  | "image-ref";

export type OperatorRole = "operator" | "service";

export interface StringConstraints {
  maxLength?: number;
  minLength?: number;
  pattern?: string;
}

export interface NumberConstraints {
  min?: number;
  max?: number;
  step?: number;
}

export interface EnumConstraints {
  values: string[];
}

export interface DateTimeConstraints {
  min?: string; // ISO 8601
  max?: string; // ISO 8601
}

export type OperatorInputConstraints =
  | StringConstraints
  | NumberConstraints
  | EnumConstraints
  | DateTimeConstraints
  | Record<string, never>;

export interface OperatorInputSpec {
  /** Must start with `__inputs.` */
  path: LeafPath;
  label: string;
  type: OperatorInputType;
  constraints?: OperatorInputConstraints;
  writable_by: OperatorRole[];
  group?: string;
}

// ---------- External adapters (LSML §9) ----------

/** Closed list of standard adapter kinds (LSML §9.1). */
export type StandardAdapterKind =
  | "http_poll"
  | "websocket_subscribe"
  | "pg_listen"
  | "webhook_receive"
  | "cron";

/** Vendor-prefixed adapter kind, per LSML §17.2. */
export type VendorAdapterKind = `x-${string}.${string}`;

export type AdapterKind = StandardAdapterKind | VendorAdapterKind;

export interface AdapterDecl {
  kind: AdapterKind;
  writes_to: LeafPath;
  /** Kind-specific configuration. The standard 5 have schemas under spec/adapters/. */
  [config: string]: unknown;
}

// ---------- Assets (LSML §11) ----------

export interface FontAsset {
  family: string;
  url: string;
  sha256?: string;
}

export interface AssetsDecl {
  /** Hostname patterns allowed for image/media URLs. */
  allowedHosts?: string[];
  fonts?: FontAsset[];
  preload?: string[];
}

// ---------- i18n (LSML §12) ----------

export interface I18nDecl {
  default_locale: string; // BCP 47
  locales: Record<string, Record<string, string>>;
}

// ---------- Top-level scene bundle (LSML §1) ----------

export interface SceneBundle {
  /** Recommended for on-disk bundles. URL of the JSON Schema this bundle conforms to. */
  $schema?: string;
  /** Schema version. The plugin emits `"1.1"` strictly. */
  lsml: "1.0" | "1.1";
  scene_id: SceneId;
  scene_version: SceneVersion;
  layout: PrimitiveNode;
  operator_inputs?: OperatorInputSpec[];
  external_adapters?: AdapterDecl[];
  defaults?: Record<LeafPath, unknown>;
  assets?: AssetsDecl;
  i18n?: I18nDecl;
  /** Authoring info. Runtime ignores. */
  metadata?: Record<string, unknown>;
  /** (1.1+) Capability profiles required for correct rendering. */
  profiles?: string[];
}
