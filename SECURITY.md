# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes. There is no long-term support
branch — upgrade to the latest release to pick up fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not via a public GitHub issue.

- Preferred: open a [GitHub Security Advisory](https://github.com/murilojrpereira/mcp-openapi-bridge/security/advisories/new) for this repository.
- Alternative: email the maintainer directly (see the GitHub profile linked from the
  [repository](https://github.com/murilojrpereira/mcp-openapi-bridge)) with a description of the
  issue, affected version, and reproduction steps.

You should expect an initial response within a few days. Please don't publicly disclose the issue
until a fix has been released.

## Threat model

This server executes real HTTP requests — including authenticated ones — against a REST API on
behalf of an MCP client (typically an LLM agent). Two design decisions matter most for security
review:

1. **The target API (`API_BASE_URL`) is fixed per deployment, never a per-request parameter.**
   Individual tool calls can override *credentials* (`bearer_token`, `custom_headers`) but never
   the destination host. This is deliberate: accepting a caller-supplied destination on a shared
   server would be a Server-Side Request Forgery (SSRF) primitive, letting any caller point the
   server at internal-only network destinations (cloud metadata endpoints, private VPC services).
   See [`docs/architecture.md`](docs/architecture.md) for the full rationale.
2. **Configured and per-call secrets are redacted from every response.** `src/executor.ts` scrubs
   every known secret value (bearer token, API key, custom header values, and per-call overrides)
   out of error text and response bodies before they're returned to the calling LLM, so a
   malformed request or an API error that happens to echo back request details can't leak
   credentials through the MCP tool output.

Known, accepted limitations (not vulnerabilities): the HTTP transport's `MCP_AUTH_TOKEN` is a
single shared static secret with no per-client revocation or attribution — treat it like an API
key, not a login system. There's no OAuth2 token flow; only static bearer/API-key credentials are
supported. Both are documented in the [README's Limitations section](README.md#limitations-v1).

## Reporting dependency vulnerabilities

`npm audit` and Dependabot alerts are monitored on this repository directly — please still report
supply-chain issues you find (e.g. a malicious transitive dependency), but routine version-bump
advisories don't need a private report.
