import type {
  AttemptOutcome,
  NormalizedProviderResponse,
  ProbeAttempt,
  ProbeRate,
  RateName,
  SearchStatus,
  TargetMatchLevel,
} from "../schema/probe.js";

const COMPLETED = new Set<AttemptOutcome>([
  "completed_answer",
  "completed_refusal",
  "completed_no_search",
  "completed_tool_error",
]);

export function classifyOutcome(input: {
  timedOut?: boolean;
  providerError?: boolean;
  normalizationError?: boolean;
  response?: Pick<NormalizedProviderResponse, "search_tool_error" | "refused" | "search_status">;
}): AttemptOutcome {
  if (input.timedOut) return "timeout";
  if (input.providerError) return "provider_error";
  if (input.normalizationError) return "normalization_error";
  if (input.response === undefined) return "provider_error";
  if (input.response.search_tool_error) return "completed_tool_error";
  if (input.response.refused) return "completed_refusal";
  if (input.response.search_status === "not_used") return "completed_no_search";
  return "completed_answer";
}

export function isCompleted(outcome: AttemptOutcome): boolean {
  return COMPLETED.has(outcome);
}

export function calculateRates(attempts: readonly ProbeAttempt[]): ProbeRate[] {
  const completed = attempts.filter((attempt) => attempt.completed);
  const rates: ProbeRate[] = [];
  for (const metric of [
    "search_use_rate",
    "any_citation_rate",
    "target_page_citation_rate",
    "target_host_citation_rate",
    "target_domain_citation_rate",
  ] as const) {
    rates.push(rate(metric, "all_attempts", attempts));
    rates.push(rate(metric, "completed", completed));
  }
  rates.push(rate("provider_error_rate", "all_attempts", attempts));
  return rates;
}

function rate(
  metric: RateName,
  view: ProbeRate["view"],
  population: readonly ProbeAttempt[],
): ProbeRate {
  const observations = population.map((attempt) => observe(metric, attempt));
  const unknownCount = observations.filter((value) => value === undefined).length;
  const observable = observations.filter((value): value is boolean => value !== undefined);
  const searchCompleted = metric === "search_use_rate" && view === "completed";
  const denominator = searchCompleted ? observable.length : population.length;
  const numerator = observable.filter(Boolean).length;
  return {
    metric,
    view,
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
    unknown_count: unknownCount,
    denominator_definition: definition(metric, view, searchCompleted),
    observable_coverage: {
      measured: observable.length,
      total: population.length,
      value: population.length === 0 ? null : observable.length / population.length,
    },
  };
}

function observe(metric: RateName, attempt: ProbeAttempt): boolean | undefined {
  if (metric === "provider_error_rate") return attempt.outcome === "provider_error";
  if (metric === "search_use_rate") return searchObservation(attempt.search_status);
  if (attempt.cited_sources_status === "not_exposed" || attempt.cited_sources_status === "unavailable") {
    return undefined;
  }
  if (metric === "any_citation_rate") return attempt.citations.length > 0;
  const levels = attempt.citations.flatMap((citation) =>
    citation.target_match === undefined || citation.target_match === null ? [] : [citation.target_match.level],
  );
  if (metric === "target_page_citation_rate") return levels.some(isPageMatch);
  if (metric === "target_host_citation_rate") return levels.some((level) => isPageMatch(level) || level === "same_hostname");
  if (attempt.target_domain_status === "unavailable" || attempt.target_domain_status === "not_exposed") {
    return undefined;
  }
  return levels.length > 0;
}

function searchObservation(status: SearchStatus): boolean | undefined {
  if (status === "used") return true;
  if (status === "not_used" || status === "tool_error") return false;
  return undefined;
}

function isPageMatch(level: TargetMatchLevel): boolean {
  return level === "exact_input_url" || level === "exact_final_url" || level === "target_declared_canonical";
}

function definition(metric: RateName, view: ProbeRate["view"], observableOnly: boolean): string {
  if (metric === "provider_error_rate") return "provider_error attempts / all attempts";
  if (observableOnly) return "search-used completed attempts / completed attempts with observable search status";
  return `${metric} positives / ${view === "all_attempts" ? "all attempts" : "completed attempts"}`;
}
