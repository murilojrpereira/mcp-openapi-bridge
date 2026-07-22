import type {
  HttpMethod,
  OpenAPISpec,
  Operation,
  Parameter,
  Ref,
  RequestBody,
  ResolvedOperation,
  ResolvedParameter,
  SchemaObject,
  SpecFilters,
} from "./types.js";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import yaml from "yaml";

export function isRef(obj: unknown): obj is Ref {
  return typeof obj === "object" && obj !== null && "$ref" in obj;
}

export function resolveRef<T>(ref: Ref, spec: OpenAPISpec): T {
  if (!ref.$ref.startsWith("#/")) {
    throw new Error(`External $ref not supported: ${ref.$ref}`);
  }
  const parts = ref.$ref.replace(/^#\//, "").split("/");
  let current: unknown = spec;
  for (const part of parts) {
    const decoded = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof current !== "object" || current === null) {
      throw new Error(`Cannot traverse $ref path at "${decoded}" in: ${ref.$ref}`);
    }
    current = (current as Record<string, unknown>)[decoded];
  }
  if (current === undefined) throw new Error(`$ref target not found: ${ref.$ref}`);
  return current as T;
}

const MAX_SCHEMA_DEPTH = 20;

export function resolveSchema(
  schemaOrRef: Ref | SchemaObject | undefined,
  spec: OpenAPISpec,
  seen = new Set<string>(),
  depth = 0,
): SchemaObject | undefined {
  if (!schemaOrRef) return undefined;
  if (depth > MAX_SCHEMA_DEPTH) return { type: "object", description: "[max depth exceeded]" };
  if (isRef(schemaOrRef)) {
    const refStr = schemaOrRef.$ref;
    if (!refStr.startsWith("#/")) return { type: "object", description: "[external $ref not supported]" };
    if (seen.has(refStr)) return { type: "object", description: "[circular]" };
    const next = new Set(seen);
    next.add(refStr);
    try {
      const resolved = resolveRef<Ref | SchemaObject>(schemaOrRef, spec);
      return resolveSchema(resolved, spec, next, depth + 1);
    } catch {
      return { type: "object", description: `[unresolved: ${refStr}]` };
    }
  }
  return schemaOrRef;
}

function pathToFallbackId(method: string, path: string): string {
  const sanitizedPath = path
    .replace(/\{([^}]+)\}/g, "$1")
    .replace(/\//g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
  return `${method}_${sanitizedPath}`;
}

function resolveParameter(paramOrRef: Parameter | Ref, spec: OpenAPISpec): null | ResolvedParameter {
  let param: Parameter;
  try {
    param = isRef(paramOrRef) ? resolveRef<Parameter>(paramOrRef, spec) : paramOrRef;
  } catch {
    return null;
  }
  const schema = resolveSchema(param.schema, spec);
  return { ...param, schema };
}

function resolveRequestBody(
  bodyOrRef: Ref | RequestBody | undefined,
  spec: OpenAPISpec,
): { contentType: string; required: boolean; schema?: SchemaObject } {
  if (!bodyOrRef) return { required: false, contentType: "application/json" };

  let body: RequestBody;
  try {
    body = isRef(bodyOrRef) ? resolveRef<RequestBody>(bodyOrRef, spec) : bodyOrRef;
  } catch {
    return { required: false, contentType: "application/json" };
  }

  const entries = Object.entries(body.content);
  if (entries.length === 0) {
    return { required: body.required ?? false, contentType: "application/json" };
  }
  const [contentType, targetContent] = entries.find(([key]) => key === "application/json") ?? entries[0];

  return {
    contentType,
    required: body.required ?? false,
    schema: resolveSchema(targetContent.schema, spec),
  };
}

function sanitizeOperationId(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const UNTAGGED = "(untagged)";

export function extractOperations(spec: OpenAPISpec, filters: SpecFilters): ResolvedOperation[] {
  const paths = spec.paths ?? {};
  const results: ResolvedOperation[] = [];
  const seenIds = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(paths)) {
    if (filters.pathPrefix && !path.startsWith(filters.pathPrefix)) continue;

    const pathLevelParams: (Parameter | Ref)[] = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const operation: Operation | undefined = pathItem[method];
      if (!operation) continue;
      if (results.length >= filters.maxTools) {
        const cutOffTags = summarizeCutOffTags(spec, filters, results);
        console.error(
          `[mcp-openapi-bridge] Reached OPENAPI_MAX_TOOLS=${filters.maxTools}. Tags with operations cut off: ${cutOffTags}. Use OPENAPI_INCLUDE_TAGS or OPENAPI_PATH_PREFIX to narrow scope, or raise OPENAPI_MAX_TOOLS.`,
        );
        return results;
      }

      const tags = operation.tags ?? [];
      if (!matchesTagFilters(tags, filters)) continue;

      const rawId = operation.operationId ? sanitizeOperationId(operation.operationId) : pathToFallbackId(method, path);

      const count = seenIds.get(rawId) ?? 0;
      seenIds.set(rawId, count + 1);
      const operationId = count === 0 ? rawId : `${rawId}_${count + 1}`;
      if (count > 0) {
        console.error(`[mcp-openapi-bridge] Duplicate operationId "${rawId}" — registered as "${operationId}"`);
      }

      const allParamRefs = [...pathLevelParams, ...(operation.parameters ?? [])];
      const parameters: ResolvedParameter[] = allParamRefs
        .map((p) => resolveParameter(p, spec))
        .filter((p): p is ResolvedParameter => p !== null && p.in !== "cookie");

      const {
        schema: requestBodySchema,
        required: requestBodyRequired,
        contentType: requestBodyContentType,
      } = resolveRequestBody(operation.requestBody, spec);

      results.push({
        operationId,
        method,
        path,
        summary: operation.summary,
        description: operation.description,
        tags,
        parameters,
        requestBodySchema,
        requestBodyRequired,
        requestBodyContentType,
        deprecated: operation.deprecated ?? false,
      });
    }
  }

  return results;
}

