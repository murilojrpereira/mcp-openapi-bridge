# Deployment Guide

This service is ready for container-based deployment using the HTTP transport.

## Runtime Modes

| Mode | Use case | Command/config |
|---|---|---|
| `stdio` | Local Claude Code MCP server | default `npm start` or `Dockerfile` |
| `http` | Hosted MCP endpoint | `MCP_TRANSPORT=http`, `PORT=8080`, or `Dockerfile.agentcore` |

Hosted platforms should use `Dockerfile.agentcore`. Despite the name, it's a generic HTTP-transport image (no AgentCore-specific code) — it exposes:

| Path | Purpose |
|---|---|
| `/health` | Container/platform health check |
| `/mcp` | MCP Streamable HTTP endpoint |

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_BASE_URL` | Yes | Base URL of the target REST API, e.g. `https://api.example.com`. |
| `OPENAPI_SPEC_PATH` or `OPENAPI_SPEC_URL` | Yes (one of) | Source of the OpenAPI 3.x spec — a local file path or a URL. |
| `OPENAPI_TOKEN` | No | Default bearer token → `Authorization: Bearer <token>`. Overridable per call via the `bearer_token` tool argument. |
| `OPENAPI_API_KEY` (+ `OPENAPI_API_KEY_HEADER` / `OPENAPI_API_KEY_PARAM`) | No | Default API-key auth. Deployment-wide only — no per-call override (v1 limitation). |
| `OPENAPI_CUSTOM_HEADERS` | No | Extra headers sent with every request: `X-Foo=bar,X-Baz=qux`. |
| `OPENAPI_INCLUDE_TAGS` / `OPENAPI_EXCLUDE_TAGS` / `OPENAPI_PATH_PREFIX` / `OPENAPI_MAX_TOOLS` | No | Scope down large specs (Stripe, GitHub, Kubernetes, ...). |
| `MCP_TRANSPORT` | Yes for hosting | Set to `http` |
| `PORT` | Platform-dependent | Defaults to `8080` |
| `MCP_AUTH_TOKEN` | Recommended | Bearer token required by `/mcp` when set |

Set `MCP_AUTH_TOKEN` for any public-routable deployment. Health checks remain unauthenticated at `/health`, while `/mcp` requires `Authorization: Bearer <token>` when this variable is configured.

`API_BASE_URL` is fixed per deployment rather than a per-request or per-client
parameter — this is a deliberate SSRF-avoidance decision, not a limitation.
See [`docs/architecture.md`](architecture.md) for the full reasoning, the
token model, and how stdio and HTTP transports differ in what's isolated per
client.

## AWS

Recommended AWS targets:

| Target | Status | Notes |
|---|---|---|
| Bedrock AgentCore Runtime | Ready | Existing `Dockerfile.agentcore` is tailored for this. See [`docs/aws-bedrock-deployment.md`](aws-bedrock-deployment.md). |
| ECS/Fargate | Ready | Use `Dockerfile.agentcore`, port `8080`, health check `/health`. |
| App Runner | Ready | Use `Dockerfile.agentcore`; set env vars in App Runner service settings. |
| Lambda | Not currently implemented | Would need a Lambda handler/adapter. Bedrock Agent Action Groups can also consume this project's OpenAPI spec directly without this bridge — see the note in `docs/aws-bedrock-deployment.md`. |

Local AWS-style container test:

```bash
docker build -f Dockerfile.agentcore -t mcp-openapi-bridge-http .
docker run --rm -p 8080:8080 \
  -e API_BASE_URL=https://api.example.com \
  -e OPENAPI_SPEC_URL=https://api.example.com/openapi.json \
  -e OPENAPI_TOKEN=your-token \
  -e MCP_AUTH_TOKEN=your-mcp-access-token \
  mcp-openapi-bridge-http
```

## Cloudflare

Recommended Cloudflare target:

| Target | Status | Notes |
|---|---|---|
| Cloudflare Containers | Ready | Use `Dockerfile.agentcore`, port `8080`, health check `/health`. |
| Cloudflare Workers | Not directly ready | Workers do not run this Node HTTP server as-is. A Worker-specific adapter would be needed. |

For Cloudflare Containers, publish the image built from `Dockerfile.agentcore`, set the OpenAPI/REST environment variables as secrets, and route traffic to port `8080`.

## Other Hosts

The same HTTP image should work on any container platform that supports inbound HTTP:

| Platform | Notes |
|---|---|
| Fly.io | Expose internal port `8080`; use secrets for API config. |
| Render | Use Docker deployment; health check path `/health`. |
| Railway | Use Dockerfile deployment; set `PORT` if Railway injects one. |
| Google Cloud Run | Use `Dockerfile.agentcore`; Cloud Run will set `PORT`. |
| Azure Container Apps | Use `Dockerfile.agentcore`; expose target port `8080`. |

## Readiness Checklist

1. Build passes: `npm run build`.
2. Tests pass: `npm test`.
3. HTTP mode starts with `MCP_TRANSPORT=http`.
4. `/health` returns JSON with `status: "ok"`.
5. `/mcp` is reachable by your MCP client.
6. `MCP_AUTH_TOKEN` is set for public-routable deployments.
7. `API_BASE_URL`, the OpenAPI spec source, and API credentials are configured as platform secrets, not committed files.
