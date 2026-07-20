import type { SchemaObject } from "../types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { schemaToZod } from "../zod.js";

describe("schemaToZod", () => {
  it("returns z.any() for undefined schema", () => {
    const zod = schemaToZod(undefined);
    expect(zod.safeParse("anything").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("maps string type", () => {
    const zod = schemaToZod({ type: "string" });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("maps integer type", () => {
    const zod = schemaToZod({ type: "integer" });
    expect(zod.safeParse(5).success).toBe(true);
    expect(zod.safeParse(5.5).success).toBe(false);
    expect(zod.safeParse("5").success).toBe(false);
  });

  it("maps number type", () => {
    const zod = schemaToZod({ type: "number" });
    expect(zod.safeParse(3.14).success).toBe(true);
    expect(zod.safeParse("3.14").success).toBe(false);
  });

  it("maps boolean type", () => {
    const zod = schemaToZod({ type: "boolean" });
    expect(zod.safeParse(true).success).toBe(true);
    expect(zod.safeParse("true").success).toBe(false);
  });

  it("maps null type", () => {
    const zod = schemaToZod({ type: "null" });
    expect(zod.safeParse(null).success).toBe(true);
    expect(zod.safeParse("null").success).toBe(false);
  });

  it("maps array type with items", () => {
    const zod = schemaToZod({ type: "array", items: { type: "string" } });
    expect(zod.safeParse(["a", "b"]).success).toBe(true);
    expect(zod.safeParse([1, 2]).success).toBe(false);
  });

  it("maps array type without items to z.array(z.any())", () => {
    const zod = schemaToZod({ type: "array" });
    expect(zod.safeParse([1, "a", null]).success).toBe(true);
  });

  it("maps object with known properties", () => {
    const schema: SchemaObject = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "integer" } },
      required: ["name"],
    };
    const zod = schemaToZod(schema);
    expect(zod.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
    expect(zod.safeParse({ name: "Alice" }).success).toBe(true);
    expect(zod.safeParse({ age: 30 }).success).toBe(false);
  });

  it("maps object without properties to z.record(z.any())", () => {
    const zod = schemaToZod({ type: "object" });
    expect(zod.safeParse({ anything: "goes" }).success).toBe(true);
  });

  it("maps string enum to z.enum()", () => {
    const zod = schemaToZod({ type: "string", enum: ["active", "inactive", "pending"] });
    expect(zod.safeParse("active").success).toBe(true);
    expect(zod.safeParse("deleted").success).toBe(false);
  });

  it("maps single-value enum to z.literal()", () => {
    const zod = schemaToZod({ type: "string", enum: ["only"] });
    expect(zod.safeParse("only").success).toBe(true);
    expect(zod.safeParse("other").success).toBe(false);
  });

  it("handles nullable schema", () => {
    const zod = schemaToZod({ type: "string", nullable: true });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(null).success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("applies string minLength and maxLength", () => {
    const zod = schemaToZod({ type: "string", minLength: 2, maxLength: 5 });
    expect(zod.safeParse("ab").success).toBe(true);
    expect(zod.safeParse("a").success).toBe(false);
    expect(zod.safeParse("toolong").success).toBe(false);
  });

  it("applies number min and max", () => {
    const zod = schemaToZod({ type: "number", minimum: 1, maximum: 10 });
    expect(zod.safeParse(5).success).toBe(true);
    expect(zod.safeParse(0).success).toBe(false);
    expect(zod.safeParse(11).success).toBe(false);
  });

  it("handles allOf as intersection", () => {
    const zod = schemaToZod({
      allOf: [
        { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        { type: "object", properties: { age: { type: "integer" } }, required: ["age"] },
      ],
    });
    expect(zod.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
    expect(zod.safeParse({ name: "Alice" }).success).toBe(false);
    expect(zod.safeParse({ age: 30 }).success).toBe(false);
  });

  it("handles allOf with a single schema", () => {
    const zod = schemaToZod({ allOf: [{ type: "string" }] });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("handles allOf with nullable", () => {
    const zod = schemaToZod({ allOf: [{ type: "string" }], nullable: true });
    expect(zod.safeParse(null).success).toBe(true);
    expect(zod.safeParse("hello").success).toBe(true);
  });

  it("handles anyOf as union", () => {
    const zod = schemaToZod({ anyOf: [{ type: "string" }, { type: "integer" }] });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(true);
    expect(zod.safeParse(true).success).toBe(false);
  });

  it("handles anyOf with a single schema", () => {
    const zod = schemaToZod({ anyOf: [{ type: "string" }] });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("handles oneOf as union", () => {
    const zod = schemaToZod({ oneOf: [{ type: "string" }, { type: "integer" }] });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("handles oneOf with a single schema", () => {
    const zod = schemaToZod({ oneOf: [{ type: "string" }] });
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("preserves description on composition schemas", () => {
    const zod = schemaToZod({ anyOf: [{ type: "string" }, { type: "integer" }], description: "An ID" });
    expect(zod.description).toBe("An ID");
  });

  it("applies date-time format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "date-time" });
    expect(zod.safeParse("2024-01-01T00:00:00Z").success).toBe(true);
    expect(zod.safeParse("not-a-date").success).toBe(false);
  });

  it("applies date format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "date" });
    expect(zod.safeParse("2024-01-01").success).toBe(true);
    expect(zod.safeParse("not-a-date").success).toBe(false);
  });

  it("applies email format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "email" });
    expect(zod.safeParse("user@example.com").success).toBe(true);
    expect(zod.safeParse("not-an-email").success).toBe(false);
  });

  it("applies uri format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "uri" });
    expect(zod.safeParse("https://example.com").success).toBe(true);
    expect(zod.safeParse("not-a-uri").success).toBe(false);
  });

  it("applies url format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "url" });
    expect(zod.safeParse("https://example.com").success).toBe(true);
    expect(zod.safeParse("not-a-url").success).toBe(false);
  });

  it("applies uuid format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "uuid" });
    expect(zod.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
    expect(zod.safeParse("not-a-uuid").success).toBe(false);
  });

  it("applies ipv4 format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "ipv4" });
    expect(zod.safeParse("192.168.1.1").success).toBe(true);
    expect(zod.safeParse("not-an-ip").success).toBe(false);
  });

  it("applies ipv6 format constraint", () => {
    const zod = schemaToZod({ type: "string", format: "ipv6" });
    expect(zod.safeParse("::1").success).toBe(true);
    expect(zod.safeParse("not-an-ip").success).toBe(false);
  });

  it("ignores unknown format", () => {
    const zod = schemaToZod({ type: "string", format: "unknown-format" });
    expect(zod.safeParse("anything").success).toBe(true);
  });

  it("falls back to z.any() for unknown type", () => {
    const zod = schemaToZod({ type: "unknown-type" });
    expect(zod.safeParse("anything").success).toBe(true);
  });

  it("preserves description", () => {
    const zod = schemaToZod({ type: "string", description: "The pet name" });
    expect((zod as z.ZodString).description).toBe("The pet name");
  });

  it("passthrough allows extra properties on objects", () => {
    const zod = schemaToZod({ type: "object", properties: { name: { type: "string" } }, required: ["name"] });
    const result = zod.safeParse({ name: "Alice", extra: "field" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).extra).toBe("field");
    }
  });
});
