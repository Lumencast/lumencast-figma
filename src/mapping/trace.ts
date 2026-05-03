// Mapping trace recorder. Each call to `walk()` in traverse.ts pushes a
// structured entry describing the dispatch decision, so a downstream
// consumer (the export pipeline) can serialise the run as JSON for the
// `_debug/mapping-trace.json` artefact in the .lsmlz archive.
//
// The trace is intentionally small — one entry per node visit, no nested
// payloads, so a 1000-node frame still produces a tiny file.

export interface TraceEntry {
  /** Sequence index, monotonic from 0. */
  seq: number;
  /** Depth in the SceneNode tree (root = 0). */
  depth: number;
  /** Figma node type (TEXT / RECTANGLE / FRAME / BOOLEAN_OPERATION / …). */
  type: string;
  /** Figma node id. */
  id: string;
  /** Figma layer name. */
  name: string;
  /** What the walker decided to do with the node. */
  action:
    | "skip-invisible"
    | "skip-operator-input"
    | "skip-unsupported"
    | "map-text"
    | "map-image"
    | "map-shape"
    | "map-instance"
    | "walk-container"
    | "error";
  /** Free-form note (e.g. node geometry kind, the LSML primitive emitted). */
  note?: string;
  /** When `action === "error"`, the exception message. */
  error?: string;
}

export interface MappingTrace {
  entries: TraceEntry[];
  /** Counter shared across all `record()` calls. */
  push(entry: Omit<TraceEntry, "seq">): void;
}

export function createMappingTrace(): MappingTrace {
  const entries: TraceEntry[] = [];
  return {
    entries,
    push(entry) {
      entries.push({ seq: entries.length, ...entry });
    },
  };
}
