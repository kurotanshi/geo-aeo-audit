export const PROBE_SCHEMA_VERSION = "1.0.0";

export type ProviderName = "openai" | "anthropic";
export type AvailabilityStatus = "present" | "not_used" | "not_exposed" | "unavailable";
export type SearchStatus = "used" | "not_used" | "tool_error" | "not_exposed" | "unavailable";
export type AttemptOutcome =
  | "completed_answer"
  | "completed_refusal"
  | "completed_no_search"
  | "completed_tool_error"
  | "provider_error"
  | "timeout"
  | "normalization_error";

export interface Availability<T> {
  value: T | null;
  status: AvailabilityStatus;
}

export interface SearchSettings {
  locale?: string;
  country?: string;
  timezone?: string;
}

/** Provider-bound input. Target identifiers are intentionally absent. */
export interface ProviderRequest {
  prompt: string;
  model: string;
  search: SearchSettings;
}

export interface NormalizedCitation {
  url: Availability<string>;
  title: Availability<string>;
  answer_span: Availability<{ start: number; end: number }>;
  source_excerpt: Availability<string>;
  target_match?: CitationTargetMatch | null;
}

export interface NormalizedProviderResponse {
  requested_model: string;
  returned_model: Availability<string>;
  api_version: Availability<string>;
  search_tool_type: Availability<string>;
  search_tool_version: Availability<string>;
  sdk_version: Availability<string>;
  request_id: Availability<string>;
  response_id: Availability<string>;
  usage: Availability<unknown>;
  request_metadata: Record<string, unknown>;
  final_response: unknown;
  search_status: SearchStatus;
  refused: boolean;
  search_tool_error: boolean;
  retrieved_sources: Availability<unknown[]>;
  cited_sources: Availability<unknown[]>;
  search_queries: Availability<string[]>;
  citations: NormalizedCitation[];
}

export interface ProbeProvider {
  readonly name: ProviderName;
  readonly adapterVersion: string;
  readonly apiSurface: string;
  invoke(request: ProviderRequest, context: { apiKey: string; signal: AbortSignal }): Promise<NormalizedProviderResponse>;
}

export type TargetAliasProvenance = "input" | "final_redirect" | "declared_canonical";
export type TargetMatchLevel =
  | "exact_input_url"
  | "exact_final_url"
  | "target_declared_canonical"
  | "same_hostname"
  | "same_registrable_domain";

export interface TargetAlias {
  url: string;
  provenance: TargetAliasProvenance;
  hostname: string;
  registrable_domain: Availability<string>;
}

export interface TargetObservation {
  requested_url: string;
  final_url: Availability<string>;
  declared_canonical: Availability<string>;
  robots: "allowed" | "blocked" | "unavailable";
  aliases: TargetAlias[];
  limitations: string[];
  public_suffix_list: {
    used: true;
    package_name: "tldts";
    package_version: string;
    data_version: string;
  };
}

export interface CitationTargetMatch {
  level: TargetMatchLevel;
  alias: string;
  provenance: TargetAliasProvenance;
}

export interface ProbeAttempt {
  ordinal: number;
  outcome: AttemptOutcome;
  completed: boolean;
  search_status: SearchStatus;
  cited_sources_status: AvailabilityStatus;
  target_domain_status: AvailabilityStatus;
  citations: NormalizedCitation[];
}

export type RateName =
  | "search_use_rate"
  | "any_citation_rate"
  | "target_page_citation_rate"
  | "target_host_citation_rate"
  | "target_domain_citation_rate"
  | "provider_error_rate";

export interface ProbeRate {
  metric: RateName;
  view: "all_attempts" | "completed";
  numerator: number;
  denominator: number;
  value: number | null;
  unknown_count: number;
  denominator_definition: string;
  observable_coverage: {
    measured: number;
    total: number;
    value: number | null;
  };
}

export interface OverlapAttempt extends ProbeAttempt {
  provider: ProviderName;
  requested_model: string;
  returned_model: string | null;
  api_surface: string;
  search_settings: SearchSettings;
}

export interface SourceOverlapPair {
  provider: ProviderName;
  requested_model: string;
  returned_model: string | null;
  api_surface: string;
  search_settings: SearchSettings;
  left_ordinal: number;
  right_ordinal: number;
  url_source_overlap: number | null;
  domain_source_overlap: number | null;
}

export interface ProbeRunAttempt extends OverlapAttempt {
  prompt_index: number;
  repeat_index: number;
  prompt: string;
  adapter_version: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  response: Availability<NormalizedProviderResponse>;
  error: Availability<{ kind: "timeout" | "provider_error" | "normalization_error"; message: string }>;
}

export interface ProbeResult {
  schema_version: typeof PROBE_SCHEMA_VERSION;
  tool_version: string;
  generated_at: string;
  experiment: {
    provider: ProviderName;
    requested_model: string;
    adapter_version: string;
    api_surface: string;
    prompts: string[];
    repeats: number;
    search_settings: SearchSettings;
    timeout_ms: number;
  };
  target: TargetObservation;
  attempts: ProbeRunAttempt[];
  rates: ProbeRate[];
  source_overlaps: SourceOverlapPair[];
  limitations: string[];
}
