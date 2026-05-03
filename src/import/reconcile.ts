// Import reconciliation strategy.
//
// v0.1 : overwrite. The importer simply appends a freshly-built root frame
// to `figma.currentPage`. If the user wants a clean state, they delete the
// previous one manually before importing.
//
// v0.3 (deferred) : visual diff between the new bundle and the existing
// frame ; merge in place ; preserve plugin data + ids where stable.

import type { ImportBaseNode, ImportFigmaApi } from "./figma-api";

export function reconcileAppend(api: ImportFigmaApi, root: ImportBaseNode): void {
  api.appendToPage(root);
}
