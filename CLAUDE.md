# CLAUDE.md

MCP server that bridges any OpenAPI 3.x REST API to MCP clients: it loads a spec, registers one tool
per operation, and executes the HTTP calls. Published to npm and the MCP Registry as
`mcp-openapi-bridge`. See `README.md` for usage and `docs/architecture.md` for design rationale.

## Commands

```bash
npm run build       # tsc → dist/
npm test            # vitest, fully mocked, no network
npm run lint        # eslint src/
npm run format      # prettier --check
npm run format:fix  # prettier --write
```

`npm run test:live` makes real network calls (public Petstore). Only run it when asked.

## Layout (`src/`)

| File | Responsibility |
|---|---|
| `index.ts` | Entry point. stdio by default; `MCP_TRANSPORT=http` starts the HTTP transport |
| `schema.ts` | Loads the spec, resolves `$ref`s |
| `tools.ts` | Turns operations into tool names, descriptions and argument schemas |
| `zod.ts` | JSON Schema → Zod (`schemaToZod`) |
| `executor.ts` | Builds URLs and performs the HTTP requests |
| `auth.ts` | Auth config and headers (`applyAuth`, `resolveAuthConfig`) |
| `types.ts` | Shared types |

Tests live in `src/__tests__/` and mock `fetch` with `vi.stubGlobal`.

## Conventions

- ESM with `module: Node16`: relative imports **must** end in `.js` (`import ... from "./tools.js"`).
- ESLint uses `eslint-plugin-perfectionist` (`recommended-alphabetical`): imports, object keys and
  similar are kept sorted. Run `npm run lint:fix` rather than reordering by hand.
- Secrets (tokens, API keys, custom header values) must never appear in error text or tool output.
  See `docs/architecture.md`.
- If you add, remove or rename an environment variable, update the README table **and**
  `environmentVariables` in `server.json`.
- Add a `## [Unreleased]` entry to `CHANGELOG.md` for user-visible changes.

## Releasing: do not do this unprompted

Publishing to npm and the MCP Registry is irreversible (npm versions cannot be reused). Never run
`npm publish`, `mcp-publisher publish`, or trigger the **Bump Version** / **Release** workflows unless
the user explicitly asks.

- Never hand-edit `version` in `package.json`, `package-lock.json` or `server.json`. The Bump Version
  workflow changes all three together.
- Put release notes in `CHANGELOG.md` under `## [X.Y.Z] - date` **before** bumping; the release notes
  are extracted from that heading, so the bump type must produce exactly `X.Y.Z`.
- Full procedure, failure recovery and the github.com/mcp onboarding step: `CONTRIBUTING.md` →
  **Releasing**.
