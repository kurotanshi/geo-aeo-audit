import Ajv, { type ValidateFunction } from "ajv";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/run.js";
import { DEFAULT_LIMITS, type AuditConfig } from "../src/config.js";
import { SCHEMA_VERSION } from "../src/version.js";
import type { TransportDeps } from "../src/transport/safe-fetch.js";
import { startFixture, type Fixture } from "./fixtures/server.js";

const allowLoopback: TransportDeps = { isPublic: () => true };
const schemaPath = fileURLToPath(new URL("../schemas/audit-result.schema.json", import.meta.url));

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
