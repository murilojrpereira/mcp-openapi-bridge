# Architecture & Design Decisions

This document explains how the two transports (stdio and HTTP) differ in
practice, what each environment variable actually protects, and why the
per-call auth override design is safe in a way a per-request *target*
override would not be.

## Transport comparison: stdio vs. HTTP

| | stdio | HTTP |
|---|---|---|
| **Process model** | One process **per user**, spawned locally by their own MCP client (`claude mcp add --transport stdio`) | One process **shared by all callers**, running remotely (a container on AWS/Cloudflare/etc.) |
| **`API_BASE_URL`** | Set via that user's own `--env` flags, scoped to their process only. | Fixed once at container startup by whoever deployed it. Same for every caller — see "Why the target API is fixed per deployment" below. |
| **`OPENAPI_TOKEN` / `OPENAPI_API_KEY` / `OPENAPI_CUSTOM_HEADERS`** | Scoped to that one user's process. | Fixed once at container startup as the *default* credentials — but see below, this project already lets individual calls override them. |
| **`MCP_AUTH_TOKEN`** | Not used — only relevant to the HTTP transport. The OS process boundary is the access control. | Gates access to `/mcp` itself. One shared static secret for the whole deployment — anyone with the value gets in; there's no per-client revocation or attribution. |
| **Tool execution** | Uses that user's own token/config — correct by construction. | Uses the deployment's default config *unless* the caller supplies `bearer_token`/`custom_headers` on the individual tool call — see below. |

## The token model

Four things exist, protecting different concerns:

| Setting | Protects | Set by | Overridable per call? |
|---|---|---|---|
| `OPENAPI_TOKEN` | Default bearer auth to the target REST API | Deployer | Yes — via the `bearer_token` tool argument |
| `OPENAPI_API_KEY` (+ header/param) | Default API-key auth to the target REST API | Deployer | No — API-key auth is deployment-wide only (documented v1 limitation) |
| `OPENAPI_CUSTOM_HEADERS` | Default extra headers sent with every request | Deployer | Merged — per-call `custom_headers` add to/override individual keys |
| `MCP_AUTH_TOKEN` | Access to the MCP server's `/mcp` endpoint at all (HTTP only) | Deployer | No — this gates the server itself, not the target API |

## Why this project's per-call auth override is safe (unlike a per-request target would be)

Every generated tool — and the generic `execute_rest` fallback — always exposes
`bearer_token` and `custom_headers` as optional arguments (`src/tools.ts`'s
`buildToolArgsSchema`, `src/index.ts`'s `execute_rest` schema). This lets a
single deployment serve callers with different credentials without
restarting the server or maintaining one deployment per caller.

This is safe specifically because **only the credential varies per call — the
destination (`API_BASE_URL`) never does.** The request always goes to the one
REST API this deployment was configured for; a caller can prove they're a
different tenant/user of that same API, but they cannot redirect the server
to fetch an arbitrary different host.

Contrast this with what would happen if the *target URL* were also a
per-request parameter: a shared server accepting a caller-supplied
destination is a Server-Side Request Forgery (SSRF) risk — anyone who can
reach `/mcp` could point the server at internal-only network destinations
(cloud metadata endpoints, private VPC services, admin panels) and read the
response back through the MCP client. `MCP_AUTH_TOKEN` only gates *who can
reach the server*, not *what the server is allowed to call on the caller's
behalf*, so it wouldn't mitigate this either. That's why `API_BASE_URL`
stays a fixed, deployment-level setting — not a design gap, a deliberate
boundary. If you need one deployment to talk to genuinely different APIs
(not just different credentials for the same API), the safe pattern is one
deployment per target API, the same way stdio already gets isolation for
free from "one process per user."

## Secret handling in error paths

Tool errors and non-2xx API responses are returned as text content to the
calling LLM. Since request failures can, in some cases, embed request
details (e.g. a malformed-URL error can include the full URL, and an
API-key-via-query-parameter setup embeds the key directly in that URL),
`src/executor.ts` scrubs every known secret value (the configured
`OPENAPI_TOKEN`, API key, custom header values, and any per-call overrides)
out of both error text and response bodies before they're returned, via
`redactSecrets()`. This is deliberately conservative — it doesn't try to
reason about which specific error types from which specific Node/undici
version might embed which specific detail; it just guarantees a known secret
value never survives into anything sent back to the caller.
