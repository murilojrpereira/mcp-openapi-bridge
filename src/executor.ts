import type { ExecutorConfig, McpToolResult, ResolvedOperation } from "./types.js";
import { applyAuth } from "./auth.js";

export function buildUrl(
  op: ResolvedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
): { queryParams: URLSearchParams; url: string } {
  let path = op.path;
  const queryParams = new URLSearchParams();

  for (const param of op.parameters) {
    if (param.in === "path") {
      const val = args[param.name];
      if (val === undefined || val === null) {
        throw new Error(`Missing required path parameter: "${param.name}"`);
      }
      path = path.replace(`{${param.name}}`, encodeURIComponent(safeString(val)));
    } else if (param.in === "query" && args[param.name] !== undefined && args[param.name] !== null) {
      const val = args[param.name];
      if (Array.isArray(val)) {
        val.forEach((v) => {
          queryParams.append(param.name, safeString(v));
        });
      } else {
        queryParams.set(param.name, safeString(val));
      }
    }
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}${path}`;
  return { url, queryParams };
}

export async function executeGenericRequest(
  baseUrl: string,
  method: string,
  path: string,
  config: ExecutorConfig,
  opts: {
    bearerToken?: string;
    body?: unknown;
    customHeaders?: Record<string, string>;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  },
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

    const response = await fetchWithRetry(
      url,
      {
        method: method.toUpperCase(),
        headers: reqHeaders,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      config.maxRetries ?? 0,
    );

    return await formatResponse(response, secrets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: redactSecrets(`Error: ${msg}`, secrets) }], isError: true };
  }
}

export async function executeOperation(
  op: ResolvedOperation,
  args: Record<string, unknown>,
  config: ExecutorConfig,
): Promise<McpToolResult> {
  const callOverrides = {
    bearerToken: args.bearer_token !== undefined ? safeString(args.bearer_token) : undefined,
    customHeaders: asRecord(args.custom_headers),
  };
  const secrets = collectSecrets(config, callOverrides);

  try {
    const { url, queryParams } = buildUrl(op, args, config.baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };

    for (const param of op.parameters) {
      if (param.in === "header") {
        const argKey = `header_${param.name.toLowerCase().replace(/-/g, "_")}`;
        if (args[argKey] !== undefined && args[argKey] !== null) {
          headers[param.name] = safeString(args[argKey]);
        }
      }
    }

    applyAuth(headers, queryParams, config.authConfig, callOverrides);

    let body: string | undefined;
    const methodHasBody = ["patch", "post", "put"].includes(op.method);
    if (methodHasBody && args.body !== undefined && args.body !== null) {
      headers["Content-Type"] = op.requestBodyContentType;
      body = JSON.stringify(args.body);
    }

    const qs = queryParams.toString();
    const finalUrl = qs ? `${url}?${qs}` : url;

    const response = await fetchWithRetry(
      finalUrl,
      {
        method: op.method.toUpperCase(),
        headers,
        body,
      },
      config.maxRetries ?? 0,
    );

    return await formatResponse(response, secrets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: redactSecrets(`Error: ${msg}`, secrets) }], isError: true };
  }
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 8000;
const BASE_BACKOFF_MS = 500;

function asRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, string>;
}

/** Collects every known secret value in scope, so error/response text can be scrubbed of them. */
function collectSecrets(
  config: ExecutorConfig,
  callOverrides: { bearerToken?: string; customHeaders?: Record<string, string> },
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

/**
 * Retries on 429/502/503/504 — status codes that conventionally mean the request never reached
 * business logic (rate-limited or a gateway hiccup), so retrying is safe regardless of HTTP
 * method. Honors `Retry-After` when the API sends one (GitHub and most enterprise APIs do on
 * 429s), otherwise falls back to exponential backoff with jitter. `maxRetries` defaults to 0
 * (disabled) so this is opt-in and doesn't change default behavior.
 */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries: number): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, init);
    if (attempt >= maxRetries || !RETRYABLE_STATUS_CODES.has(response.status)) {
      return response;
    }
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const backoffMs = retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) + Math.random() * 250;
    await response.body?.cancel();
    await sleep(backoffMs);
    attempt++;
  }
}

async function formatResponse(response: Response, secrets: string[]): Promise<McpToolResult> {
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const isError = status >= 400;

  let body: string;
  if (contentType.includes("application/json")) {
    // Read the body once as text, then attempt to parse it — calling response.json() first and
    // falling back to response.text() on failure doesn't work because a failed json() call still
    // consumes the stream, so the text() fallback throws "Body is unusable: Body has already been
    // read". Some real-world APIs (e.g. Swagger's public Petstore demo) send a JSON content-type
    // header with a non-JSON body, so this fallback path is hit in practice, not just in theory.
    const text = await response.text();
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      body = text;
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

/** Parses a Retry-After header, which per RFC 9110 is either a delay in seconds or an HTTP-date. */
function parseRetryAfter(header: null | string): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

/** Scrubs known secret values out of text before it's returned as tool output. */
function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
