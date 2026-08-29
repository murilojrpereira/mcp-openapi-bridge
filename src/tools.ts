import type { ExecutorConfig, ResolvedOperation } from "./types.js";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { executeOperation } from "./executor.js";
import { schemaToZod } from "./zod.js";

export function operationToDescription(op: ResolvedOperation): string {
  const parts: string[] = [];
  if (op.deprecated) parts.push("[DEPRECATED]");
  parts.push(`[${op.method.toUpperCase()} ${op.path}]`);
  if (op.summary) parts.push(op.summary);
  if (op.description && op.description !== op.summary) {
    const snippet = op.description.replace(/\s+/g, " ").trim().slice(0, 200);
    parts.push(snippet);
  }
  return parts.join(" — ");
}

export function operationToToolName(op: ResolvedOperation): string {
  return op.operationId;
}

const RESERVED_ARGS = new Set(["bearer_token", "body", "custom_headers"]);

export function buildToolArgsSchema(op: ResolvedOperation): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  const usedNames = new Set<string>();

  for (const param of op.parameters) {
    if (param.in === "cookie") continue;

    let argName: string;
    if (param.in === "header") {
      argName = `header_${param.name.toLowerCase().replace(/-/g, "_")}`;
    } else {
      argName = param.name;
    }

    if (RESERVED_ARGS.has(argName)) {
      argName = `param_${argName}`;
      console.error(
        `[mcp-openapi-bridge] Parameter name "${param.name}" collides with reserved arg — renamed to "${argName}"`,
      );
    }

    if (usedNames.has(argName)) {
      argName = `query_${argName}`;
      console.error(`[mcp-openapi-bridge] Parameter name collision resolved — using "${argName}"`);
    }
    usedNames.add(argName);

    let zodType = schemaToZod(param.schema);
    const labeledIn = param.in === "header" ? "header" : param.in;
    const desc = param.description ? `[${labeledIn} param] ${param.description}` : `[${labeledIn} param]`;
    zodType = zodType.describe(desc);
    if (!param.required) zodType = zodType.optional();

    shape[argName] = zodType;
  }

  if (op.requestBodySchema) {
    let bodyZod = schemaToZod(op.requestBodySchema).describe("Request body (JSON)");
    if (!op.requestBodyRequired) bodyZod = bodyZod.optional();
    shape.body = bodyZod;
  }

  shape.bearer_token = z
    .string()
    .optional()
    .describe("Bearer token to authenticate this request (overrides OPENAPI_TOKEN)");

  shape.custom_headers = z
    .record(z.string(), z.string())
    .optional()
    .describe('Additional request headers as key-value pairs, e.g. {"X-Tenant-ID": "abc"}');

  return shape;
}

export function registerTools(server: McpServer, operations: ResolvedOperation[], config: ExecutorConfig): void {
  for (const op of operations) {
    const toolName = operationToToolName(op);
    const description = operationToDescription(op);
    const argsSchema = buildToolArgsSchema(op);

    server.registerTool(toolName, { description, inputSchema: z.object(argsSchema) }, async (rawArgs) => {
      return executeOperation(op, rawArgs, config);
    });
  }
}
