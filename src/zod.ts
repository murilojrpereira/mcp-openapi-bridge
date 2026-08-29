import type { SchemaObject } from "./types.js";
import { z } from "zod";

export function schemaToZod(schema: SchemaObject | undefined): z.ZodType {
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
  let base: z.ZodType;

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

function buildAllOfZod(schema: SchemaObject): z.ZodType {
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

function buildAnyOfZod(schema: SchemaObject): z.ZodType {
  const subs = (schema.anyOf ?? []).map((s) => schemaToZod(s as SchemaObject)).filter(Boolean);
  if (subs.length === 0) return z.any();
  let result = subs.length === 1 ? subs[0] : z.union(subs as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  if (schema.nullable) result = result.nullable();
  if (schema.description) result = result.describe(schema.description);
  return result;
}

function buildNumberZod(schema: SchemaObject, isInteger: boolean): z.ZodType {
  let n = isInteger ? z.number().int() : z.number();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  return n;
}

function buildObjectZod(schema: SchemaObject): z.ZodType {
  const props = schema.properties;
  if (!props || Object.keys(props).length === 0) {
    return z.record(z.string(), z.any());
  }
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    const zodField = schemaToZod(propSchema as SchemaObject);
    shape[key] = required.has(key) ? zodField : zodField.optional();
  }
  return z.looseObject(shape);
}

function buildOneOfZod(schema: SchemaObject): z.ZodType {
  const subs = (schema.oneOf ?? []).map((s) => schemaToZod(s as SchemaObject)).filter(Boolean);
  if (subs.length === 0) return z.any();
  let result = subs.length === 1 ? subs[0] : z.union(subs as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  if (schema.nullable) result = result.nullable();
  if (schema.description) result = result.describe(schema.description);
  return result;
}

function buildStringZod(schema: SchemaObject): z.ZodType {
  if (schema.enum && schema.enum.length > 0) {
    const vals = schema.enum.filter((v): v is string => typeof v === "string");
    if (vals.length === schema.enum.length && vals.length >= 2) {
      return z.enum(vals as [string, ...string[]]);
    }
    if (vals.length === 1) return z.literal(vals[0]);
  }
  let s: z._ZodString = schema.format ? stringFormatBase(schema.format) : z.string();
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

/**
 * Picks the base string schema for a declared `format`. Each of these (ZodStringFormat subtypes in
 * Zod v4) still supports chaining `.min()`/`.max()`/`.regex()`, so building the format first and
 * layering minLength/maxLength/pattern on top — rather than building those on a plain `z.string()`
 * and discarding them when format is applied afterward — preserves both the format check and any
 * additional constraints declared alongside it.
 *
 * uuid uses `z.guid()` rather than the new stricter `z.uuid()` to preserve the lenient
 * (non-RFC-9562-strict) validation OpenAPI specs generally assume.
 */
function stringFormatBase(format: string): z._ZodString {
  switch (format) {
    case "date":
      return z.iso.date();
    case "date-time":
    case "datetime":
      return z.iso.datetime();
    case "email":
      return z.email();
    case "ipv4":
      return z.ipv4();
    case "ipv6":
      return z.ipv6();
    case "time":
      return z.iso.time();
    case "uri":
    case "url":
      return z.url();
    case "uuid":
      return z.guid();
    default:
      return z.string();
  }
}
