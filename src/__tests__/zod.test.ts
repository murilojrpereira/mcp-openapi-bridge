import { describe, expect, it } from "vitest";
import { z } from "zod";
import { schemaToZod } from "../zod.js";
import type { SchemaObject } from "../types.js";

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

  it("falls back to z.any() for allOf", () => {
    const zod = schemaToZod({ allOf: [{ type: "string" }, { type: "integer" }] });
    expect(zod.safeParse("anything").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("falls back to z.any() for anyOf", () => {
    const zod = schemaToZod({ anyOf: [{ type: "string" }] });
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("falls back to z.any() for oneOf", () => {
    const zod = schemaToZod({ oneOf: [{ type: "string" }] });
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("falls back to z.any() for unknown type", () => {
    const zod = schemaToZod({ type: "unknown-type" } as SchemaObject);
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
      expect((result.data as Record<string, unknown>)["extra"]).toBe("field");
    }
  });
});
