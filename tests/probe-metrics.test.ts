import { describe, expect, it } from "vitest";
import { calculateRates, classifyOutcome, isCompleted } from "../src/probe/metrics.js";
import type { ProbeAttempt, ProbeRate, SearchStatus } from "../src/schema/probe.js";

function attempt(
  ordinal: number,
  outcome: ProbeAttempt["outcome"],
  search_status: SearchStatus,
  citation: "page" | "host" | "domain" | "none" | "unknown",
): ProbeAttempt {
  const levels = {
    page: "exact_input_url",
    host: "same_hostname",
    domain: "same_registrable_domain",
  } as const;
  return {
    ordinal,
    outcome,
    completed: isCompleted(outcome),
    search_status,
    cited_sources_status: citation === "unknown" ? "not_exposed" : citation === "none" ? "not_used" : "present",
    target_domain_status: "present",
    citations:
      citation === "none" || citation === "unknown"
        ? []
        : [
            {
              url: { value: "https://example.com", status: "present" },
              title: { value: null, status: "not_exposed" },
              answer_span: { value: null, status: "not_exposed" },
              source_excerpt: { value: null, status: "not_exposed" },
              target_match: { level: levels[citation], alias: "https://example.com", provenance: "input" },
            },
          ],
  };
}

function find(rates: ProbeRate[], metric: ProbeRate["metric"], view: ProbeRate["view"]): ProbeRate {
  return rates.find((rate) => rate.metric === metric && rate.view === view)!;
}

describe("probe outcomes and rates", () => {
  it("applies the specified outcome priority and completed membership", () => {
    const response = { search_tool_error: true, refused: true, search_status: "not_used" as const };
    expect(classifyOutcome({ timedOut: true, providerError: true, normalizationError: true, response })).toBe("timeout");
    expect(classifyOutcome({ providerError: true, normalizationError: true, response })).toBe("provider_error");
    expect(classifyOutcome({ normalizationError: true, response })).toBe("normalization_error");
    expect(classifyOutcome({ normalizationError: true })).toBe("normalization_error");
    expect(classifyOutcome({})).toBe("provider_error");
    expect(classifyOutcome({ response })).toBe("completed_tool_error");
    expect(classifyOutcome({ response: { ...response, search_tool_error: false } })).toBe("completed_refusal");
    expect(classifyOutcome({ response: { ...response, search_tool_error: false, refused: false } })).toBe(
      "completed_no_search",
    );
    expect(
      classifyOutcome({ response: { search_tool_error: false, refused: false, search_status: "used" } }),
    ).toBe("completed_answer");
    expect(isCompleted("completed_refusal")).toBe(true);
    expect(isCompleted("timeout")).toBe(false);
  });

  it("emits recomputable dual-view rates, unknowns and coverage", () => {
    const rates = calculateRates([
      attempt(1, "completed_answer", "used", "page"),
      attempt(2, "completed_refusal", "not_used", "none"),
      attempt(3, "completed_tool_error", "tool_error", "unknown"),
      attempt(4, "provider_error", "unavailable", "unknown"),
      attempt(5, "timeout", "unavailable", "unknown"),
      attempt(6, "normalization_error", "unavailable", "unknown"),
    ]);

    expect(find(rates, "search_use_rate", "all_attempts")).toMatchObject({
      numerator: 1,
      denominator: 6,
      unknown_count: 3,
    });
    expect(find(rates, "search_use_rate", "completed")).toMatchObject({
      numerator: 1,
      denominator: 3,
      unknown_count: 0,
      observable_coverage: { measured: 3, total: 3, value: 1 },
    });
    expect(find(rates, "any_citation_rate", "completed")).toMatchObject({
      numerator: 1,
      denominator: 3,
      unknown_count: 1,
    });
    expect(find(rates, "target_host_citation_rate", "completed").numerator).toBe(1);
    expect(find(rates, "provider_error_rate", "all_attempts")).toMatchObject({ numerator: 1, denominator: 6 });
  });

  it("uses null rather than an invalid value for zero denominators", () => {
    for (const rate of calculateRates([])) expect(rate.value).toBeNull();
  });

  it("keeps an unavailable registrable domain unknown", () => {
    const value = attempt(1, "completed_answer", "used", "page");
    value.target_domain_status = "unavailable";
    expect(find(calculateRates([value]), "target_domain_citation_rate", "completed")).toMatchObject({
      numerator: 0,
      denominator: 1,
      unknown_count: 1,
      observable_coverage: { measured: 0, total: 1, value: 0 },
    });
  });
});
