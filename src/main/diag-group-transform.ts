// Diagnostic ad-hoc : exactly what does Figma do when we set
// `node.relativeTransform = flipMatrix` on a real GroupNode created via
// `figma.group()` ?
//
// Question we want answered : after the setter, do
//   1. group.width / group.height update to reflect the flipped LOCAL bbox ?
//   2. children's absoluteBoundingBox shift (i.e. did the flip propagate
//      visually) ?
//   3. children's node.x / relativeTransform stay stable ?
//
// Output is dumped THREE WAYS so at least one survives :
//   - figma.notify() toast (start + end)
//   - console.log (if Plugin Console reachable)
//   - A `_diag_output_` TextNode placed on the canvas (always reachable —
//     copy its text and paste back into the chat)
//
// Wired automatically from `main/index.ts`. To DISABLE : remove the import
// + call from main/index.ts. The script also leaves a `_diag_root_` Frame
// and a `_diag_output_` TextNode on the canvas — delete manually after
// capture.

export async function runDiagGroupTransform(): Promise<void> {
  /* eslint-disable no-console */
  const log: string[] = [];
  const out = (line: string): void => {
    log.push(line);
    console.log(line);
  };

  try {
    figma.notify("DIAG: starting…", { timeout: 1500 });
    out("=== DIAG: relativeTransform on GroupNode ===");

    // 1. Setup : a parent FRAME at world origin so the test starts in a
    //    known coord system.
    const root = figma.createFrame();
    root.name = "_diag_root_";
    (root as unknown as { fills: unknown[] }).fills = [];
    root.x = 0;
    root.y = 0;
    root.resize(1000, 1000);
    figma.currentPage.appendChild(root);

    // 2. 3 rectangles inside the frame at known positions, mimicking the
    //    Calque structure (3 vectors with one smaller "tail" rect on the
    //    right). Sizes mirror legacy Vector dims so the math is comparable.
    const positions: { x: number; y: number; w: number; h: number; color: RGB }[] = [
      { x: 100, y: 100, w: 46, h: 58, color: { r: 1, g: 0, b: 0 } },
      { x: 130, y: 100, w: 46, h: 58, color: { r: 0, g: 1, b: 0 } },
      { x: 160, y: 100, w: 40, h: 36, color: { r: 0, g: 0, b: 1 } },
    ];
    const rects: RectangleNode[] = [];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const r = figma.createRectangle();
      r.name = `r${i}`;
      r.x = p.x;
      r.y = p.y;
      r.resize(p.w, p.h);
      r.fills = [{ type: "SOLID", color: p.color }];
      root.appendChild(r);
      rects.push(r);
    }

    // 3. Group the rectangles. `figma.group()` returns a fresh GroupNode
    //    whose bbox is the children-union AABB (~100 wide, 58 tall).
    const group = figma.group(rects, root) as GroupNode;
    group.name = "diag-group";

    // 4. Snapshot BEFORE.
    const before = {
      group: snapshot(group),
      children: group.children.map((c) => snapshot(c as SceneNode)),
    };
    out("");
    out("--- BEFORE setRelativeTransform ---");
    out(`group: ${pretty(before.group)}`);
    for (let i = 0; i < before.children.length; i++) {
      out(`  child[${i}]: ${pretty(before.children[i]!)}`);
    }

    // 5. Apply a flip matrix (reflection on Y axis = vertical flip around
    //    the group's top edge ; det = -1, equivalent shape to Group
    //    2087326235's transform).
    const gx = group.x;
    const gy = group.y;
    const gh = group.height;
    const flipMatrix: Transform = [
      [1, 0, gx],
      [0, -1, gy + gh],
    ];
    out("");
    out("--- ATTEMPTING group.relativeTransform = flipMatrix ---");
    out(`Matrix: ${JSON.stringify(flipMatrix)}`);
    let setError: string | undefined;
    try {
      (group as unknown as { relativeTransform: Transform }).relativeTransform = flipMatrix;
    } catch (e) {
      setError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    out(`setError: ${setError ?? "none"}`);

    // 6. Snapshot AFTER.
    const after = {
      group: snapshot(group),
      children: group.children.map((c) => snapshot(c as SceneNode)),
    };
    out("");
    out("--- AFTER setRelativeTransform ---");
    out(`group: ${pretty(after.group)}`);
    for (let i = 0; i < after.children.length; i++) {
      out(`  child[${i}]: ${pretty(after.children[i]!)}`);
    }

    // 7. Diff each field side-by-side.
    out("");
    out("--- DIFF (before → after) ---");
    diffNode("group", before.group, after.group, out);
    for (let i = 0; i < before.children.length; i++) {
      diffNode(
        `child[${i}] ${before.children[i]!.name}`,
        before.children[i]!,
        after.children[i]!,
        out,
      );
    }

    out("");
    out("=== END DIAG ===");

    // 8. Dump everything into a TextNode on the canvas so we can read the
    //    output even when the Plugin Console is unreachable.
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const txt = figma.createText();
    txt.name = "_diag_output_";
    txt.fontName = { family: "Inter", style: "Regular" };
    txt.fontSize = 11;
    txt.x = 1100;
    txt.y = 0;
    txt.characters = log.join("\n");
    figma.currentPage.appendChild(txt);

    figma.notify("DIAG: done — see `_diag_output_` text node on canvas", {
      timeout: 4000,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("[diag] crash:", msg);
    figma.notify(`DIAG crashed: ${msg.slice(0, 120)}`, { error: true, timeout: 6000 });
    // Best-effort dump of whatever we collected so far.
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const txt = figma.createText();
      txt.name = "_diag_output_crashed_";
      txt.fontName = { family: "Inter", style: "Regular" };
      txt.fontSize = 11;
      txt.x = 1100;
      txt.y = 0;
      txt.characters = `CRASHED: ${msg}\n\nLog so far:\n${log.join("\n")}`;
      figma.currentPage.appendChild(txt);
    } catch {
      // give up
    }
  }
  /* eslint-enable no-console */
}

interface NodeSnapshot {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  relativeTransform: Transform;
  absoluteBoundingBox: Rect | null;
}

function snapshot(n: SceneNode): NodeSnapshot {
  const o = n as unknown as {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    relativeTransform: Transform;
    absoluteBoundingBox: Rect | null;
  };
  return {
    type: n.type,
    name: n.name,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    rotation: o.rotation,
    relativeTransform: JSON.parse(JSON.stringify(o.relativeTransform)) as Transform,
    absoluteBoundingBox: o.absoluteBoundingBox
      ? (JSON.parse(JSON.stringify(o.absoluteBoundingBox)) as Rect)
      : null,
  };
}

function pretty(s: NodeSnapshot): string {
  return JSON.stringify(s);
}

function diffNode(
  label: string,
  b: NodeSnapshot,
  a: NodeSnapshot,
  out: (line: string) => void,
): void {
  const changes: string[] = [];
  const keys = Object.keys(b) as (keyof NodeSnapshot)[];
  for (const k of keys) {
    const bv = JSON.stringify(b[k]);
    const av = JSON.stringify(a[k]);
    if (bv !== av) changes.push(`${k}: ${bv} → ${av}`);
  }
  if (changes.length === 0) {
    out(`${label}: no change`);
  } else {
    out(`${label}:`);
    for (const c of changes) out(`  ${c}`);
  }
}
