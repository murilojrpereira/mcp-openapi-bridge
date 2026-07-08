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
- `allOf`/`anyOf`/`oneOf` schemas fall back to `z.any()`

## License

MIT
