// Inspect the current Figma selection and produce a SelectionSummary
// that the UI can render. Read-only — never mutates the document.

import type { SelectionSummary } from "./messages";

export function summarizeSelection(): SelectionSummary {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    return { selected: 0, exportable: false, reason: "Select a frame to export." };
  }

  if (selection.length > 1) {
    return {
      selected: selection.length,
      exportable: false,
      reason: "Select exactly one frame. Multi-frame export ships in v0.2.",
    };
  }

  const node = selection[0];
  if (!node) {
    return { selected: 0, exportable: false, reason: "Selection became empty." };
  }

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
    return {
      selected: 1,
      exportable: false,
      reason: `Selected node is a ${node.type}. Select a FRAME, COMPONENT, or INSTANCE.`,
    };
  }

  const counts = countDescendants(node);

  return {
    selected: 1,
    exportable: true,
    frame: {
      id: node.id,
      name: node.name,
      width: node.width,
      height: node.height,
      nodeCount: counts.total,
      primitiveCounts: counts.byKind,
    },
  };
}

interface DescendantCounts {
  total: number;
  byKind: Record<string, number>;
}

function countDescendants(root: SceneNode): DescendantCounts {
  const counts: DescendantCounts = { total: 0, byKind: {} };
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    counts.total += 1;
    counts.byKind[node.type] = (counts.byKind[node.type] ?? 0) + 1;
    if ("children" in node) {
      for (const child of node.children) stack.push(child);
    }
  }
  return counts;
}
