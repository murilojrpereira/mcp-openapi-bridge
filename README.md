# mcp-openapi-bridge

[![npm version](https://img.shields.io/npm/v/mcp-openapi-bridge.svg)](https://www.npmjs.com/package/mcp-openapi-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

A generic [MCP](https://modelcontextprotocol.io/) server that bridges **any OpenAPI 3.x REST API** to Claude Code — automatically generating one tool per endpoint from your spec.

Point it at an OpenAPI spec, set your auth token, and Claude can call every endpoint in your API with full argument validation.

## Requirements

- Node.js >= 20

## How it works

1. Loads your OpenAPI 3.x spec from a local file (`OPENAPI_SPEC_PATH`) or URL (`OPENAPI_SPEC_URL`)
2. Resolves `$ref` references and extracts all operations
3. Registers one MCP tool per operation (filtered by `OPENAPI_MAX_TOOLS`, tags, or path prefix)
4. Each tool accepts path params, query params, and a `body` for request bodies — plus per-call `bearer_token` and `custom_headers` overrides
5. Executes HTTP requests against `API_BASE_URL` and returns the response

## Quick start

```bash
npm install -g mcp-openapi-bridge
```

Add to Claude Code:

```bash
claude mcp add mcp-openapi-bridge \
  -e API_BASE_URL=https://api.example.com \
  -e OPENAPI_SPEC_URL=https://api.example.com/openapi.json \
  -e OPENAPI_TOKEN=your-token
```

Or with a local spec file:

```bash
claude mcp add mcp-openapi-bridge \
  -e API_BASE_URL=https://petstore3.swagger.io/api/v3 \
  -e OPENAPI_SPEC_PATH=/path/to/openapi.yaml \
  -e OPENAPI_TOKEN=your-token
```

## Examples

Two worked walkthroughs against real, public OpenAPI specs — a small one to sanity-check your
setup, then a large one to see how the bridge behaves at real corporate scale.

### Example 1: Swagger Petstore (small spec, no auth)

The [Swagger Petstore](https://petstore3.swagger.io) is the canonical OpenAPI 3.0 reference spec —
13 paths, 19 operations, no authentication required for reads.

1. Add the server:

   ```bash
   claude mcp add petstore \
     -e API_BASE_URL=https://petstore3.swagger.io/api/v3 \
     -e OPENAPI_SPEC_URL=https://petstore3.swagger.io/api/v3/openapi.json
   ```

2. Restart Claude Code (or run `/mcp` to confirm `petstore` is connected). You should see tools
   like `getPetById`, `findPetsByStatus`, `getInventory`, and `addPet` — one per operation, named
   directly from each operation's `operationId`.
3. Ask Claude:

   > Using the petstore MCP, find all pets with status "available", then look up the full details
   > of the first one.

   Claude calls `findPetsByStatus({ status: "available" })`, then `getPetById({ petId: <id> })`
   with an ID from the result.
4. Try an invalid call to see error passthrough:

   > Look up pet ID 999999999 in the petstore.

   Returns `HTTP 404` with the Petstore's own JSON error body — the bridge passes through the
   API's status code and payload unchanged rather than masking it.

### Example 2: GitHub REST API (corporate-scale spec, auth + filtering)

GitHub's public [OpenAPI description](https://github.com/github/rest-api-description) is
representative of the specs this bridge targets in production: **1,206 operations across 796
paths** — far more than the `OPENAPI_MAX_TOOLS` default of 128. This is where filtering
(`OPENAPI_INCLUDE_TAGS` / `OPENAPI_PATH_PREFIX`) becomes mandatory rather than optional.

1. Scope to just the Issues API (55 operations — comfortably under the default limit). Reference
   the token through an already-exported shell variable rather than typing the literal value —
   `-e OPENAPI_TOKEN=$GH_TOKEN` only puts the variable *name* in your shell history, not the
   secret itself:

   ```bash
   export GH_TOKEN=ghp_your_personal_access_token  # or: source a gitignored .env file first

   claude mcp add github-issues \
     -e API_BASE_URL=https://api.github.com \
     -e OPENAPI_SPEC_URL=https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json \
     -e OPENAPI_INCLUDE_TAGS=issues \
     -e OPENAPI_TOKEN=$GH_TOKEN
   ```

   A token isn't required for public read endpoints, but GitHub rate-limits unauthenticated
   requests to 60/hour vs. 5,000/hour authenticated. Scope the token to the narrowest permissions
   you need (a fine-grained PAT limited to specific repos, read-only where possible) — this server
   forwards whatever token it's given, so the token's own scope is your actual access boundary.
2. GitHub's `operationId`s use slashes (e.g. `issues/list-for-repo`), which get sanitized to
   `[a-zA-Z0-9_]+` per the [tool naming](#tool-naming) rules — so this operation registers as the
   tool `issues_list_for_repo`, and `repos/get` becomes `repos_get`.
3. Ask Claude:

   > Using github-issues, list the 5 most recently updated open issues in facebook/react.

   Claude calls
   `issues_list_for_repo({ owner: "facebook", repo: "react", state: "open", sort: "updated", per_page: 5 })`.
4. To also reach repos or pull requests, either add more tags and raise the tool cap
   (`OPENAPI_INCLUDE_TAGS=issues,pulls,repos -e OPENAPI_MAX_TOOLS=512`), or scope to one repo by
   path instead (`OPENAPI_PATH_PREFIX=/repos/facebook/react`).

## Environment variables

### Required

| Variable | Description |
|---|---|
| `API_BASE_URL` | Base URL of the REST API, e.g. `https://api.stripe.com` |
| `OPENAPI_SPEC_PATH` or `OPENAPI_SPEC_URL` | Source of the OpenAPI spec (local file or URL) |

### Authentication

All auth mechanisms can be combined and are applied simultaneously:

| Variable | Description |
|---|---|
| `OPENAPI_TOKEN` | Bearer token → `Authorization: Bearer <token>` |
| `OPENAPI_API_KEY` | API key value (pair with one of the two below) |
| `OPENAPI_API_KEY_HEADER` | Header name for API key, e.g. `X-API-Key` |
| `OPENAPI_API_KEY_PARAM` | Query param name for API key, e.g. `api_key` |
| `OPENAPI_CUSTOM_HEADERS` | Extra headers for every call: `X-Foo=bar,X-Baz=qux` |

**Per-call overrides**: Every tool also accepts `bearer_token` and `custom_headers` arguments. If provided, they override the global env vars for that single request. This lets Claude switch tokens per call without restarting the server.

### Filtering (for large specs)

| Variable | Description | Default |
|---|---|---|
| `OPENAPI_MAX_TOOLS` | Maximum tools to register | `128` |
| `OPENAPI_INCLUDE_TAGS` | Comma-separated tags to include | all |
| `OPENAPI_EXCLUDE_TAGS` | Comma-separated tags to exclude | none |
| `OPENAPI_PATH_PREFIX` | Only include paths starting with this prefix | all |

For APIs with hundreds of endpoints (Stripe, GitHub, Kubernetes), use these to scope down to the subset you need:

```bash
OPENAPI_INCLUDE_TAGS=payments,customers
# or
OPENAPI_PATH_PREFIX=/v1/charges
```

If `OPENAPI_MAX_TOOLS` truncates the spec, stderr logs exactly which tags lost operations to the
cap (e.g. `repos (0/203), issues (1/55)`), so you know precisely what to add to
`OPENAPI_INCLUDE_TAGS` or `OPENAPI_PATH_PREFIX` — registration order otherwise follows the spec's
own path order, which has no relationship to which endpoints matter most to you.

### Reliability

| Variable | Description | Default |
|---|---|---|
| `OPENAPI_MAX_RETRIES` | Retries for `429`/`502`/`503`/`504` responses, honoring the API's `Retry-After` header when present and falling back to exponential backoff with jitter otherwise. Clamped to 0–5. | `0` (disabled) |

Retries apply to every HTTP method, not just idempotent ones — these specific status codes
conventionally mean the request was rejected before reaching business logic (rate-limited or a
gateway hiccup), not that it partially succeeded. Other error statuses (4xx, plain 500) are never
retried and are returned to the caller as-is.

`502`/`504` are gateway-level errors that can, rarely, occur *after* an upstream API already
processed a write (the backend completed it but the response was lost to a gateway timeout).
Retrying then resends the identical request. If the upstream API you're bridging supports
idempotency keys for writes (Stripe's `Idempotency-Key` header, for example), pass one via
`custom_headers` so a retried write is provably safe; otherwise, only enable `OPENAPI_MAX_RETRIES`
for read-heavy or naturally idempotent APIs.

### Transport

| Variable | Description | Default |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` or `http` | `stdio` |
| `PORT` | HTTP port (when `MCP_TRANSPORT=http`) | `8080` |
| `MCP_AUTH_TOKEN` | Bearer token required by the `/mcp` HTTP endpoint. Recommended for any public-routable deployment. | unauthenticated if unset |

Requests to `/mcp` are capped at 10MB. See [`docs/architecture.md`](docs/architecture.md)
for how stdio and HTTP differ in what's isolated per client, and why `API_BASE_URL` is
fixed per deployment rather than a per-request parameter.

## Tool naming

- If the operation has an `operationId`, it's used directly (sanitized to `[a-zA-Z0-9_]+`)
- Otherwise: `{method}_{path}` — e.g. `GET /orders/{id}/items` → `get_orders_id_items`
- Duplicate IDs get a numeric suffix: `getOrders`, `getOrders_2`

## Tool arguments

Each tool exposes:
- **Path parameters** — by name, required
- **Query parameters** — by name, optional
- **`body`** — request body for POST/PUT/PATCH (optional or required per spec)
- **Header parameters** — as `header_{lowercase_name}`
- **`bearer_token`** — per-call bearer override
- **`custom_headers`** — per-call extra headers (`{"X-Tenant": "abc"}`)

## Generic fallback tool

`execute_rest` is always registered for arbitrary requests when no specific tool fits:

```
execute_rest(method, path, query?, body?, headers?, bearer_token?, custom_headers?)
```

## Docker

**Stdio transport:**
```bash
docker build -t mcp-openapi-bridge .
docker run -i --rm \
  -e API_BASE_URL=https://api.example.com \
  -e OPENAPI_SPEC_URL=https://api.example.com/openapi.json \
  -e OPENAPI_TOKEN=your-token \
  mcp-openapi-bridge
```

**HTTP transport (for AWS Bedrock AgentCore or other hosted deployments):**
```bash
docker build -f Dockerfile.agentcore -t mcp-openapi-bridge-agentcore .
docker run -p 8080:8080 \
  -e API_BASE_URL=https://api.example.com \
  -e OPENAPI_SPEC_URL=https://api.example.com/openapi.json \
  -e OPENAPI_TOKEN=your-token \
  -e MCP_AUTH_TOKEN=your-mcp-access-token \
  mcp-openapi-bridge-agentcore
```

For public-routable deployments, set `MCP_AUTH_TOKEN` and configure clients to send `Authorization: Bearer <token>` to `/mcp`.

See [`docs/deployment.md`](docs/deployment.md) for a full hosting guide (AWS, Cloudflare, and other platforms) and [`docs/aws-bedrock-deployment.md`](docs/aws-bedrock-deployment.md) for a step-by-step Bedrock AgentCore walkthrough.

## Spec caching

When using `OPENAPI_SPEC_URL`, the spec is cached locally for 1 hour (in `~/.cache/mcp-openapi-bridge/`). Override with `OPENAPI_SPEC_CACHE_TTL_SECONDS`.

## Limitations (v1)

- OpenAPI 3.x only (not Swagger 2.0)
- Internal `$ref` only (no cross-file references)
- `application/json` bodies only (no multipart/form-data)
- No cookie parameters
- No OAuth2 token flows (static token only)
- No per-operation auth override

## Security

- **The target API is fixed per deployment, never a per-request parameter.** Individual tool
  calls can override *credentials* (`bearer_token`, `custom_headers`) but never the destination
  host — `API_BASE_URL` is set once at deployment time. A shared server that let callers redirect
  it to an arbitrary destination would be a Server-Side Request Forgery (SSRF) primitive; this
  design rules that out by construction.
- **Configured and per-call secrets are redacted from every response.** If an API error or a
  malformed request happens to echo back request details (e.g. an API key sent via query
  parameter ending up in an error message), the bridge scrubs every known secret value out of
  both error text and response bodies before they reach the calling LLM.
- **`MCP_AUTH_TOKEN` gates the HTTP transport's `/mcp` endpoint** for public-routable deployments;
  requests are capped at 10MB to bound request-body memory use.

See [`docs/architecture.md`](docs/architecture.md) for the full design rationale and
[`SECURITY.md`](SECURITY.md) to report a vulnerability.

## Development

```bash
npm install
npm run build
npm test             # unit tests, fully mocked, no network access
npm run test:live    # opt-in — exercises real HTTP calls against the public Petstore demo
npm run lint
npm run format
```

`test:live` is skipped by default and isn't part of `npm test` or CI — it exists to catch
real-world API quirks (mismatched content-type headers, unexpected error bodies) that mocked
unit tests can't, without introducing network flakiness into the standard suite.

## License

MIT
