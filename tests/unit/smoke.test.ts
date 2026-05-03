// Smoke test — confirms the test runner is wired and shared constants
// import correctly. Real coverage lands with each phase.

import { describe, expect, it } from "vitest";
import { LSML_VERSION, LSML_FILE_EXTENSION, BIND_LAYER_PREFIX_RE } from "~shared/constants";

describe("shared constants", () => {
  it("targets LSML 1.1", () => {
    expect(LSML_VERSION).toBe("1.1");
  });

  it("uses .lsml as the canonical file extension", () => {
    expect(LSML_FILE_EXTENSION).toBe(".lsml");
  });

  it("matches a [bind:path] layer name prefix", () => {
    const m = "[bind:players.0.score] Player 1 Score".match(BIND_LAYER_PREFIX_RE);
    expect(m?.[1]).toBe("players.0.score");
    expect(m?.[2]).toBe("Player 1 Score");
  });

  it("does not match a bare layer name", () => {
    const m = "Player 1 Score".match(BIND_LAYER_PREFIX_RE);
    expect(m).toBeNull();
  });
});
