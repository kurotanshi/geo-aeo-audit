import { describe, expect, it } from "vitest";
import { buildScorecards, SCORECARD_CATEGORIES } from "../src/scorecard.js";
import type { Finding, FindingCategory, RuleResult, ScoreImpact } from "../src/schema/result.js";

function finding(
  id: string,
  result: RuleResult,
  scoreImpact: ScoreImpact | undefined,
  category: FindingCategory = "parseability",
): Finding {
  return {
    id,
    result,
    category,
    ...(scoreImpact === undefined ? {} : { score_impact: scoreImpact }),
  };
}

describe("buildScorecards", () => {
  it("scores only explicit scored pass/fail findings and reports measurement coverage", () => {
    const scorecards = buildScorecards([
      finding("scored-pass", "pass", "scored"),
      finding("scored-fail", "fail", "scored"),
      finding("scored-not-tested", "not_tested", "scored"),
      finding("scored-error", "error", "scored"),
      finding("scored-not-applicable", "not_applicable", "scored"),
      finding("experimental-fail", "fail", "experimental"),
      finding("informational-fail", "fail", "informational"),
      finding("unclassified-fail", "fail", undefined),
    ]);

    const parseability = scorecards.find((item) => item.category === "parseability");
    expect(parseability).toEqual({
      category: "parseability",
      score: { value: 50, unit: "percent", passed: 1, failed: 1, denominator: 2 },
      measurement_coverage: {
        value: 71.43,
        unit: "percent",
        measured: 5,
        applicable: 7,
        not_tested: 1,
        errors: 1,
      },
      finding_counts: { pass: 1, fail: 4, not_applicable: 1, not_tested: 1, error: 1 },
      excluded_from_score: {
        informational: 1,
        experimental: 1,
        unclassified: 1,
        unmeasured: 3,
      },
    });
  });

  it("emits every category with null percentages when no rules are applicable", () => {
    const scorecards = buildScorecards([]);
    expect(scorecards.map((item) => item.category)).toEqual(SCORECARD_CATEGORIES);
    expect(scorecards.every((item) => item.score.value === null)).toBe(true);
    expect(scorecards.every((item) => item.measurement_coverage.value === null)).toBe(true);
  });

  it("does not let an unclassified finding silently affect a numerical score", () => {
    const [access] = buildScorecards([
      finding("future-rule", "fail", undefined, "access_and_eligibility"),
    ]);
    expect(access?.score).toMatchObject({ value: null, denominator: 0 });
    expect(access?.excluded_from_score.unclassified).toBe(1);
  });
});
