# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-08-29

### Changed
- Migrated from `@modelcontextprotocol/sdk` v1 to the v2 SDK packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`), adding support for the stateless MCP protocol revision `2026-07-28` (no `initialize` handshake, no `Mcp-Session-Id`, `server/discover`, Multi Round-Trip Requests) while remaining backward-compatible with 2025-era clients. The HTTP transport already built a fresh `McpServer`/transport pair per request with no session ID, so this migration required no behavioral change to request handling — only the transport/import wiring.
- Upgraded `zod` from v3 to v4:
  - `z.record()` call sites updated to the new required two-argument signature.
  - `format: uuid` now validates via `z.guid()` rather than the new, stricter `z.uuid()` — v4's `z.uuid()`/`.uuid()` enforce RFC 9562 variant bits, which would reject some real-world UUIDs (e.g. version-1 GUIDs with non-conformant variant bits) that were previously accepted. `z.guid()` preserves the old lenient behavior.
  - `format: ipv4`/`ipv6` now use the top-level `z.ipv4()`/`z.ipv6()` (Zod v4 removed the chained `.ip()` method entirely).
  - `format: object` (no declared properties) now returns `z.looseObject(...)` instead of the deprecated `z.object(...).passthrough()`; behavior is unchanged.
- Synced `server.json`'s version field, which had drifted out of sync with `package.json` since 1.0.0.

## [1.1.1] - 2026-07-22

### Fixed
- Fixed a crash on startup when an OpenAPI operation's `requestBody.content` is an empty object (`{}`) — a shape the spec disallows but real-world/hand-edited specs can still have. `resolveRequestBody` now treats a missing content entry the same as no request body instead of throwing out of `extractOperations`

## [1.1.0] - 2026-07-21

### Added
- `OPENAPI_MAX_RETRIES` — opt-in retry with exponential backoff (honoring `Retry-After`) for `429`/`502`/`503`/`504` responses, default `0` (disabled), clamped to 0–5
- Logs which OpenAPI tags lost operations when `OPENAPI_MAX_TOOLS` truncates a large spec (e.g. `repos (0/203), issues (1/55)`), so users know exactly what to add via `OPENAPI_INCLUDE_TAGS`/`OPENAPI_PATH_PREFIX` instead of silently registering an arbitrary subset
- Step-by-step README examples against two public specs (Swagger Petstore and the GitHub REST API), covering tool naming, tag scoping for large specs, and error passthrough
- Opt-in live smoke test suite (`npm run test:live`) exercising real HTTP calls against the public Petstore demo, skipped by default so it never affects `npm test` or CI
- `SECURITY.md` with a vulnerability disclosure policy and a summary of the project's threat model
- A "Security" section in the README summarizing the fixed-target-URL (no SSRF) and secret-redaction design properties, linking to `docs/architecture.md` and `SECURITY.md`

### Fixed
- Fixed a crash (`Body is unusable: Body has already been read`) when an API responds with an `application/json` content-type header but a non-JSON body — observed live against Swagger's public Petstore demo. The response body is now read once as text and parsed, instead of calling `response.json()` first and falling back to `response.text()` on failure (which doesn't work, since a failed `json()` call still consumes the stream)
- Removed a stale README limitations claim that `allOf`/`anyOf`/`oneOf` schemas fall back to `z.any()` — `schemaToZod` has built proper intersection/union types for all three since initial release

## [1.0.1] - 2026-07-09

### Added
- `docs/deployment.md` — runtime modes, required env vars, and hosting tables for AWS, Cloudflare, and other container platforms
- `docs/aws-bedrock-deployment.md` — step-by-step Bedrock AgentCore Runtime deployment walkthrough, plus a note on the alternative Bedrock Action Group path

## [1.0.0] - 2026-07-05

### Added
- Initial release
- Auto-generates one MCP tool per OpenAPI 3.x endpoint
- Supports Bearer token, API Key (header/query), and custom headers
- Per-call `bearer_token` and `custom_headers` tool arguments for dynamic auth
- Internal `$ref` resolution with circular reference detection
- YAML and JSON spec support (file or URL)
- URL spec caching (1 hour TTL, configurable)
- Tag and path prefix filtering for large specs
- `OPENAPI_MAX_TOOLS` cap (default: 128) to prevent context overflow
- `execute_rest` generic fallback tool
- stdio and HTTP transports
- Multi-stage Docker builds (`Dockerfile` and `Dockerfile.agentcore`)
- GitHub Actions CI/CD (ci, release, bump-version, ecr-push)
- `MCP_AUTH_TOKEN` to protect the `/mcp` HTTP endpoint on public-routable deployments
- `docs/architecture.md` documenting the stdio vs. HTTP transport model, the token model, and why the per-call auth override design is safe (target API stays fixed per deployment; only credentials vary per call)
- Secret redaction (`redactSecrets`) so configured/per-call auth values never appear in tool error text or response bodies returned to the caller

### Fixed
- HTTP transport no longer crashes the whole process on a malformed JSON request body (was an unhandled promise rejection)
- Request bodies to `/mcp` are now capped at 10MB to prevent memory-exhaustion DoS
- Fixed the stateless HTTP transport being reused across requests, which violated the MCP SDK's contract and caused every request after the first to fail — each `/mcp` request now gets its own server + transport instance
- Fixed a Docker build failure where `npm ci` triggered the `prepare`/`build` script before source files were copied in (both `Dockerfile` and `Dockerfile.agentcore`)

### Changed
- Minimum supported Node.js version raised from 18 to 20. CI and the release pipeline test Node 20.x and 22.x only, since `vitest`'s `rolldown` dependency requires `node:util`'s `styleText` export (Node 20.12+)
- Docker images now run as a non-root user (`USER node`)

### Security
- `/mcp` now returns 405 instead of processing GET/DELETE requests in stateless mode
- Bearer token comparison for `MCP_AUTH_TOKEN` is constant-time (`crypto.timingSafeEqual`)
