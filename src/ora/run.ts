import { ORA_CHECK_CROSSWALK } from "../registry/ora-checks.js";
import { ORA_SCHEMA_VERSION, type OraAuditPayload, type OraResult } from "../schema/ora.js";
import { TOOL_VERSION } from "../version.js";
import { fetchOraReport, type OraClientDeps } from "./client.js";
import type { OraConfig } from "./config.js";

export interface RunOraDeps extends OraClientDeps {
  generatedAt?: () => Date;
}

export async function runOra(config: OraConfig, deps: RunOraDeps = {}): Promise<OraResult> {
  const fetched = await fetchOraReport(config, deps);
  return {
    schema_version: ORA_SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    generated_at: (deps.generatedAt?.() ?? new Date()).toISOString(),
    request: {
      endpoint: fetched.endpoint,
      mode: config.mode,
      polls: fetched.polls,
      http_status: fetched.httpStatus,
      cache: {
        age: fetched.cache.age,
        x_vercel_cache: fetched.cache.xVercelCache,
      },
    },
    ora: fetched.payload,
    crosswalk: buildCrosswalk(fetched.payload),
    limitations: [
      "Ora scores use Ora's methodology and are not geo-aeo-audit scorecards.",
      "estScoreGain is an estimate, not a guaranteed score increase.",
      "Check tier is display metadata and does not determine score contribution.",
      "This report is a point-in-time snapshot of the Ora response.",
      "Crosswalk mappings describe semantic overlap and do not claim equivalent measurements unless explicitly marked equivalent.",
    ],
  };
}

function buildCrosswalk(payload: OraAuditPayload): OraResult["crosswalk"] {
  const checks = payload.essentials?.checks;
  const ids = checks !== null && typeof checks === "object" && !Array.isArray(checks)
    ? Object.keys(checks as Record<string, unknown>)
    : [];
  const registry = new Map(ORA_CHECK_CROSSWALK.map((entry) => [entry.id, entry]));
  return ids.map((id) => {
    const mapped = registry.get(id);
    return mapped === undefined
      ? { ora_id: id, mapping: "unmapped", local_rule_ids: [], explanation: "No local crosswalk entry exists for this Ora check id." }
      : {
          ora_id: id,
          mapping: mapped.mapping,
          local_rule_ids: mapped.localRuleIds,
          explanation: mapped.explanation,
        };
  });
}
