export interface AuthConfig {
  apiKeyHeader?: { name: string; value: string };
  apiKeyQuery?: { param: string; value: string };
  bearerToken?: string;
  customHeaders: Record<string, string>;
}

export interface Components {
  parameters?: Record<string, Parameter | Ref>;
  requestBodies?: Record<string, Ref | RequestBody>;
  responses?: Record<string, Ref | Response>;
  schemas?: Record<string, Ref | SchemaObject>;
  securitySchemes?: Record<string, Ref | SecurityScheme>;
}

export interface ExecutorConfig {
  authConfig: AuthConfig;
  baseUrl: string;
  /** Number of retries for 429/502/503/504 responses, honoring Retry-After when present. 0 disables retries (default). */
  maxRetries?: number;
}

export type HttpMethod = "delete" | "get" | "head" | "options" | "patch" | "post" | "put" | "trace";

export interface McpToolResult {
  [key: string]: unknown;
  content: { text: string; type: "text" }[];
  isError?: boolean;
}

export interface MediaType {
  schema?: Ref | SchemaObject;
}

export interface OpenAPISpec {
  components?: Components;
  info: { description?: string; title: string; version: string };
  openapi: string;
  paths?: Record<string, PathItem>;
  security?: SecurityRequirement[];
  servers?: { description?: string; url: string }[];
  tags?: { description?: string; name: string }[];
}

export interface Operation {
  deprecated?: boolean;
  description?: string;
  operationId?: string;
  parameters?: (Parameter | Ref)[];
  requestBody?: Ref | RequestBody;
  responses?: Record<string, Ref | Response>;
  security?: SecurityRequirement[];
  summary?: string;
  tags?: string[];
}

export interface Parameter {
  description?: string;
  explode?: boolean;
  in: "cookie" | "header" | "path" | "query";
  name: string;
  required?: boolean;
  schema?: Ref | SchemaObject;
  style?: string;
}

export interface PathItem {
  delete?: Operation;
  description?: string;
  get?: Operation;
  head?: Operation;
  options?: Operation;
  parameters?: (Parameter | Ref)[];
  patch?: Operation;
  post?: Operation;
  put?: Operation;
  summary?: string;
  trace?: Operation;
}

export interface Ref {
  $ref: string;
}

export interface RequestBody {
  content: Record<string, MediaType>;
  description?: string;
  required?: boolean;
}

export interface ResolvedOperation {
  deprecated: boolean;
  description?: string;
  method: HttpMethod;
  operationId: string;
  parameters: ResolvedParameter[];
  path: string;
  requestBodyContentType: string;
  requestBodyRequired: boolean;
  requestBodySchema?: SchemaObject;
  summary?: string;
  tags?: string[];
}

export type ResolvedParameter = {
  schema?: SchemaObject;
} & Omit<Parameter, "schema">;

export interface Response {
  content?: Record<string, MediaType>;
  description: string;
}

export interface SchemaObject {
  additionalProperties?: boolean | Ref | SchemaObject;
  allOf?: (Ref | SchemaObject)[];
  anyOf?: (Ref | SchemaObject)[];
  default?: unknown;
  description?: string;
  enum?: unknown[];
  format?: string;
  items?: Ref | SchemaObject;
  maximum?: number;
  maxLength?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  oneOf?: (Ref | SchemaObject)[];
  pattern?: string;
  properties?: Record<string, Ref | SchemaObject>;
  required?: string[];
  type?: string | string[];
}

export type SecurityRequirement = Record<string, string[]>;

export type SecurityScheme =
  | { bearerFormat?: string; description?: string; scheme: "bearer"; type: "http" }
  | { description?: string; flows: object; type: "oauth2" }
  | { description?: string; in: "cookie" | "header" | "query"; name: string; type: "apiKey" }
  | { description?: string; openIdConnectUrl: string; type: "openIdConnect" }
  | { description?: string; scheme: "basic"; type: "http" };

export interface SpecFilters {
  excludeTags?: string[];
  includeTags?: string[];
  maxTools: number;
  pathPrefix?: string;
}
