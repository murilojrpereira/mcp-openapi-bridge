import { applyAuth } from "./auth.js";
import type { ExecutorConfig, McpToolResult, ResolvedOperation } from "./types.js";

/** Collects every known secret value in scope, so error/response text can be scrubbed of them. */
function collectSecrets(
  config: ExecutorConfig,
  callOverrides: { bearerToken?: string; customHeaders?: Record<string, string> }
): string[] {
  const secrets: string[] = [];
  if (config.authConfig.bearerToken) secrets.push(config.authConfig.bearerToken);
  if (config.authConfig.apiKeyHeader?.value) secrets.push(config.authConfig.apiKeyHeader.value);
  if (config.authConfig.apiKeyQuery?.value) secrets.push(config.authConfig.apiKeyQuery.value);
  secrets.push(...Object.values(config.authConfig.customHeaders));
  if (callOverrides.bearerToken) secrets.push(callOverrides.bearerToken);
  if (callOverrides.customHeaders) secrets.push(...Object.values(callOverrides.customHeaders));
  return secrets.filter((s) => s.length > 0);
}

/** Scrubs known secret values out of text before it's returned as tool output. */
function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function buildUrl(
  op: ResolvedOperation,
  args: Record<string, unknown>,
  baseUrl: string
): { url: string; queryParams: URLSearchParams } {
  let path = op.path;
  const queryParams = new URLSearchParams();

  for (const param of op.parameters) {
    if (param.in === "path") {
      const val = args[param.name];
      if (val === undefined || val === null) {
        throw new Error(`Missing required path parameter: "${param.name}"`);
      }
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(val)));
    } else if (param.in === "query" && args[param.name] !== undefined && args[param.name] !== null) {
      const val = args[param.name];
      if (Array.isArray(val)) {
        val.forEach((v) => queryParams.append(param.name, String(v)));
      } else {
        queryParams.set(param.name, String(val));
      }
    }
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}${path}`;
  return { url, queryParams };
}

async function formatResponse(response: Response, secrets: string[]): Promise<McpToolResult> {
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const isError = status >= 400;

  let body: string;
  if (contentType.includes("application/json")) {
    try {
      const json = await response.json();
      body = JSON.stringify(json, null, 2);
    } catch {
      body = await response.text();
    }
  } else if (contentType.includes("text/")) {
    body = await response.text();
  } else {
    const length = response.headers.get("content-length") ?? "unknown";
    body = `[Binary response: ${contentType || "unknown content-type"}, ${length} bytes]`;
    await response.body?.cancel();
  }

  return {
    content: [{ type: "text", text: redactSecrets(`HTTP ${status}\n\n${body}`, secrets) }],
    isError,
  };
}

export async function executeOperation(
  op: ResolvedOperation,
  args: Record<string, unknown>,
  config: ExecutorConfig
): Promise<McpToolResult> {
  const callOverrides = {
    bearerToken: args["bearer_token"] !== undefined ? String(args["bearer_token"]) : undefined,
    customHeaders:
      args["custom_headers"] !== undefined && typeof args["custom_headers"] === "object"
        ? (args["custom_headers"] as Record<string, string>)
        : undefined,
  };
  const secrets = collectSecrets(config, callOverrides);

  try {
    const { url, queryParams } = buildUrl(op, args, config.baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };

    for (const param of op.parameters) {
      if (param.in === "header") {
        const argKey = `header_${param.name.toLowerCase().replace(/-/g, "_")}`;
        if (args[argKey] !== undefined && args[argKey] !== null) {
          headers[param.name] = String(args[argKey]);
        }
      }
    }

    applyAuth(headers, queryParams, config.authConfig, callOverrides);

    let body: string | undefined;
    const methodHasBody = ["post", "put", "patch"].includes(op.method);
    if (methodHasBody && args["body"] !== undefined && args["body"] !== null) {
      headers["Content-Type"] = op.requestBodyContentType;
      body = JSON.stringify(args["body"]);
    }

    const qs = queryParams.toString();
    const finalUrl = qs ? `${url}?${qs}` : url;

    const response = await fetch(finalUrl, {
      method: op.method.toUpperCase(),
      headers,
      body,
    });

    return formatResponse(response, secrets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: redactSecrets(`Error: ${msg}`, secrets) }], isError: true };
  }
}

export async function executeGenericRequest(
  baseUrl: string,
  method: string,
  path: string,
  config: ExecutorConfig,
  opts: {
    query?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
    bearerToken?: string;
    customHeaders?: Record<string, string>;
  }
): Promise<McpToolResult> {
  const callOverrides = { bearerToken: opts.bearerToken, customHeaders: opts.customHeaders };
  const secrets = collectSecrets(config, callOverrides);

  try {
    const queryParams = new URLSearchParams(opts.query ?? {});
    const reqHeaders: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };

    applyAuth(reqHeaders, queryParams, config.authConfig, callOverrides);

    if (opts.body !== undefined) {
      reqHeaders["Content-Type"] = "application/json";
    }

    const base = baseUrl.replace(/\/$/, "");
    const qs = queryParams.toString();
    const url = qs ? `${base}${path}?${qs}` : `${base}${path}`;

    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers: reqHeaders,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    return formatResponse(response, secrets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: redactSecrets(`Error: ${msg}`, secrets) }], isError: true };
  }
}
