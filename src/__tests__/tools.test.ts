import { describe, expect, it } from "vitest";
import { buildToolArgsSchema, operationToDescription, operationToToolName } from "../tools.js";
import type { ResolvedOperation } from "../types.js";

function makeOp(overrides: Partial<ResolvedOperation> = {}): ResolvedOperation {
  return {
    operationId: "listPets",
    method: "get",
    path: "/pets",
    parameters: [],
    requestBodyRequired: false,
    requestBodyContentType: "application/json",
    deprecated: false,
    ...overrides,
  };
}

describe("operationToToolName", () => {
  it("returns the operationId as-is", () => {
    expect(operationToToolName(makeOp({ operationId: "listPets" }))).toBe("listPets");
  });

  it("uses sanitized fallback ID", () => {
    expect(operationToToolName(makeOp({ operationId: "get_orders_id" }))).toBe("get_orders_id");
  });
});

describe("operationToDescription", () => {
  it("includes method and path", () => {
    const desc = operationToDescription(makeOp());
    expect(desc).toContain("[GET /pets]");
  });

  it("includes summary", () => {
    const desc = operationToDescription(makeOp({ summary: "List all pets" }));
    expect(desc).toContain("List all pets");
  });

  it("includes [DEPRECATED] prefix for deprecated operations", () => {
    const desc = operationToDescription(makeOp({ deprecated: true }));
    expect(desc.startsWith("[DEPRECATED]")).toBe(true);
  });

  it("truncates long descriptions to 200 chars", () => {
    const longDesc = "A".repeat(300);
    const desc = operationToDescription(makeOp({ description: longDesc }));
    expect(desc.length).toBeLessThan(350);
  });

  it("does not duplicate summary in description", () => {
    const desc = operationToDescription(makeOp({ summary: "Short", description: "Short" }));
    const count = (desc.match(/Short/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("buildToolArgsSchema", () => {
  it("always includes bearer_token and custom_headers", () => {
    const schema = buildToolArgsSchema(makeOp());
    expect(schema["bearer_token"]).toBeDefined();
    expect(schema["custom_headers"]).toBeDefined();
  });

  it("bearer_token is optional", () => {
    const schema = buildToolArgsSchema(makeOp());
    expect(schema["bearer_token"].safeParse(undefined).success).toBe(true);
    expect(schema["bearer_token"].safeParse("token").success).toBe(true);
  });

  it("custom_headers accepts record", () => {
    const schema = buildToolArgsSchema(makeOp());
    expect(schema["custom_headers"].safeParse({ "X-Foo": "bar" }).success).toBe(true);
    expect(schema["custom_headers"].safeParse(undefined).success).toBe(true);
  });

  it("maps path parameters directly by name", () => {
    const op = makeOp({
      parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["petId"]).toBeDefined();
    expect(schema["petId"].safeParse("abc").success).toBe(true);
  });

  it("marks required params as required in schema", () => {
    const op = makeOp({
      parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["petId"].safeParse(undefined).success).toBe(false);
  });

  it("marks optional params as optional in schema", () => {
    const op = makeOp({
      parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer" } }],
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["limit"].safeParse(undefined).success).toBe(true);
  });

  it("prefixes header params with header_", () => {
    const op = makeOp({
      parameters: [{ name: "X-Request-ID", in: "header", schema: { type: "string" } }],
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["header_x_request_id"]).toBeDefined();
    expect(schema["X-Request-ID"]).toBeUndefined();
  });

  it("adds body for operations with requestBody", () => {
    const op = makeOp({
      method: "post",
      requestBodySchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      requestBodyRequired: true,
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["body"]).toBeDefined();
    expect(schema["body"].safeParse(undefined).success).toBe(false);
    expect(schema["body"].safeParse({ name: "Spot" }).success).toBe(true);
  });

  it("body is optional when requestBodyRequired is false", () => {
    const op = makeOp({
      method: "post",
      requestBodySchema: { type: "object" },
      requestBodyRequired: false,
    });
    const schema = buildToolArgsSchema(op);
    expect(schema["body"].safeParse(undefined).success).toBe(true);
  });
});
