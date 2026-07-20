import type { AuthConfig, ExecutorConfig, ResolvedOperation } from "../types.js";
import { describe, expect, it } from "vitest";
import { executeOperation } from "../executor.js";

// Opt-in: hits the real public Swagger Petstore demo (https://petstore3.swagger.io), so it's
// skipped by default to keep the standard suite hermetic and CI free of network flakiness.
// Run explicitly with: RUN_LIVE_TESTS=1 npx vitest run src/__tests__/live-smoke.test.ts
//
// This exists because a real bug (executor.ts formatResponse crashing on a JSON content-type
// with a non-JSON body) was invisible to the fully-mocked unit tests — every mock always
// resolved response.json() successfully, which no real API is obligated to do.
const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

const noAuth: AuthConfig = { customHeaders: {} };
const config: ExecutorConfig = { baseUrl: "https://petstore3.swagger.io/api/v3", authConfig: noAuth };

function makeOp(overrides: Partial<ResolvedOperation> = {}): ResolvedOperation {
  return {
    operationId: "liveTestOp",
    method: "get",
    path: "/pet/findByStatus",
    parameters: [{ name: "status", in: "query", required: true }],
    requestBodyRequired: false,
    requestBodyContentType: "application/json",
    deprecated: false,
    ...overrides,
  };
}

describe.runIf(RUN_LIVE)("live smoke test: public Swagger Petstore demo", () => {
  it("handles a real successful JSON response", async () => {
    const result = await executeOperation(makeOp(), { status: "available" }, config);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("HTTP 200");
  });

  it("handles a real 404 without throwing, even when content-type says application/json but the body isn't JSON", async () => {
    const op = makeOp({
      operationId: "getPetById",
      path: "/pet/{petId}",
      parameters: [{ name: "petId", in: "path", required: true }],
    });
    const result = await executeOperation(op, { petId: 1 }, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
  });
});
