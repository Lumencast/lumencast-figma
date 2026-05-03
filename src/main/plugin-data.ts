// Typed read/write helpers around figma.*.{getPluginData,setPluginData}.
// Every key MUST live under the `lumencast` namespace — enforced here
// rather than on call sites.

import { PLUGIN_DATA_NAMESPACE, type PLUGIN_DATA_KEYS } from "~shared/constants";

type PluginDataKey = (typeof PLUGIN_DATA_KEYS)[keyof typeof PLUGIN_DATA_KEYS];

interface PluginDataHost {
  getSharedPluginData(namespace: string, key: string): string;
  setSharedPluginData(namespace: string, key: string, value: string): void;
}

export function readPluginData(node: PluginDataHost, key: PluginDataKey): string | null {
  const raw = node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, key);
  return raw === "" ? null : raw;
}

export function writePluginData(node: PluginDataHost, key: PluginDataKey, value: string): void {
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, key, value);
}

export function clearPluginData(node: PluginDataHost, key: PluginDataKey): void {
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, key, "");
}

export function readPluginDataJson<T>(node: PluginDataHost, key: PluginDataKey): T | null {
  const raw = readPluginData(node, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writePluginDataJson<T>(node: PluginDataHost, key: PluginDataKey, value: T): void {
  writePluginData(node, key, JSON.stringify(value));
}
