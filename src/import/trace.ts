// Import-side trace recorder. Mirror of `src/mapping/trace.ts` for the
// import pipeline — records every primitive's build attempt, success
// or failure, with the primitive's path in the bundle. The walker
// pushes one entry per node visit ; per-node errors are captured here
// (via `appendSafely`) so the post-import artefact reports them in
// the same place as the successful builds.
//
// Used by `src/import/index.ts` to populate `result.debugArtefacts.
// importTrace` ; the UI writes the trace to disk as
// `import-trace.json` after each import so users can ship diagnostics
// back without copy-pasting the Figma console.

export interface ImportTraceEntry {
  /** Sequence index, monotonic from 0. */
  seq: number;
  /** JSON-pointer-ish path from the bundle layout root, e.g.
   *  `$.children[5].children[2]`. */
  path: string;
  /** LSML primitive kind (`text` / `image` / `shape` / `frame` / `stack` /
   *  `instance`). */
  kind: string;
  /** Optional primitive label — `ariaLabel` or `alt` when present. */
  name?: string;
  /** What happened at this node. */
  action: "build-start" | "build-ok" | "build-failed" | "append-failed" | "warn";
  /** When `action` is `build-failed` or `append-failed`. */
  error?: string;
  /** When `action` is `warn`. */
  message?: string;
}

export interface ImportTrace {
  entries: ImportTraceEntry[];
  push(entry: Omit<ImportTraceEntry, "seq">): void;
}

export function createImportTrace(): ImportTrace {
  const entries: ImportTraceEntry[] = [];
  return {
    entries,
    push(entry) {
      entries.push({ seq: entries.length, ...entry });
    },
  };
}
