import type {
  CategoryScorecard,
  Finding,
  FindingCategory,
  RuleResult,
} from "./schema/result.js";

export const SCORECARD_CATEGORIES = [
  "access_and_eligibility",
  "discoverability",
  "parseability",
  "freshness_and_entity",
  "source_and_evidence",
] as const satisfies readonly FindingCategory[];

const RULE_RESULTS = ["pass", "fail", "not_applicable", "not_tested", "error"] as const;

/**
 * Build per-category readiness summaries. There is deliberately no aggregate
 * score: category scores describe observed static checks, not citation odds.
 */
export function buildScorecards(findings: readonly Finding[]): CategoryScorecard[] {
  return SCORECARD_CATEGORIES.map((category) => buildCategoryScorecard(category, findings));
}

function buildCategoryScorecard(
  category: FindingCategory,
  findings: readonly Finding[],
): CategoryScorecard {
  const categoryFindings = findings.filter((finding) => finding.category === category);
  const findingCounts = emptyResultCounts();
  for (const finding of categoryFindings) findingCounts[finding.result] += 1;

  const scored = categoryFindings.filter(
    (finding) =>
      finding.score_impact === "scored" &&
      (finding.result === "pass" || finding.result === "fail"),
  );
  const passed = scored.filter((finding) => finding.result === "pass").length;
  const failed = scored.length - passed;

  const applicable = categoryFindings.filter(
    (finding) => finding.result !== "not_applicable",
  ).length;
  const measured = categoryFindings.filter(
    (finding) => finding.result === "pass" || finding.result === "fail",
  ).length;

  return {
    category,
    score: {
      value: percentage(passed, scored.length),
      unit: "percent",
      passed,
      failed,
      denominator: scored.length,
    },
    measurement_coverage: {
      value: percentage(measured, applicable),
      unit: "percent",
      measured,
      applicable,
      not_tested: findingCounts.not_tested,
      errors: findingCounts.error,
    },
    finding_counts: findingCounts,
    excluded_from_score: {
      informational: categoryFindings.filter(
        (finding) => finding.score_impact === "informational",
      ).length,
      experimental: categoryFindings.filter(
        (finding) => finding.score_impact === "experimental",
      ).length,
      unclassified: categoryFindings.filter(
        (finding) => finding.score_impact === undefined,
      ).length,
      unmeasured: categoryFindings.filter(
        (finding) =>
          finding.score_impact === "scored" &&
          finding.result !== "pass" &&
          finding.result !== "fail",
      ).length,
    },
  };
}

function emptyResultCounts(): Record<RuleResult, number> {
  return Object.fromEntries(RULE_RESULTS.map((result) => [result, 0])) as Record<
    RuleResult,
    number
  >;
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}
