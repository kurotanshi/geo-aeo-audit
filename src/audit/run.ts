import type { AuditConfig } from "../config.js";
import type { AuditResult } from "../schema/result.js";
import { SCHEMA_VERSION, TOOL_VERSION, RULESET_VERSION } from "../version.js";

/**
 * ponytail: stub seam. Returns a valid, versioned envelope with no findings.
 * The secure transport, discovery/sampling, and rule engine land in tasks 2-6
 * and populate findings/blockers here without changing this signature.
 * May throw IncompleteAuditError once real fetching exists (→ exit INCOMPLETE).
 */
export async function runAudit(config: AuditConfig): Promise<AuditResult> {
  return {
    schema_version: SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    ruleset_version: RULESET_VERSION,
    generated_at: new Date().toISOString(),
    target: { requested_url: config.url, mode: config.mode },
    findings: [],
    blockers: [],
  };
}
