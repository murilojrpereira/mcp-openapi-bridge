export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, PathItem>;
  components?: Components;
  security?: SecurityRequirement[];
  tags?: Array<{ name: string; description?: string }>;
}

export interface PathItem {
  summary?: string;
  description?: string;
  get?: Operation;
  put?: Operation;
  post?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  patch?: Operation;
  trace?: Operation;
  parameters?: Array<Parameter | Ref>;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<Parameter | Ref>;
  requestBody?: RequestBody | Ref;
  responses?: Record<string, Response | Ref>;
  security?: SecurityRequirement[];
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject | Ref;
  style?: string;
  explode?: boolean;
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, MediaType>;
}

export interface MediaType {
  schema?: SchemaObject | Ref;
}

export interface Response {
  description: string;
  content?: Record<string, MediaType>;
}

export interface SchemaObject {
  type?: string | string[];
  format?: string;
  description?: string;
  properties?: Record<string, SchemaObject | Ref>;
  required?: string[];
  items?: SchemaObject | Ref;
  enum?: unknown[];
  allOf?: Array<SchemaObject | Ref>;
  anyOf?: Array<SchemaObject | Ref>;
  oneOf?: Array<SchemaObject | Ref>;
  nullable?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | SchemaObject | Ref;
}

export interface Ref {
  $ref: string;
}

export interface Components {
  schemas?: Record<string, SchemaObject | Ref>;
  parameters?: Record<string, Parameter | Ref>;
  requestBodies?: Record<string, RequestBody | Ref>;
  responses?: Record<string, Response | Ref>;
  securitySchemes?: Record<string, SecurityScheme | Ref>;
}

export type SecurityScheme =
  | { type: "http"; scheme: "bearer"; bearerFormat?: string; description?: string }
  | { type: "http"; scheme: "basic"; description?: string }
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; description?: string }
  | { type: "oauth2"; flows: object; description?: string }
  | { type: "openIdConnect"; openIdConnectUrl: string; description?: string };

export type SecurityRequirement = Record<string, string[]>;

export type ResolvedParameter = Omit<Parameter, "schema"> & {
  schema?: SchemaObject;
};

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options" | "trace";

export interface ResolvedOperation {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: ResolvedParameter[];
  requestBodySchema?: SchemaObject;
  requestBodyRequired: boolean;
  requestBodyContentType: string;
  deprecated: boolean;
}

export type AuthConfig = {
  bearerToken?: string;
  apiKeyHeader?: { name: string; value: string };
  apiKeyQuery?: { param: string; value: string };
  customHeaders: Record<string, string>;
};

export interface SpecFilters {
  includeTags?: string[];
  excludeTags?: string[];
  pathPrefix?: string;
  maxTools: number;
}

export interface ExecutorConfig {
  baseUrl: string;
  authConfig: AuthConfig;
}

export type McpToolResult = {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};
