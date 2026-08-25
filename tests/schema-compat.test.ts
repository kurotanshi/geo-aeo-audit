import Ajv, { type ValidateFunction } from "ajv";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/run.js";
import { DEFAULT_LIMITS, type AuditConfig } from "../src/config.js";
import { SCHEMA_VERSION } from "../src/version.js";
import { runProbe } from "../src/probe/run.js";
import { runOra } from "../src/ora/run.js";
import { ORA_SCHEMA_VERSION } from "../src/schema/ora.js";
import { PROBE_SCHEMA_VERSION, type ProbeProvider, type TargetObservation } from "../src/schema/probe.js";
import type { TransportDeps } from "../src/transport/safe-fetch.js";
import { startFixture, type Fixture } from "./fixtures/server.js";

const allowLoopback: TransportDeps = { isPublic: () => true };
const schemaPath = fileURLToPath(new URL("../schemas/audit-result.schema.json", import.meta.url));
const probeSchemaPath = fileURLToPath(new URL("../schemas/probe-result.schema.json", import.meta.url));
const oraSchemaPath = fileURLToPath(new URL("../schemas/ora-result.schema.json", import.meta.url));

function config(url: string, mode: "page" | "site"): AuditConfig {
  return {
    url,
    mode,
    failOn: "never",
    output: { json: true },
    limits: { ...DEFAULT_LIMITS, maxPages: 10 },
  };
}

describe("audit result JSON Schema compatibility", () => {
  let fx: Fixture;
  let schema: Record<string, unknown>;
  let validate: ValidateFunction;

  beforeAll(async () => {
    fx = await startFixture();
    schema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, unknown>;
    validate = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
  });

  afterAll(async () => {
    await fx.close();
  });

  it("keeps the published schema version synchronized with the runtime", () => {
    const properties = schema.properties as Record<string, { const?: unknown }>;
    expect(properties.schema_version?.const).toBe(SCHEMA_VERSION);
  });

  it("validates both page and deterministic site result envelopes", async () => {
    const results = await Promise.all([
      runAudit(config(`${fx.origin}/article`, "page"), { transportDeps: allowLoopback }),
      runAudit(config(`${fx.origin}/site-entry`, "site"), { transportDeps: allowLoopback }),
    ]);

    for (const result of results) {
      expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
    }
  });
});

describe("probe result JSON Schema compatibility", () => {
  it("keeps the published schema synchronized and validates completed and failed attempts", async () => {
    const schema = JSON.parse(await readFile(probeSchemaPath, "utf8")) as Record<string, unknown>;
    const validate = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
    const properties = schema.properties as Record<string, { const?: unknown }>;
    expect(properties.schema_version?.const).toBe(PROBE_SCHEMA_VERSION);

    const target: TargetObservation = {
      requested_url: "https://target.example/",
      final_url: { value: null, status: "unavailable" },
      declared_canonical: { value: null, status: "unavailable" },
      robots: "unavailable",
      aliases: [{
        url: "https://target.example/",
        provenance: "input",
        hostname: "target.example",
        registrable_domain: { value: "target.example", status: "present" },
      }],
      limitations: ["fixture"],
      public_suffix_list: { used: true, package_name: "tldts", package_version: "fixture", data_version: "fixture" },
    };
    let call = 0;
    const provider: ProbeProvider = {
      name: "openai",
      adapterVersion: "fixture",
      apiSurface: "fixture.search",
      invoke: async (request) => {
        call += 1;
        if (call === 2) throw new Error("fixture provider error");
        return {
          requested_model: request.model,
          returned_model: { value: request.model, status: "present" },
          api_version: { value: null, status: "not_exposed" },
          search_tool_type: { value: "web_search", status: "present" },
          search_tool_version: { value: null, status: "not_exposed" },
          sdk_version: { value: null, status: "not_used" },
          request_id: { value: null, status: "unavailable" },
          response_id: { value: "fixture", status: "present" },
          usage: { value: null, status: "unavailable" },
          request_metadata: {},
          final_response: {},
          search_status: "not_used",
          refused: false,
          search_tool_error: false,
          retrieved_sources: { value: null, status: "not_used" },
          cited_sources: { value: null, status: "not_used" },
          search_queries: { value: null, status: "not_used" },
          citations: [],
        };
      },
    };
    const result = await runProbe({
      url: target.requested_url,
      provider: "openai",
      model: "test-model",
      prompts: ["test"],
      repeats: 2,
      search: {},
    }, "fixture-key", { provider, observeTarget: async () => target });

    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

describe("Ora result JSON Schema compatibility", () => {
  it("keeps the public schema synchronized and validates the independent envelope", async () => {
    const schema = JSON.parse(await readFile(oraSchemaPath, "utf8")) as Record<string, unknown>;
    const validate = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
    const properties = schema.properties as Record<string, { const?: unknown }>;
    expect(properties.schema_version?.const).toBe(ORA_SCHEMA_VERSION);

    const result = await runOra({
      url: "https://example.com/path",
      hostname: "example.com",
      mode: "cached",
      output: { json: true },
    }, {
      fetch: async () => new Response(JSON.stringify({
        contractVersion: "1.21.0",
        score: 72,
        grade: "B",
        analysisStatus: "complete",
        layers: [],
        topFixes: [],
        essentials: { checks: { "metadata-completeness": {} } },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      generatedAt: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
