import { TOOL_VERSION } from "../version.js";
import {
  PROBE_SCHEMA_VERSION,
  type AvailabilityStatus,
  type NormalizedProviderResponse,
  type ProbeProvider,
  type ProbeResult,
  type ProbeRunAttempt,
  type TargetObservation,
} from "../schema/probe.js";
import type { ProbeConfig } from "./config.js";
import { providerRequest, sanitizeRequestMetadata } from "./config.js";
import { calculateRates, classifyOutcome, isCompleted } from "./metrics.js";
import { calculateSourceOverlaps } from "./overlap.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenAIProvider } from "./providers/openai.js";
import { matchCitationTarget, observeTarget } from "./target.js";

export interface RunProbeDeps {
  provider?: ProbeProvider;
  observeTarget?: typeof observeTarget;
  now?: () => Date;
  timeoutMs?: number;
}

export async function runProbe(config: ProbeConfig, apiKey: string, deps: RunProbeDeps = {}): Promise<ProbeResult> {
  const provider = deps.provider ?? providerFor(config.provider);
  if (provider.name !== config.provider) throw new Error(`provider mismatch: expected ${config.provider}, got ${provider.name}`);
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const target = await (deps.observeTarget ?? observeTarget)(config.url);
  const attempts: ProbeRunAttempt[] = [];
  let ordinal = 0;

  for (let promptIndex = 0; promptIndex < config.prompts.length; promptIndex += 1) {
    for (let repeatIndex = 0; repeatIndex < config.repeats; repeatIndex += 1) {
      ordinal += 1;
      const prompt = config.prompts[promptIndex]!;
      attempts.push(await runAttempt({
        ordinal,
        promptIndex,
        repeatIndex,
        prompt,
        config,
        provider,
        apiKey,
        target,
        timeoutMs,
        now,
      }));
    }
  }

  const result: ProbeResult = {
    schema_version: PROBE_SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    generated_at: now().toISOString(),
    experiment: {
      provider: provider.name,
      requested_model: config.model,
      adapter_version: provider.adapterVersion,
      api_surface: provider.apiSurface,
      prompts: [...config.prompts],
      repeats: config.repeats,
      search_settings: { ...config.search },
      timeout_ms: timeoutMs,
    },
    target,
    attempts,
    rates: calculateRates(attempts),
    source_overlaps: calculateSourceOverlaps(attempts),
    limitations: [
      "Results describe this provider API, model, configuration, locale, and run time only.",
      "They do not represent the consumer ChatGPT or Claude products and do not predict future citations.",
      ...target.limitations,
    ],
  };
  return redactResult(result, apiKey) as ProbeResult;
}

interface AttemptInput {
  ordinal: number;
  promptIndex: number;
  repeatIndex: number;
  prompt: string;
  config: ProbeConfig;
  provider: ProbeProvider;
  apiKey: string;
  target: TargetObservation;
  timeoutMs: number;
  now: () => Date;
}

async function runAttempt(input: AttemptInput): Promise<ProbeRunAttempt> {
  const started = input.now();
  const signal = AbortSignal.timeout(input.timeoutMs);
  let response: NormalizedProviderResponse | undefined;
  let caught: unknown;
  try {
    response = await input.provider.invoke(providerRequest(input.config, input.prompt), { apiKey: input.apiKey, signal });
  } catch (error) {
    caught = error;
  }
  const finished = input.now();
  const timedOut = caught !== undefined && signal.aborted;
  const normalizationError = !timedOut && errorKind(caught) === "normalization_error";
  const providerError = caught !== undefined && !timedOut && !normalizationError;
  const outcome = classifyOutcome({ timedOut, providerError, normalizationError, response });
  const citations = response?.citations.map((citation) => ({
    ...citation,
    target_match: citation.url.status === "present" && citation.url.value !== null
      ? matchCitationTarget(citation.url.value, input.target)
      : null,
  })) ?? [];
  if (response !== undefined) response = { ...response, citations };
  const error = caught === undefined
    ? { value: null, status: "not_used" as const }
    : {
        value: {
          kind: timedOut ? "timeout" as const : normalizationError ? "normalization_error" as const : "provider_error" as const,
          message: safeErrorMessage(caught, input.apiKey),
        },
        status: "present" as const,
      };

  return {
    ordinal: input.ordinal,
    prompt_index: input.promptIndex + 1,
    repeat_index: input.repeatIndex + 1,
    prompt: input.prompt,
    provider: input.provider.name,
    adapter_version: input.provider.adapterVersion,
    api_surface: input.provider.apiSurface,
    requested_model: input.config.model,
    returned_model: response?.returned_model.value ?? null,
    search_settings: { ...input.config.search },
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: Math.max(0, finished.getTime() - started.getTime()),
    outcome,
    completed: isCompleted(outcome),
    search_status: response?.search_status ?? "unavailable",
    cited_sources_status: response?.cited_sources.status ?? "unavailable",
    target_domain_status: targetDomainStatus(input.target),
    citations,
    response: response === undefined
      ? { value: null, status: "unavailable" }
      : { value: response, status: "present" },
    error,
  };
}

function providerFor(name: ProbeConfig["provider"]): ProbeProvider {
  return name === "openai" ? createOpenAIProvider() : createAnthropicProvider();
}

function targetDomainStatus(target: TargetObservation): AvailabilityStatus {
  return target.aliases.some((alias) => alias.registrable_domain.status === "present") ? "present" : "unavailable";
}

function errorKind(error: unknown): unknown {
  return error !== null && typeof error === "object" && "kind" in error ? error.kind : undefined;
}

function safeErrorMessage(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/\b(authorization|x-api-key|api[_ -]?key|cookie)\b\s*[:=]\s*\S+/gi, "$1: [REDACTED]");
}

function redactResult(value: unknown, apiKey: string): unknown {
  const sanitized = sanitizeRequestMetadata(value);
  return redactStrings(sanitized, apiKey);
}

function redactStrings(value: unknown, apiKey: string): unknown {
  if (typeof value === "string") return value.replaceAll(apiKey, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, apiKey));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactStrings(nested, apiKey)]));
  }
  return value;
}
