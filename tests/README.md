# tests

```
tests/
├── unit/
│   ├── mapping/        per-primitive Figma node → LSML output
│   ├── export/         bundle assembly, canonicalization, validation
│   ├── import/         LSML → Figma node spec (mocked Figma API)
│   └── bindings.test.ts  [bind:path] parsing
├── integration/
│   └── roundtrip.test.ts  export(import(export(fig))) === export(fig)
└── fixtures/
    ├── figma/          JSON dumps of Figma node trees (no .fig files)
    └── lsml/           expected LSML output per fixture
```

## Mocking Figma

Unit tests run in Node + happy-dom. The Figma plugin sandbox is mocked
via a small in-memory implementation under `tests/_mocks/figma-api.ts`
(landed in Phase 1). The mock implements the subset of the Figma API
that the plugin uses : node creation, `getSharedPluginData`,
`setSharedPluginData`, `currentPage.selection`.

## Adding a fixture

When introducing a new mapping rule, add a pair :

- `tests/fixtures/figma/<name>.json` — node tree dump
- `tests/fixtures/lsml/<name>.lsml` — expected output

The integration round-trip test discovers fixtures automatically.
