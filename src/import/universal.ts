// Apply LSML universal props (§5.4) onto a created Figma node.

import type { ImportBaseNode } from "./figma-api";
import type { UniversalProps } from "~shared/lsml-types";

export function applyUniversal(node: ImportBaseNode, props: UniversalProps): void {
  if (props.visible === false) node.visible = false;
  if (props.opacity !== undefined) node.opacity = props.opacity;
  if (props.rotation !== undefined) node.rotation = props.rotation;
  // sizing is applied later when the parent attaches the child (it depends on
  // the parent's auto-layout context). Builders forward it via metadata
  // when not in an auto-layout parent.
}
