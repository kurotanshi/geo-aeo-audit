import { describe, expect, it } from "vitest";
import { calculateSourceOverlaps } from "../src/probe/overlap.js";
import type { NormalizedCitation, OverlapAttempt, ProviderName } from "../src/schema/probe.js";

function citation(url: string): NormalizedCitation {
  return {
    url: { value: url, status: "present" },
    title: { value: null, status: "not_exposed" },
    answer_span: { value: null, status: "not_exposed" },
    source_excerpt: { value: null, status: "not_exposed" },
  };
}

function attempt(
  ordinal: number,
  urls: string[],
  overrides: Partial<Pick<OverlapAttempt, "provider" | "requested_model" | "returned_model" | "completed">> = {},
): OverlapAttempt {
  return {
    ordinal,
    outcome: "completed_answer",
    completed: true,
    search_status: "used",
    cited_sources_status: urls.length === 0 ? "not_used" : "present",
    target_domain_status: "present",
    citations: urls.map(citation),
    provider: "openai",
    requested_model: "requested-model",
    returned_model: "returned-model",
    api_surface: "responses.web_search",
    search_settings: { locale: "en-US", country: "US" },
    ...overrides,
  };
}

describe("source overlap", () => {
  it("calculates pairwise URL and registrable-domain Jaccard within one group", () => {
    const pairs = calculateSourceOverlaps([
      attempt(1, ["https://a.example.com/one", "https://shared.test/a"]),
      attempt(2, ["https://b.example.com/two", "https://shared.test/a"]),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      left_ordinal: 1,
      right_ordinal: 2,
      url_source_overlap: 1 / 3,
      domain_source_overlap: 1,
    });
  });

  it("returns null for equal empty sets", () => {
    expect(calculateSourceOverlaps([attempt(1, []), attempt(2, [])])[0]).toMatchObject({
      url_source_overlap: null,
      domain_source_overlap: null,
    });
  });

  it("does not compare different providers, models, settings or incomplete attempts", () => {
    const variants: OverlapAttempt[] = [
      attempt(1, ["https://one.example"]),
      attempt(2, ["https://two.example"], { provider: "anthropic" as ProviderName }),
      attempt(3, ["https://three.example"], { requested_model: "other" }),
      { ...attempt(4, ["https://four.example"]), search_settings: { locale: "zh-TW" } },
      attempt(5, ["https://five.example"], { completed: false }),
    ];
    expect(calculateSourceOverlaps(variants)).toEqual([]);
  });
});
