// OperatorInput component extraction.
//
// Convention : a Figma component (or instance of one) named `OperatorInput`
// declares a single operator-controllable leaf path in the bundle.
// Per-component plugin data, under the `lumencast.*` namespace :
//
//   lumencast.operator_input.path         "__inputs.show_title"
//   lumencast.operator_input.type         "string"
//   lumencast.operator_input.constraints  '{"maxLength": 80}'  (JSON string ; optional)
//   lumencast.operator_input.label        (optional ; defaults to the component's name)
//   lumencast.operator_input.writable_by  '["operator"]'  (optional ; defaults to ["operator"])
//   lumencast.operator_input.group        (optional)
//
// Per LSML §8.1, the 9 supported types in 1.1 are :
//   string, number, boolean, enum, color, date, time, path-ref, image-ref
//
// The scanner walks the export root subtree, finds OperatorInput components +
// instances, validates the metadata, and returns the spec list. Components
// whose metadata is missing or malformed produce a `INVALID_OPERATOR_INPUT`
// warning and are skipped.

import type {
  OperatorInputConstraints,
  OperatorInputSpec,
  OperatorInputType,
  OperatorRole,
} from "~shared/lsml-types";
import { OPERATOR_INPUT_COMPONENT_NAME, PLUGIN_DATA_NAMESPACE } from "~shared/constants";

const KEY_PATH = "operator_input.path";
const KEY_TYPE = "operator_input.type";
const KEY_CONSTRAINTS = "operator_input.constraints";
const KEY_LABEL = "operator_input.label";
const KEY_WRITABLE_BY = "operator_input.writable_by";
const KEY_GROUP = "operator_input.group";

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

const VALID_ROLES = new Set<OperatorRole>(["operator", "service"]);

const PATH_PREFIX = "__inputs.";

interface PluginDataHost {
  getSharedPluginData(namespace: string, key: string): string;
}

interface AnyFigmaNode {
  type: string;
  id: string;
  name: string;
  children?: AnyFigmaNode[];
  mainComponent?: { name: string } | null;
  getSharedPluginData?(namespace: string, key: string): string;
}

export interface ExtractWarning {
  code: "INVALID_OPERATOR_INPUT";
  message: string;
  nodeId: string;
}

export interface ExtractResult {
  inputs: OperatorInputSpec[];
  warnings: ExtractWarning[];
}

export function extractOperatorInputs(
  root: AnyFigmaNode,
  mainComponentMap?: Map<string, { name: string } | null>,
): ExtractResult {
  const inputs: OperatorInputSpec[] = [];
  const warnings: ExtractWarning[] = [];
  const seenPaths = new Set<string>();

  const stack: AnyFigmaNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (isOperatorInput(node, mainComponentMap)) {
      const spec = readSpec(node, warnings);
      if (spec) {
        if (seenPaths.has(spec.path)) {
          warnings.push({
            code: "INVALID_OPERATOR_INPUT",
            message: `Duplicate operator input path "${spec.path}" — only the first occurrence is kept.`,
            nodeId: node.id,
          });
        } else {
          seenPaths.add(spec.path);
          inputs.push(spec);
        }
      }
    }
    if (Array.isArray(node.children)) {
      // Push in reverse so we visit in document order.
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }

  return { inputs, warnings };
}

function isOperatorInput(
  node: AnyFigmaNode,
  mainComponentMap?: Map<string, { name: string } | null>,
): boolean {
  if (node.type === "COMPONENT") return node.name === OPERATOR_INPUT_COMPONENT_NAME;
  if (node.type === "INSTANCE") {
    // dynamic-page mode : `node.mainComponent` throws synchronously, so
    // we read the value the export pipeline pre-resolved into the map.
    // Mock surfaces (vitest) leave the map undefined and fall through to
    // the synchronous accessor.
    const mc = mainComponentMap?.has(node.id)
      ? mainComponentMap.get(node.id)
      : node.mainComponent;
    return mc?.name === OPERATOR_INPUT_COMPONENT_NAME;
  }
  return false;
}

function readPlugin(node: AnyFigmaNode, key: string): string | null {
  const host = node as unknown as PluginDataHost;
  if (typeof host.getSharedPluginData !== "function") return null;
  const v = host.getSharedPluginData(PLUGIN_DATA_NAMESPACE, key);
  return v === "" ? null : v;
}

