import type { AuthConfig } from "./types.js";

export function applyAuth(
  headers: Record<string, string>,
  query: URLSearchParams,
  authConfig: AuthConfig,
  callOverrides: { bearerToken?: string; customHeaders?: Record<string, string> },
): void {
  const effectiveBearer = callOverrides.bearerToken ?? authConfig.bearerToken;
  if (effectiveBearer) {
    headers.Authorization = `Bearer ${effectiveBearer}`;
  }

  if (authConfig.apiKeyHeader) {
    headers[authConfig.apiKeyHeader.name] = authConfig.apiKeyHeader.value;
  }

  if (authConfig.apiKeyQuery) {
    query.set(authConfig.apiKeyQuery.param, authConfig.apiKeyQuery.value);
  }

  const mergedCustom = { ...authConfig.customHeaders, ...(callOverrides.customHeaders ?? {}) };
  for (const [name, value] of Object.entries(mergedCustom)) {
    headers[name] = value;
  }
}

export function parseCustomHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw.trim()) return result;
  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function resolveAuthConfig(): AuthConfig {
  const token = process.env.OPENAPI_TOKEN;
  const apiKey = process.env.OPENAPI_API_KEY;
  const apiKeyHeader = process.env.OPENAPI_API_KEY_HEADER;
  const apiKeyParam = process.env.OPENAPI_API_KEY_PARAM;
  const rawCustomHeaders = process.env.OPENAPI_CUSTOM_HEADERS ?? "";

  const authConfig: AuthConfig = {
    customHeaders: parseCustomHeaders(rawCustomHeaders),
  };

  if (token) authConfig.bearerToken = token;
  if (apiKey && apiKeyHeader) authConfig.apiKeyHeader = { name: apiKeyHeader, value: apiKey };
  if (apiKey && apiKeyParam) authConfig.apiKeyQuery = { param: apiKeyParam, value: apiKey };

  return authConfig;
}
