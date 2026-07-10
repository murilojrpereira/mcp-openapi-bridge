import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAuth, parseCustomHeaders, resolveAuthConfig } from "../auth.js";

describe("parseCustomHeaders", () => {
  it("parses key=value pairs", () => {
    expect(parseCustomHeaders("X-Foo=bar,X-Baz=qux")).toEqual({ "X-Foo": "bar", "X-Baz": "qux" });
  });

  it("handles values with = sign", () => {
    expect(parseCustomHeaders("Token=abc=def")).toEqual({ Token: "abc=def" });
  });

  it("returns empty object for empty string", () => {
    expect(parseCustomHeaders("")).toEqual({});
    expect(parseCustomHeaders("  ")).toEqual({});
  });

  it("skips pairs without =", () => {
    expect(parseCustomHeaders("NoEquals,Key=val")).toEqual({ Key: "val" });
  });

  it("trims whitespace from keys and values", () => {
    expect(parseCustomHeaders(" X-Key = value ")).toEqual({ "X-Key": "value" });
  });
});

describe("resolveAuthConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAPI_TOKEN;
    delete process.env.OPENAPI_API_KEY;
    delete process.env.OPENAPI_API_KEY_HEADER;
    delete process.env.OPENAPI_API_KEY_PARAM;
    delete process.env.OPENAPI_CUSTOM_HEADERS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty authConfig when no vars set", () => {
    const config = resolveAuthConfig();
    expect(config.bearerToken).toBeUndefined();
    expect(config.apiKeyHeader).toBeUndefined();
    expect(config.apiKeyQuery).toBeUndefined();
    expect(config.customHeaders).toEqual({});
  });

  it("sets bearerToken from OPENAPI_TOKEN", () => {
    process.env.OPENAPI_TOKEN = "my-token";
    const config = resolveAuthConfig();
    expect(config.bearerToken).toBe("my-token");
  });

  it("sets apiKeyHeader from OPENAPI_API_KEY + OPENAPI_API_KEY_HEADER", () => {
    process.env.OPENAPI_API_KEY = "secret";
    process.env.OPENAPI_API_KEY_HEADER = "X-API-Key";
    const config = resolveAuthConfig();
    expect(config.apiKeyHeader).toEqual({ name: "X-API-Key", value: "secret" });
  });

  it("sets apiKeyQuery from OPENAPI_API_KEY + OPENAPI_API_KEY_PARAM", () => {
    process.env.OPENAPI_API_KEY = "secret";
    process.env.OPENAPI_API_KEY_PARAM = "api_key";
    const config = resolveAuthConfig();
    expect(config.apiKeyQuery).toEqual({ param: "api_key", value: "secret" });
  });

  it("parses OPENAPI_CUSTOM_HEADERS", () => {
    process.env.OPENAPI_CUSTOM_HEADERS = "X-Tenant=abc,X-Region=us-east-1";
    const config = resolveAuthConfig();
    expect(config.customHeaders).toEqual({ "X-Tenant": "abc", "X-Region": "us-east-1" });
  });

  it("can have bearer + api key + custom headers simultaneously", () => {
    process.env.OPENAPI_TOKEN = "token";
    process.env.OPENAPI_API_KEY = "key";
    process.env.OPENAPI_API_KEY_HEADER = "X-Key";
    process.env.OPENAPI_CUSTOM_HEADERS = "X-Extra=val";
    const config = resolveAuthConfig();
    expect(config.bearerToken).toBe("token");
    expect(config.apiKeyHeader?.name).toBe("X-Key");
    expect(config.customHeaders["X-Extra"]).toBe("val");
  });
});

describe("applyAuth", () => {
  it("sets Authorization header for bearer token", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(headers, query, { customHeaders: {}, bearerToken: "tok" }, {});
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("per-call bearer_token overrides global bearer", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(headers, query, { customHeaders: {}, bearerToken: "global" }, { bearerToken: "per-call" });
    expect(headers.Authorization).toBe("Bearer per-call");
  });

  it("sets custom header for apiKeyHeader", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(headers, query, { customHeaders: {}, apiKeyHeader: { name: "X-API-Key", value: "abc" } }, {});
    expect(headers["X-API-Key"]).toBe("abc");
  });

  it("sets query param for apiKeyQuery", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(headers, query, { customHeaders: {}, apiKeyQuery: { param: "api_key", value: "secret" } }, {});
    expect(query.get("api_key")).toBe("secret");
  });

  it("merges global custom headers with per-call custom headers (per-call wins)", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(
      headers,
      query,
      { customHeaders: { "X-Global": "global", "X-Shared": "base" } },
      { customHeaders: { "X-Call": "call", "X-Shared": "override" } },
    );
    expect(headers["X-Global"]).toBe("global");
    expect(headers["X-Call"]).toBe("call");
    expect(headers["X-Shared"]).toBe("override");
  });

  it("applies bearer + api key + custom headers simultaneously", () => {
    const headers: Record<string, string> = {};
    const query = new URLSearchParams();
    applyAuth(
      headers,
      query,
      {
        bearerToken: "tok",
        apiKeyHeader: { name: "X-Key", value: "k" },
        customHeaders: { "X-Extra": "v" },
      },
      {},
    );
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Key"]).toBe("k");
    expect(headers["X-Extra"]).toBe("v");
  });
});
