import type { AuthConfig, ExecutorConfig, ResolvedOperation } from "../types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUrl, executeOperation } from "../executor.js";

const noAuth: AuthConfig = { customHeaders: {} };
const config: ExecutorConfig = { baseUrl: "https://api.example.com", authConfig: noAuth };

function makeOp(overrides: Partial<ResolvedOperation> = {}): ResolvedOperation {
  return {
    operationId: "testOp",
    method: "get",
    path: "/items",
    parameters: [],
    requestBodyRequired: false,
    requestBodyContentType: "application/json",
    deprecated: false,
    ...overrides,
  };
}

describe("buildUrl", () => {
  it("returns base + path with no params", () => {
    const { url, queryParams } = buildUrl(makeOp(), {}, "https://api.example.com");
    expect(url).toBe("https://api.example.com/items");
    expect(queryParams.toString()).toBe("");
  });

  it("injects path parameters", () => {
    const op = makeOp({
      path: "/orders/{orderId}/items/{itemId}",
      parameters: [
        { name: "orderId", in: "path", required: true },
        { name: "itemId", in: "path", required: true },
      ],
    });
    const { url } = buildUrl(op, { orderId: "42", itemId: "7" }, "https://api.example.com");
    expect(url).toBe("https://api.example.com/orders/42/items/7");
  });

  it("URL-encodes path parameter values", () => {
    const op = makeOp({
      path: "/items/{id}",
      parameters: [{ name: "id", in: "path", required: true }],
    });
    const { url } = buildUrl(op, { id: "hello world/test" }, "https://api.example.com");
    expect(url).toBe("https://api.example.com/items/hello%20world%2Ftest");
  });

  it("throws for missing required path parameter", () => {
    const op = makeOp({
      path: "/items/{id}",
      parameters: [{ name: "id", in: "path", required: true }],
    });
    expect(() => buildUrl(op, {}, "https://api.example.com")).toThrow('Missing required path parameter: "id"');
  });

  it("appends query parameters", () => {
    const op = makeOp({
      parameters: [
        { name: "limit", in: "query" },
        { name: "offset", in: "query" },
      ],
    });
    const { queryParams } = buildUrl(op, { limit: 10, offset: 20 }, "https://api.example.com");
    expect(queryParams.get("limit")).toBe("10");
    expect(queryParams.get("offset")).toBe("20");
  });

  it("skips undefined/null query parameters", () => {
    const op = makeOp({ parameters: [{ name: "opt", in: "query" }] });
    const { queryParams } = buildUrl(op, {}, "https://api.example.com");
    expect(queryParams.has("opt")).toBe(false);
  });

  it("appends array query parameters", () => {
    const op = makeOp({ parameters: [{ name: "tags", in: "query" }] });
    const { queryParams } = buildUrl(op, { tags: ["a", "b"] }, "https://api.example.com");
    expect(queryParams.getAll("tags")).toEqual(["a", "b"]);
  });

  it("strips trailing slash from base URL", () => {
    const { url } = buildUrl(makeOp(), {}, "https://api.example.com/");
    expect(url).toBe("https://api.example.com/items");
  });
});

describe("executeOperation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(status: number, body: unknown, contentType = "application/json") {
    const text = contentType.includes("application/json") ? JSON.stringify(body) : String(body);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status,
        headers: {
          get: (key: string) => (key === "content-type" ? contentType : null),
        },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(text),
        body: null,
      }),
    );
  }

  /** Mimics a fetch Response whose body is not valid JSON (e.g. plain text) but is served with an
   * `application/json` content-type — a real quirk observed against Swagger's public Petstore demo. */
  function mockFetchMalformedJson(status: number, rawText: string, contentType = "application/json") {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status,
        headers: {
          get: (key: string) => (key === "content-type" ? contentType : null),
        },
        json: () => Promise.reject(new SyntaxError(`Unexpected token in JSON`)),
        text: () => Promise.resolve(rawText),
        body: null,
      }),
    );
  }

  it("returns JSON response on 200", async () => {
    mockFetch(200, { id: 1, name: "Fluffy" });
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("HTTP 200");
    expect(result.content[0].text).toContain('"name": "Fluffy"');
  });

  it("returns isError true for 4xx responses", async () => {
    mockFetch(404, { error: "Not found" });
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
  });

  it("returns isError true for 5xx responses", async () => {
    mockFetch(500, { error: "Server error" });
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.isError).toBe(true);
  });

  it("passes bearer_token from args", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => "application/json" },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
    });
    vi.stubGlobal("fetch", fetchMock);
    await executeOperation(makeOp(), { bearer_token: "per-call-token" }, config);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer per-call-token");
  });

  it("passes custom_headers from args", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => "application/json" },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
    });
    vi.stubGlobal("fetch", fetchMock);
    await executeOperation(makeOp(), { custom_headers: { "X-Tenant": "abc" } }, config);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Tenant"]).toBe("abc");
  });

  it("sends body for POST operations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      headers: { get: () => "application/json" },
      json: () => Promise.resolve({ id: 2 }),
      text: () => Promise.resolve('{"id":2}'),
    });
    vi.stubGlobal("fetch", fetchMock);
    const op = makeOp({
      method: "post",
      path: "/items",
      requestBodyRequired: true,
      requestBodyContentType: "application/json",
    });
    await executeOperation(op, { body: { name: "Spot" } }, config);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Spot" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns error message when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
  });

  it("handles text/plain response", async () => {
    mockFetch(200, "plain text body", "text/plain");
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.content[0].text).toContain("plain text body");
  });

  it("falls back to raw text without throwing when content-type is application/json but the body isn't valid JSON", async () => {
    mockFetchMalformedJson(404, "Pet not found");
    const result = await executeOperation(makeOp(), {}, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
    expect(result.content[0].text).toContain("Pet not found");
  });
});

describe("executeOperation retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mockResponse(status: number, retryAfter: null | string = null) {
    return {
      status,
      headers: { get: (key: string) => (key === "retry-after" ? retryAfter : "application/json") },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
      body: { cancel: () => Promise.resolve() },
    };
  }

  it("does not retry when maxRetries is unset (default off)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(429));
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeOperation(makeOp(), {}, config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
  });

  it("retries on 429 up to maxRetries and returns the eventual success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(429, "0")).mockResolvedValueOnce(mockResponse(200));
    vi.stubGlobal("fetch", fetchMock);
    const retryConfig = { ...config, maxRetries: 2 };
    const promise = executeOperation(makeOp(), {}, retryConfig);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeFalsy();
  });

  it("gives up after maxRetries and returns the last error response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503));
    vi.stubGlobal("fetch", fetchMock);
    const retryConfig = { ...config, maxRetries: 2 };
    const promise = executeOperation(makeOp(), {}, retryConfig);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(result.isError).toBe(true);
  });

  it("does not retry non-retryable status codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    const retryConfig = { ...config, maxRetries: 3 };
    await executeOperation(makeOp(), {}, retryConfig);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
