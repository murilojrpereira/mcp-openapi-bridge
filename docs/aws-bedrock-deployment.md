# Deploying mcp-openapi-bridge on AWS for Amazon Bedrock

## Option A — Bedrock AgentCore Runtime (recommended)

AgentCore is AWS's managed hosting environment built specifically for MCP servers. It runs the container using the native MCP protocol over HTTP, so tool discovery works exactly as it does locally. Billing is active-consumption only (~$0.09/hr of compute), so you pay nothing when no agent is using the server.

### Architecture

```
User / App
    │
    ▼
Amazon Bedrock Agent
    │  MCP tool call (HTTP)
    ▼
Bedrock AgentCore Runtime
    │  container
    ▼
mcp-openapi-bridge (HTTP transport)
    │
    ▼
Target REST API (per OPENAPI_SPEC_*)
```

### What was built

| File | Purpose |
|---|---|
| `src/index.ts` | `MCP_TRANSPORT=http` switches to `StreamableHTTPServerTransport` on `PORT` (default 8080). `/mcp` handles the MCP protocol, `/health` is for container health checks. Stdio mode is unchanged. |
| `Dockerfile.agentcore` | Multi-stage build. Sets `MCP_TRANSPORT=http`, `PORT=8080`, exposes 8080, includes `HEALTHCHECK`. |
| `.github/workflows/ecr-push.yml` | Manual dispatch: builds `Dockerfile.agentcore` and pushes `:sha` + `:latest` to ECR. Inputs: `aws_region`, `ecr_repository`, `image_tag`. |

### Prerequisites

Set these secrets in the GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user key with ECR push permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret |

### Step 1 — Create an ECR repository

```bash
aws ecr create-repository \
  --repository-name mcp-openapi-bridge \
  --region us-east-1
```

### Step 2 — Push the image to ECR

Go to **Actions → Push to ECR → Run workflow**, fill in:

- `aws_region`: e.g. `us-east-1`
- `ecr_repository`: `mcp-openapi-bridge`
- `image_tag`: leave blank to use git SHA

### Step 3 — Host in Bedrock AgentCore

In the AWS Console:

1. **Bedrock → AgentCore → Agent Runtime → Host Agent**
2. Point to your ECR image (`<account>.dkr.ecr.<region>.amazonaws.com/mcp-openapi-bridge:latest`)
3. Set environment variables:
   - `API_BASE_URL`
   - `OPENAPI_SPEC_URL` (or bake `OPENAPI_SPEC_PATH` into the image)
   - `OPENAPI_TOKEN` (or `OPENAPI_API_KEY` / `OPENAPI_API_KEY_HEADER` / `OPENAPI_API_KEY_PARAM`)
   - `MCP_AUTH_TOKEN`
4. AgentCore will call `/health` to confirm the container is ready, then serve MCP requests at `/mcp`

### Step 4 — Connect to a Bedrock Agent

In the Bedrock Agent settings, add the AgentCore host as an MCP tool source. The agent will auto-discover one tool per OpenAPI operation via the loaded spec — no manual schema upload needed.

### Updating after a code change

```bash
# Push a new image (via GitHub Actions or locally):
docker build -f Dockerfile.agentcore -t <ecr-uri>:latest .
docker push <ecr-uri>:latest

# Then redeploy in AgentCore console (or update the agent alias).
```

---

## Option B — Bedrock Agent Action Group (no bridge needed)

Unlike the GraphQL case, this project already has what a Bedrock Agent Action Group wants natively: an **OpenAPI 3.x schema**. Bedrock Action Groups consume an OpenAPI spec directly (hosted in S3) plus a Lambda that implements the calls — so if your goal is a classic Bedrock Agent + Action Group (not AgentCore/MCP), you generally don't need `mcp-openapi-bridge` in the request path at all:

1. Upload your existing OpenAPI spec (the same one pointed to by `OPENAPI_SPEC_PATH`/`OPENAPI_SPEC_URL`) to S3.
2. Write a thin Lambda that forwards the Bedrock Agent's parsed call to `API_BASE_URL`, attaching whatever auth your API needs.
3. Wire the Action Group to that Lambda + the S3-hosted OpenAPI schema via `aws bedrock-agent create-agent-action-group`.

This is a different integration pattern (Bedrock-native Action Groups, not MCP) and isn't implemented in this repo. It's noted here so you don't build a redundant translation layer — `mcp-openapi-bridge`'s value is specifically bridging OpenAPI → **MCP tools**, which is what Option A gives you.

---

## AWS infrastructure summary (Option A)

| Component | Purpose |
|---|---|
| **ECR repository** | Stores the `Dockerfile.agentcore` image |
| **Bedrock AgentCore Runtime** | Hosts the container, calls `/health`, proxies MCP traffic to `/mcp` |
| **Target REST API** | The API described by your OpenAPI spec (`API_BASE_URL`) |

## What stays the same

- `src/index.ts` stdio behaviour — local Claude Code usage unchanged
- All environment variable names
- Per-call `bearer_token` / `custom_headers` tool argument overrides
- npm package and stdio Docker image are unaffected
