import type { SchemaObject } from "./types.js";
import { z } from "zod";

export function schemaToZod(schema: SchemaObject | undefined): z.ZodTypeAny {
  if (!schema) return z.any();

  if (schema.allOf) {
    return buildAllOfZod(schema);
  }

  if (schema.anyOf) {
    return buildAnyOfZod(schema);
  }

  if (schema.oneOf) {
    return buildOneOfZod(schema);
  }

  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  let base: z.ZodTypeAny;

  switch (rawType) {
    case "array":
      base = schema.items ? z.array(schemaToZod(schema.items as SchemaObject)) : z.array(z.any());
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "integer":
    case "number":
      base = buildNumberZod(schema, rawType === "integer");
      break;
    case "null":
      base = z.null();
      break;
    case "object":
      base = buildObjectZod(schema);
      break;
    case "string":
      base = buildStringZod(schema);
      break;
    default:
      base = z.any();
  }

  if (schema.nullable) base = base.nullable();
  if (schema.description) base = base.describe(schema.description);

  return base;
}

function applyStringFormat(s: z.ZodString, format: string): z.ZodString {
  switch (format) {
    case "date":
      return s.date();
    case "date-time":
    case "datetime":
      return s.datetime();
    case "email":
      return s.email();
    case "ipv4":
      return s.ip({ version: "v4" });
    case "ipv6":
      return s.ip({ version: "v6" });
    case "time":
      return s.time();
    case "uri":
    case "url":
      return s.url();
    case "uuid":
      return s.uuid();
    default:
      return s;
  }
}

function buildAllOfZod(schema: SchemaObject): z.ZodTypeAny {
  const subs = (schema.allOf ?? []).map((s) => schemaToZod(s as SchemaObject)).filter(Boolean);
  if (subs.length === 0) return z.any();
  if (subs.length === 1) {
    let result = subs[0];
    if (schema.nullable) result = result.nullable();
    if (schema.description) result = result.describe(schema.description);
    return result;
  }
  let result = subs.reduce((acc, s) => z.intersection(acc, s));
  if (schema.nullable) result = result.nullable();
  if (schema.description) result = result.describe(schema.description);
  return result;
}

function buildAnyOfZod(schema: SchemaObject): z.ZodTypeAny {
  const subs = (schema.anyOf ?? []).map((s) => schemaToZod(s as SchemaObject)).filter(Boolean);
  if (subs.length === 0) return z.any();
  let result = subs.length === 1 ? subs[0] : z.union(subs as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  if (schema.nullable) result = result.nullable();
  if (schema.description) result = result.describe(schema.description);
  return result;
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

function buildOneOfZod(schema: SchemaObject): z.ZodTypeAny {
  const subs = (schema.oneOf ?? []).map((s) => schemaToZod(s as SchemaObject)).filter(Boolean);
  if (subs.length === 0) return z.any();
  let result = subs.length === 1 ? subs[0] : z.union(subs as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  if (schema.nullable) result = result.nullable();
  if (schema.description) result = result.describe(schema.description);
  return result;
}

function buildStringZod(schema: SchemaObject): z.ZodTypeAny {
  if (schema.enum && schema.enum.length > 0) {
    const vals = schema.enum.filter((v): v is string => typeof v === "string");
    if (vals.length === schema.enum.length && vals.length >= 2) {
      return z.enum(vals as [string, ...string[]]);
    }
    if (vals.length === 1) return z.literal(vals[0]);
  }
  let s: z.ZodString = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern) {
    try {
      s = s.regex(new RegExp(schema.pattern));
    } catch {
      // ignore invalid regex patterns
    }
  }
  if (schema.format) {
    s = applyStringFormat(s, schema.format);
  }
  return s;
}