function readSpec(node: AnyFigmaNode, warnings: ExtractWarning[]): OperatorInputSpec | null {
  const path = readPlugin(node, KEY_PATH);
  const typeRaw = readPlugin(node, KEY_TYPE);
  if (!path) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `OperatorInput at ${node.id} is missing lumencast.operator_input.path`,
      nodeId: node.id,
    });
    return null;
  }
  if (!path.startsWith(PATH_PREFIX)) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `OperatorInput path "${path}" must start with "${PATH_PREFIX}" (LSML §8).`,
      nodeId: node.id,
    });
    return null;
  }
  if (!typeRaw) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `OperatorInput at ${node.id} is missing lumencast.operator_input.type`,
      nodeId: node.id,
    });
    return null;
  }
  if (!VALID_TYPES.has(typeRaw as OperatorInputType)) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `OperatorInput type "${typeRaw}" is not one of the 9 LSML 1.1 types.`,
      nodeId: node.id,
    });
    return null;
  }
  const type = typeRaw as OperatorInputType;

  const label = readPlugin(node, KEY_LABEL) ?? deriveLabel(node);

  const constraintsRaw = readPlugin(node, KEY_CONSTRAINTS);
  let constraints: OperatorInputConstraints | undefined;
  if (constraintsRaw) {
    const parsed = parseConstraints(constraintsRaw, type, node.id, warnings);
    if (parsed === null) return null;
    constraints = parsed;
  }

  const writableRaw = readPlugin(node, KEY_WRITABLE_BY);
  const writable_by: OperatorRole[] | null = writableRaw
    ? parseWritableBy(writableRaw, node.id, warnings)
    : ["operator"];
  if (!writable_by) return null;

  const group = readPlugin(node, KEY_GROUP);

  const spec: OperatorInputSpec = {
    path,
    label,
    type,
    writable_by,
  };
  if (constraints !== undefined) spec.constraints = constraints;
  if (group) spec.group = group;
  return spec;
}

function deriveLabel(node: AnyFigmaNode): string {
  // Drop the convention-only component name prefix so the operator UI shows
  // a meaningful label. `OperatorInput` alone falls back to the path leaf.
  if (node.name === OPERATOR_INPUT_COMPONENT_NAME) return "Input";
  return node.name;
}

function parseConstraints(
  raw: string,
  type: OperatorInputType,
  nodeId: string,
  warnings: ExtractWarning[],
): OperatorInputConstraints | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `Invalid JSON in lumencast.operator_input.constraints at ${nodeId}.`,
      nodeId,
    });
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `Constraints must be a JSON object at ${nodeId}.`,
      nodeId,
    });
    return null;
  }
  // Per §8.1 the constraint key set is closed and type-scoped. We don't
  // duplicate full validation here (the schema validator catches it) but we
  // do reject obvious type mismatches for fast feedback.
  const allowed = ALLOWED_KEYS_BY_TYPE[type];
  for (const k of Object.keys(parsed as object)) {
    if (!allowed.has(k)) {
      warnings.push({
        code: "INVALID_OPERATOR_INPUT",
        message: `Constraint "${k}" is not valid for type "${type}" (LSML §8.1).`,
        nodeId,
      });
      return null;
    }
  }
  return parsed as OperatorInputConstraints;
}

const ALLOWED_KEYS_BY_TYPE: Record<OperatorInputType, Set<string>> = {
  string: new Set(["maxLength", "minLength", "pattern"]),
  number: new Set(["min", "max", "step"]),
  boolean: new Set(),
  enum: new Set(["values"]),
  color: new Set(),
  date: new Set(["min", "max"]),
  time: new Set(["min", "max"]),
  "path-ref": new Set(),
  "image-ref": new Set(),
};

function parseWritableBy(
  raw: string,
  nodeId: string,
  warnings: ExtractWarning[],
): OperatorRole[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `Invalid JSON in lumencast.operator_input.writable_by at ${nodeId}.`,
      nodeId,
    });
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    warnings.push({
      code: "INVALID_OPERATOR_INPUT",
      message: `writable_by must be a non-empty array of roles at ${nodeId}.`,
      nodeId,
    });
    return null;
  }
  for (const r of parsed) {
    if (typeof r !== "string" || !VALID_ROLES.has(r as OperatorRole)) {
      warnings.push({
        code: "INVALID_OPERATOR_INPUT",
        message: `Invalid role "${String(r)}" in writable_by at ${nodeId}.`,
        nodeId,
      });
      return null;
    }
  }
  return parsed as OperatorRole[];
}