export function loadAndParseSpec(rawText: string, filePath?: string): OpenAPISpec {
  const looksLikeYaml =
    filePath?.match(/\.(yaml|yml)$/i) !== null ||
    (!rawText.trimStart().startsWith("{") && !rawText.trimStart().startsWith("["));
  const parsed = looksLikeYaml ? (yaml.parse(rawText) as unknown) : (JSON.parse(rawText) as unknown);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid OpenAPI spec: not an object.");
  }
  const obj = parsed as Record<string, unknown>;
  const swaggerVersion = obj.swagger;
  if (typeof swaggerVersion === "string") {
    throw new Error(
      `Unsupported OpenAPI version "${swaggerVersion}" (Swagger/OpenAPI 2.x). Only OpenAPI 3.x is supported.`,
    );
  }
  if (typeof obj.openapi !== "string") {
    throw new Error("Invalid OpenAPI spec: missing or non-string 'openapi' field.");
  }
  const version = obj.openapi;
  if (!version.startsWith("3.")) {
    throw new Error(`Unsupported OpenAPI version "${version}". Only OpenAPI 3.x is supported.`);
  }
  return parsed as OpenAPISpec;
}

export async function loadSpec(): Promise<OpenAPISpec> {
  const specPath = process.env.OPENAPI_SPEC_PATH;
  const specUrl = process.env.OPENAPI_SPEC_URL;

  if (specPath) {
    const raw = readFileSync(specPath, "utf-8");
    return loadAndParseSpec(raw, specPath);
  }

  if (specUrl) {
    const raw = await fetchSpecWithCache(specUrl);
    return loadAndParseSpec(raw, specUrl);
  }

  throw new Error("OPENAPI_SPEC_PATH or OPENAPI_SPEC_URL must be set.");
}

async function fetchSpecWithCache(url: string): Promise<string> {
  const cachePath = getCachePath(url);
  const cacheTtl = parseInt(process.env.OPENAPI_SPEC_CACHE_TTL_SECONDS ?? "3600", 10) * 1000;

  if (existsSync(cachePath)) {
    const stat = statSync(cachePath);
    if (Date.now() - stat.mtimeMs < cacheTtl) {
      console.error(`[mcp-openapi-bridge] Using cached spec from ${cachePath}`);
      return readFileSync(cachePath, "utf-8");
    }
  }

  console.error(`[mcp-openapi-bridge] Fetching spec from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
  const text = await res.text();
  writeFileSync(cachePath, text, "utf-8");
  return text;
}

function getCachePath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const cacheDir = join(homedir(), ".cache", "mcp-openapi-bridge");
  mkdirSync(cacheDir, { recursive: true });
  return join(cacheDir, `${hash}.json`);
}

function matchesTagFilters(tags: string[], filters: SpecFilters): boolean {
  const { includeTags, excludeTags } = filters;
  if (includeTags && includeTags.length > 0 && !tags.some((t) => includeTags.includes(t))) return false;
  if (excludeTags && excludeTags.length > 0 && tags.some((t) => excludeTags.includes(t))) return false;
  return true;
}

/**
 * Reports which tags lost operations to the OPENAPI_MAX_TOOLS cap, e.g. "repos (0/203), issues
 * (1/55)". Without this, truncating a large spec (GitHub, Stripe) silently registers whatever
 * operations happen to appear first in the spec's path order, which can leave entire tags —
 * including ones a user would expect, like "repos" — completely unregistered with no indication
 * why. This is a second, cheap, tags-only pass over the spec (no schema resolution), so it's only
 * paid for in the truncation case.
 */
function summarizeCutOffTags(spec: OpenAPISpec, filters: SpecFilters, registered: ResolvedOperation[]): string {
  const registeredCounts = new Map<string, number>();
  for (const op of registered) {
    for (const tag of op.tags && op.tags.length > 0 ? op.tags : [UNTAGGED]) {
      registeredCounts.set(tag, (registeredCounts.get(tag) ?? 0) + 1);
    }
  }

  const totalCounts = new Map<string, number>();
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (filters.pathPrefix && !path.startsWith(filters.pathPrefix)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const tags = operation.tags ?? [];
      if (!matchesTagFilters(tags, filters)) continue;
      for (const tag of tags.length > 0 ? tags : [UNTAGGED]) {
        totalCounts.set(tag, (totalCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const cutOff: string[] = [];
  for (const [tag, total] of totalCounts) {
    const got = registeredCounts.get(tag) ?? 0;
    if (got < total) cutOff.push(`${tag} (${got}/${total})`);
  }
  return cutOff.length > 0 ? cutOff.sort().join(", ") : "(none)";
}
