# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
