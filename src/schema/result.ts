// Versioned result envelope. Findings/blockers are typed loosely here; later
// tasks (rules, scorecard, report) extend these shapes behind the same envelope.

export type RuleResult = "pass" | "fail" | "not_applicable" | "not_tested" | "error";

export type BlockerKind = "transport_or_protocol" | "provider_eligibility";

/** Strength-of-inference tier for a finding's basis. */
export type EvidenceKind =
  | "official_behavior"
  | "official_recommendation"
  | "standard"
  | "empirical_observation"
  | "heuristic";

export interface Finding {
  id: string;
  result: RuleResult;
  // Extended in tasks 4-5: severity, evidence, source_url, rationale,
  // recommendation, evidence_kind, claim_scope.
  [key: string]: unknown;
}

export interface Blocker {
  kind: BlockerKind;
  // Extended in tasks 4/6: applies_to, not_asserted_for, evidence, etc.
  [key: string]: unknown;
}

export interface AuditResult {
  schema_version: string;
  tool_version: string;
  ruleset_version: string;
  generated_at: string;
  target: {
    requested_url: string;
    mode: "page" | "site";
  };
  findings: Finding[];
  blockers: Blocker[];
}
