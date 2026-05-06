// Async pre-pass : resolve every INSTANCE's mainComponent before the
// synchronous mapping walk runs. Required because `manifest.json`
// declares `documentAccess: "dynamic-page"`, where Figma's synchronous
// `node.mainComponent` getter throws — the API requires
// `node.getMainComponentAsync()` instead.
//
// We avoid threading async/await through the whole walk by collecting
// every INSTANCE id in a single sync sweep (only `node.type` is read,
// not `mainComponent`), then resolving all main components in parallel
// with `Promise.all`. The resulting Map is stashed in `MappingContext`
// and consulted by `isOperatorInputComponent` / `isOperatorInput`.
//
// Tests and mock surfaces that don't implement `getMainComponentAsync`
// fall through to the synchronous `mainComponent` accessor — keeps the
// vitest pipeline working without mock changes.

interface InstanceLike {
  type: string;
  id: string;
  children?: unknown[];
  getMainComponentAsync?: () => Promise<{ name: string } | null>;
  mainComponent?: { name: string } | null;
}

export type MainComponentMap = Map<string, { name: string } | null>;

/** Walk the subtree synchronously, collect every INSTANCE, then resolve
 *  their main components in parallel. Returns a Map<nodeId, mainComponent>
 *  the rest of the export pipeline can consult without re-touching the
 *  Figma async API. */
export async function preloadMainComponents(root: InstanceLike): Promise<MainComponentMap> {
  const instances: InstanceLike[] = [];
  const stack: InstanceLike[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === "INSTANCE") instances.push(n);
    const kids = n.children;
    if (Array.isArray(kids)) {
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i] as InstanceLike | undefined;
        if (c) stack.push(c);
      }
    }
  }
  const map: MainComponentMap = new Map();
  if (instances.length === 0) return map;
  await Promise.all(
    instances.map(async (n) => {
      if (typeof n.getMainComponentAsync === "function") {
        try {
          const mc = await n.getMainComponentAsync();
          map.set(n.id, mc);
        } catch {
          // Detached instance / cross-document ref / network hiccup —
          // record null so callers know the lookup was attempted.
          map.set(n.id, null);
        }
        return;
      }
      // Mock surfaces (vitest fixtures) expose the sync getter only.
      if (n.mainComponent !== undefined) map.set(n.id, n.mainComponent);
    }),
  );
  return map;
}

/** Convenience reader : returns the resolved mainComponent for a node id,
 *  falling back to the node's synchronous accessor when no map is given
 *  (test path) or the node wasn't pre-resolved. */
export function readMainComponent(
  node: InstanceLike,
  map: MainComponentMap | undefined,
): { name: string } | null | undefined {
  if (map && map.has(node.id)) return map.get(node.id);
  return node.mainComponent;
}
