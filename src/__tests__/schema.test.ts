import type { OpenAPISpec, Ref, SchemaObject } from "../types.js";
import { describe, expect, it } from "vitest";
import { extractOperations, isRef, loadAndParseSpec, resolveRef, resolveSchema } from "../schema.js";

const PETSTORE_SPEC: OpenAPISpec = {
  openapi: "3.0.0",
  info: { title: "Petstore", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        tags: ["pets"],
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "A list of pets" } },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        tags: ["pets"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "showPetById",
        summary: "Info for a specific pet",
        tags: ["pets"],
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "A pet" } },
      },
      delete: {
        operationId: "deletePet",
        summary: "Delete a pet",
        tags: ["pets"],
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "No content" } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
  },
};

describe("isRef", () => {
  it("returns true for objects with $ref", () => {
    expect(isRef({ $ref: "#/components/schemas/Foo" })).toBe(true);
  });
  it("returns false for plain objects", () => {
    expect(isRef({ type: "string" })).toBe(false);
    expect(isRef(null)).toBe(false);
    expect(isRef("string")).toBe(false);
  });
});

describe("resolveRef", () => {
  it("resolves a schema ref", () => {
    const ref: Ref = { $ref: "#/components/schemas/Pet" };
    const resolved = resolveRef<SchemaObject>(ref, PETSTORE_SPEC);
    expect(resolved.type).toBe("object");
    expect(resolved.required).toContain("name");
  });

  it("throws for unknown ref path", () => {
    const ref: Ref = { $ref: "#/components/schemas/Missing" };
    expect(() => resolveRef(ref, PETSTORE_SPEC)).toThrow("not found");
  });

  it("throws for external refs", () => {
    const ref: Ref = { $ref: "./other.yaml#/Pet" };
    expect(() => resolveRef(ref, PETSTORE_SPEC)).toThrow("External");
  });
});

describe("resolveSchema", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveSchema(undefined, PETSTORE_SPEC)).toBeUndefined();
  });

  it("passes through non-ref schemas", () => {
    const schema: SchemaObject = { type: "string" };
    expect(resolveSchema(schema, PETSTORE_SPEC)).toBe(schema);
  });

  it("resolves a $ref schema", () => {
    const ref: Ref = { $ref: "#/components/schemas/Pet" };
    const resolved = resolveSchema(ref, PETSTORE_SPEC);
    expect(resolved?.type).toBe("object");
  });

  it("handles circular refs gracefully", () => {
    const circularSpec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "Circular", version: "1.0.0" },
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    const ref: Ref = { $ref: "#/components/schemas/Node" };
    const resolved = resolveSchema(ref, circularSpec);
    expect(resolved?.type).toBe("object");
    const childSchema = resolveSchema(
      resolved?.properties?.child,
      circularSpec,
      new Set(["#/components/schemas/Node"]),
    );
    expect(childSchema?.description).toBe("[circular]");
  });
});

describe("loadAndParseSpec", () => {
  it("parses a JSON OpenAPI 3.x spec", () => {
    const json = JSON.stringify(PETSTORE_SPEC);
    const spec = loadAndParseSpec(json);
    expect(spec.info.title).toBe("Petstore");
    expect(spec.openapi).toBe("3.0.0");
  });

  it("parses a YAML OpenAPI 3.x spec", () => {
    const yamlText = `openapi: "3.0.0"\ninfo:\n  title: "Test"\n  version: "1.0.0"\n`;
    const spec = loadAndParseSpec(yamlText, "spec.yaml");
    expect(spec.info.title).toBe("Test");
  });

  it("throws for OpenAPI 2.x specs", () => {
    const swagger = JSON.stringify({ swagger: "2.0", info: { title: "Old", version: "1.0" } });
    expect(() => loadAndParseSpec(swagger)).toThrow("Unsupported OpenAPI version");
  });

  it("throws for specs missing openapi field", () => {
    expect(() => loadAndParseSpec("{}")).toThrow("Invalid OpenAPI spec");
  });
});

describe("extractOperations", () => {
  const defaultFilters = { maxTools: 128 };

  it("extracts all operations from the petstore spec", () => {
    const ops = extractOperations(PETSTORE_SPEC, defaultFilters);
    expect(ops.length).toBe(4);
    const ids = ops.map((o) => o.operationId);
    expect(ids).toContain("listPets");
    expect(ids).toContain("createPet");
    expect(ids).toContain("showPetById");
    expect(ids).toContain("deletePet");
  });

  it("uses fallback operationId when operationId is absent", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/orders/{id}": {
          get: { summary: "Get order", responses: {} },
        },
      },
    };
    const ops = extractOperations(spec, defaultFilters);
    expect(ops[0].operationId).toBe("get_orders_id");
  });

  it("suffixes duplicate operationIds", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/a": { get: { operationId: "doThing", responses: {} } },
        "/b": { get: { operationId: "doThing", responses: {} } },
      },
    };
    const ops = extractOperations(spec, defaultFilters);
    const ids = ops.map((o) => o.operationId);
    expect(ids).toContain("doThing");
    expect(ids).toContain("doThing_2");
  });

  it("filters by includeTags", () => {
    const ops = extractOperations(PETSTORE_SPEC, { ...defaultFilters, includeTags: ["pets"] });
    expect(ops.length).toBe(4);
    const ops2 = extractOperations(PETSTORE_SPEC, { ...defaultFilters, includeTags: ["other"] });
    expect(ops2.length).toBe(0);
  });

  it("filters by excludeTags", () => {
    const ops = extractOperations(PETSTORE_SPEC, { ...defaultFilters, excludeTags: ["pets"] });
    expect(ops.length).toBe(0);
  });

  it("filters by pathPrefix", () => {
    const ops = extractOperations(PETSTORE_SPEC, { ...defaultFilters, pathPrefix: "/pets/{petId}" });
    expect(ops.length).toBe(2);
    expect(ops.every((o) => o.path === "/pets/{petId}")).toBe(true);
  });

  it("respects maxTools cap", () => {
    const ops = extractOperations(PETSTORE_SPEC, { maxTools: 2 });
    expect(ops.length).toBe(2);
  });

  it("resolves path-level parameters onto operations", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/items/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: { operationId: "getItem", responses: {} },
        },
      },
    };
    const ops = extractOperations(spec, defaultFilters);
    expect(ops[0].parameters.some((p) => p.name === "id")).toBe(true);
  });

  it("sets requestBodyRequired and requestBodyContentType correctly", () => {
    const ops = extractOperations(PETSTORE_SPEC, defaultFilters);
    const createPet = ops.find((o) => o.operationId === "createPet")!;
    expect(createPet.requestBodyRequired).toBe(true);
    expect(createPet.requestBodyContentType).toBe("application/json");
    expect(createPet.requestBodySchema?.type).toBe("object");
  });
});
