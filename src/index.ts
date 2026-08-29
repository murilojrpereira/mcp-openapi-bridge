#!/usr/bin/env node
import type { ExecutorConfig, SpecFilters } from "./types.js";
import { timingSafeEqual } from "crypto";
import { createServer, type IncomingMessage } from "http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { resolveAuthConfig } from "./auth.js";
import { executeGenericRequest } from "./executor.js";
import { extractOperations, loadSpec } from "./schema.js";
import { registerTools } from "./tools.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`[mcp-openapi-bridge] Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return val;
}

const API_BASE_URL = requireEnv("API_BASE_URL");

const hasSpec = process.env.OPENAPI_SPEC_PATH || process.env.OPENAPI_SPEC_URL; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- intentionally treats empty string as "not set"
if (!hasSpec) {
  console.error("[mcp-openapi-bridge] Error: OPENAPI_SPEC_PATH or OPENAPI_SPEC_URL environment variable is required.");
  process.exit(1);
}

const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const MAX_MCP_BODY_BYTES = 10 * 1024 * 1024; // 10MB

/** Constant-time check of the `Authorization: Bearer <token>` header */
function isAuthorized(req: IncomingMessage): boolean {
  if (!MCP_AUTH_TOKEN) return true;
  const expected = Buffer.from(`Bearer ${MCP_AUTH_TOKEN}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function main() {
  const spec = await loadSpec();
  const authConfig = resolveAuthConfig();

  const filters: SpecFilters = {
    includeTags: process.env.OPENAPI_INCLUDE_TAGS?.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    excludeTags: process.env.OPENAPI_EXCLUDE_TAGS?.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    pathPrefix: process.env.OPENAPI_PATH_PREFIX,
    maxTools: parseInt(process.env.OPENAPI_MAX_TOOLS ?? "128", 10),
  };

  const operations = extractOperations(spec, filters);
  const maxRetries = Math.max(0, Math.min(5, parseInt(process.env.OPENAPI_MAX_RETRIES ?? "0", 10) || 0));
  const config: ExecutorConfig = { baseUrl: API_BASE_URL, authConfig, maxRetries };

  console.error(`[mcp-openapi-bridge] Registering ${operations.length} tools from "${spec.info.title}" spec...`);

  // Builds a fresh McpServer with all tools registered. The stateless HTTP
  // transport requires a new server+transport pair per request, so this is
  // called once for stdio and once per request for HTTP.
  function buildServer(): McpServer {
    const server = new McpServer({
      name: "mcp-openapi-bridge",
      version: "1.2.0",
    });

    registerTools(server, operations, config);

    server.registerTool(
      "execute_rest",
      {
        description: "Execute any HTTP request against the API. Use when no specific tool matches your needs.",
        inputSchema: z.object({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP method"),
          path: z.string().describe("API path, e.g. /orders/123"),
          query: z.record(z.string(), z.string()).optional().describe("Query parameters as key-value pairs"),
          body: z.unknown().optional().describe("Request body (for POST/PUT/PATCH), serialized as JSON"),
          headers: z.record(z.string(), z.string()).optional().describe("Additional request headers"),
          bearer_token: z
            .string()
            .optional()
            .describe("Bearer token to authenticate this request (overrides OPENAPI_TOKEN)"),
          custom_headers: z
            .record(z.string(), z.string())
            .optional()
            .describe('Additional auth/custom headers as key-value pairs, e.g. {"X-Tenant-ID": "abc"}'),
        }),
      },
      async ({ method, path, query, body, headers, bearer_token, custom_headers }) => {
        return executeGenericRequest(API_BASE_URL, method, path, config, {
          query,
          body,
          headers,
          bearerToken: bearer_token,
          customHeaders: custom_headers,
        });
      },
    );

    return server;
  }

  if (process.env.MCP_TRANSPORT === "http") {
    const port = parseInt(process.env.PORT ?? "8080", 10);

    if (!MCP_AUTH_TOKEN) {
      console.error(
        "[mcp-openapi-bridge] Warning: MCP_AUTH_TOKEN is not set — the /mcp endpoint is unauthenticated. Set MCP_AUTH_TOKEN to protect public-routable deployments.",
      );
    }

    const httpServer = createServer((req, res) => {
      const handle = async (): Promise<void> => {
        if (req.url === "/" || req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", mcpEndpoint: "/mcp" }));
          return;
        }
        if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
          if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
            res.end(
              JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
            );
            return;
          }
          // Always drain the body first so rejected requests don't leave the
          // connection in a state that prevents keep-alive reuse.
          const body = await readRequestBody(req);
          if (body === null) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large" }));
            return;
          }
          if (!isAuthorized(req)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          let parsed: unknown;
          try {
            parsed = body.length ? JSON.parse(body.toString()) : undefined;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          // Stateless mode requires a fresh server+transport per request.
          const requestServer = buildServer();
          const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          await requestServer.connect(transport);
          res.on("close", () => {
            void transport.close();
            void requestServer.close();
          });
          await transport.handleRequest(req, res, parsed);
          return;
        }
        res.writeHead(404).end();
      };

      handle().catch((err: unknown) => {
        console.error("[mcp-openapi-bridge] Error handling HTTP request:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    });

    httpServer.listen(port, () => {
      console.error(`[mcp-openapi-bridge] HTTP server listening on port ${port}`);
    });
  } else {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-openapi-bridge] Running on stdio transport");
  }
}

/** Read the full request body, enforcing a size cap. Returns null if the body is too large. */
async function readRequestBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_MCP_BODY_BYTES) {
      req.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

main().catch((err: unknown) => {
  console.error("[mcp-openapi-bridge] Fatal error:", err);
  process.exit(1);
});
