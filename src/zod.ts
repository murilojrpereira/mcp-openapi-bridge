import { z } from "zod";
import type { SchemaObject } from "./types.js";

export function schemaToZod(schema: SchemaObject | undefined): z.ZodTypeAny {
  if (!schema) return z.any();

  if (schema.allOf || schema.anyOf || schema.oneOf) {
    const base = z.any();
    return schema.description ? base.describe(schema.description) : base;
  }

  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  let base: z.ZodTypeAny;

  switch (rawType) {
    case "string":
      base = buildStringZod(schema);
      break;
    case "integer":
    case "number":
      base = buildNumberZod(schema, rawType === "integer");
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "null":
      base = z.null();
      break;
    case "array":
      base = schema.items
        ? z.array(schemaToZod(schema.items as SchemaObject))
        : z.array(z.any());
      break;
    case "object":
      base = buildObjectZod(schema);
      break;
    default:
      base = z.any();
  }

  if (schema.nullable) base = base.nullable() as z.ZodTypeAny;
  if (schema.description) base = base.describe(schema.description);

  return base;
}

function buildStringZod(schema: SchemaObject): z.ZodTypeAny {
  if (schema.enum && schema.enum.length > 0) {
    const vals = schema.enum.filter((v): v is string => typeof v === "string");
    if (vals.length === schema.enum.length && vals.length >= 2) {
      return z.enum(vals as [string, ...string[]]);
    }
    if (vals.length === 1) return z.literal(vals[0]);
  }
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern) {
    try {
      s = s.regex(new RegExp(schema.pattern));
    } catch {
      // ignore invalid regex patterns
    }
  }
  return s;
}

function buildNumberZod(schema: SchemaObject, isInteger: boolean): z.ZodTypeAny {
  let n = isInteger ? z.number().int() : z.number();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  return n;
}

function buildObjectZod(schema: SchemaObject): z.ZodTypeAny {
  const props = schema.properties;
  if (!props || Object.keys(props).length === 0) {
    return z.record(z.any());
  }
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    const zodField = schemaToZod(propSchema as SchemaObject);
    shape[key] = required.has(key) ? zodField : zodField.optional();
  }
  return z.object(shape).passthrough();
}
