import type { AuditLimits } from "../config.js";

// Versioned result envelope shared by JSON and HTML report renderers.

export type RuleResult = "pass" | "fail" | "not_applicable" | "not_tested" | "error";

export type BlockerKind = "transport_or_protocol" | "provider_eligibility";

export type FindingCategory =
  | "access_and_eligibility"
  | "discoverability"
  | "parseability"
  | "freshness_and_entity"
  | "source_and_evidence";

/** Explicit scoring policy; severity never determines whether a rule is scored. */
export type ScoreImpact = "scored" | "informational" | "experimental";

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
  category?: FindingCategory;
  score_impact?: ScoreImpact;
  // Extended rule details include severity, evidence, source_url, rationale,
  // recommendation, evidence_kind, claim_scope, and subject_url.
  [key: string]: unknown;
}

export interface Blocker {
  kind: BlockerKind;
  rule_id: string;
  evidence: string[];
  applies_to: string[];
  not_asserted_for: string[];
  evidence_kind?: EvidenceKind;
  subject_url?: string;
  [key: string]: unknown;
}

export interface CategoryScorecard {
  category: FindingCategory;
  score: {
    value: number | null;
    unit: "percent";
    passed: number;
    failed: number;
    denominator: number;
  };
  measurement_coverage: {
    value: number | null;
    unit: "percent";
    measured: number;
    applicable: number;
    not_tested: number;
    errors: number;
  };
  finding_counts: Record<RuleResult, number>;
  excluded_from_score: {
    informational: number;
    experimental: number;
    unclassified: number;
    unmeasured: number;
  };
}

export interface AuditResult {
  schema_version: string;
  tool_version: string;
  ruleset_version: string;
  generated_at: string;
  target: {
    requested_url: string;
    normalized_url: string;
    mode: "page" | "site";
  };
  metadata: {
    url_normalization: {
      version: string;
    };
    sampling: {
      applied: boolean;
      method: "stable-hash";
      hash_algorithm: "sha256";
      seed: string;
      selected: {
        url: string;
        hash: string;
        state: string;
      }[];
    };
    public_suffix_list: {
      used: boolean;
      package_name: string | null;
      package_version: string | null;
      data_version: string | null;
      scope_basis: "origin";
    };
    limits: AuditLimits;
  };
  findings: Finding[];
  scorecards: CategoryScorecard[];
  blockers: Blocker[];
}
