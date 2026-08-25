import type {
  Availability,
  NormalizedCitation,
  NormalizedProviderResponse,
  ProbeProvider,
  ProviderRequest,
} from "../../schema/probe.js";
import { sanitizeRequestMetadata } from "../config.js";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const SEARCH_TOOL_VERSION = "web_search_20250305";
const MAX_PAUSE_CONTINUATIONS = 3;

export class AnthropicProviderError extends Error {
  override name = "AnthropicProviderError";

  constructor(
    message: string,
    readonly kind: "api_error" | "normalization_error",
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function createAnthropicProvider(options: { fetch?: typeof fetch; endpoint?: string } = {}): ProbeProvider {
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  return {
    name: "anthropic",
    adapterVersion: "messages-web-search-v1",
    apiSurface: "messages.web_search",
    async invoke(request, context) {
      const tool = buildSearchTool(request);
      const messages: unknown[] = [{ role: "user", content: request.prompt }];
      const responses: Record<string, unknown>[] = [];
      const requestBodies: Record<string, unknown>[] = [];
      const requestIds: string[] = [];

      // ponytail: three continuations bound a stuck pause_turn loop; make this configurable if real workloads exceed it.
      for (let turn = 0; turn <= MAX_PAUSE_CONTINUATIONS; turn += 1) {
        const body = { model: request.model, max_tokens: 4096, messages: [...messages], tools: [tool] };
        requestBodies.push(body);
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "x-api-key": context.apiKey,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: context.signal,
        });
        const requestId = response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined;
        if (requestId !== undefined) requestIds.push(requestId);
        if (!response.ok) {
          throw new AnthropicProviderError(`Anthropic API returned HTTP ${response.status}`, "api_error", response.status, requestId);
        }

        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          throw new AnthropicProviderError("Anthropic API returned invalid JSON", "normalization_error", response.status, requestId);
        }
        if (!isRecord(raw)) throw normalizationError("response must be an object");
        if (raw.type === "error" || raw.error !== undefined) {
          throw new AnthropicProviderError("Anthropic API returned an error response", "api_error", response.status, requestId);
        }
        if (!Array.isArray(raw.content)) throw normalizationError("response.content must be an array");
        responses.push(raw);

        if (raw.stop_reason !== "pause_turn") {
          return normalizeAnthropicResponses(responses, request, {
            requestId: requestIds.at(-1),
            requestMetadata: { method: "POST", endpoint, bodies: requestBodies, search_settings: request.search },
          });
        }
        messages.push({ role: "assistant", content: raw.content });
      }

      throw new AnthropicProviderError("Anthropic API exceeded the pause_turn continuation limit", "api_error", undefined, requestIds.at(-1));
    },
  };
}

export function normalizeAnthropicResponses(
  responses: unknown[],
  request: ProviderRequest,
  metadata: { requestId?: string; requestMetadata?: unknown } = {},
): NormalizedProviderResponse {
  if (responses.length === 0 || responses.some((response) => !isRecord(response) || !Array.isArray(response.content))) {
    throw normalizationError("responses must contain Messages API objects");
  }
  const records = responses as Record<string, unknown>[];
  const final = records.at(-1)!;
  const content = records.flatMap((response) => response.content as unknown[]).filter(isRecord);
  const toolUses = content.filter((block) => block.type === "server_tool_use" && block.name === "web_search");
  const toolResults = content.filter((block) => block.type === "web_search_tool_result");
  const toolFailed = toolResults.some((result) => isRecord(result.content) && result.content.type === "web_search_tool_result_error");
  const retrievedSources = toolResults.flatMap(readSearchResults);
  const searchQueries = toolUses.flatMap((use) =>
    isRecord(use.input) && typeof use.input.query === "string" ? [use.input.query] : [],
  );
  const citations = content.flatMap(readTextCitations);
  const textObserved = content.some((block) => block.type === "text");

  return {
    requested_model: request.model,
    returned_model: optionalString(final.model, "unavailable"),
    api_version: present(API_VERSION),
    search_tool_type: present("web_search"),
    search_tool_version: present(SEARCH_TOOL_VERSION),
    sdk_version: unavailable("not_used"),
    request_id: optionalString(metadata.requestId, "unavailable"),
    response_id: optionalString(final.id, "unavailable"),
    usage: final.usage === undefined ? unavailable("unavailable") : present(final.usage),
    request_metadata: sanitizeMetadata(metadata.requestMetadata),
    final_response: records.length === 1 ? final : { responses: records },
    search_status: toolFailed ? "tool_error" : toolUses.length > 0 || toolResults.length > 0 ? "used" : "not_used",
    refused: final.stop_reason === "refusal",
    search_tool_error: toolFailed,
    retrieved_sources: toolResults.length > 0 ? present(retrievedSources) : notUsed(),
    cited_sources: citations.length > 0
      ? present(citations.map(({ url, title }) => ({ url: url.value, title: title.value })))
      : textObserved
        ? notUsed()
        : unavailable("not_exposed"),
    search_queries: toolUses.length > 0 ? present(searchQueries) : notUsed(),
    citations,
  };
}

function buildSearchTool(request: ProviderRequest): Record<string, unknown> {
  const userLocation = {
    type: "approximate",
    ...(request.search.country === undefined ? {} : { country: request.search.country }),
    ...(request.search.timezone === undefined ? {} : { timezone: request.search.timezone }),
  };
  return {
    type: SEARCH_TOOL_VERSION,
    name: "web_search",
    max_uses: 5,
    ...(Object.keys(userLocation).length === 1 ? {} : { user_location: userLocation }),
  };
}

function readSearchResults(result: Record<string, unknown>): unknown[] {
  if (!Array.isArray(result.content)) return [];
  return result.content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "web_search_result")
    .map((item) => ({
      url: typeof item.url === "string" ? item.url : null,
      title: typeof item.title === "string" ? item.title : null,
      page_age: typeof item.page_age === "string" ? item.page_age : null,
    }));
}

function readTextCitations(block: Record<string, unknown>): NormalizedCitation[] {
  if (block.type !== "text" || !Array.isArray(block.citations)) return [];
  return block.citations.flatMap((citation) => {
    if (!isRecord(citation) || citation.type !== "web_search_result_location") return [];
    return [{
      url: optionalString(citation.url, "unavailable"),
      title: optionalString(citation.title, "not_exposed"),
      answer_span: unavailable("not_exposed"),
      source_excerpt: optionalString(citation.cited_text, "not_exposed"),
    }];
  });
}

function present<T>(value: T): Availability<T> {
  return { value, status: "present" };
}

function notUsed<T>(): Availability<T> {
  return { value: null, status: "not_used" };
}

function unavailable<T>(status: "not_used" | "not_exposed" | "unavailable"): Availability<T> {
  return { value: null, status };
}

function optionalString(value: unknown, missingStatus: "not_exposed" | "unavailable"): Availability<string> {
  return typeof value === "string" ? present(value) : unavailable(missingStatus);
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeRequestMetadata(value);
  return isRecord(sanitized) ? sanitized : {};
}

function normalizationError(message: string): AnthropicProviderError {
  return new AnthropicProviderError(`Could not normalize Anthropic response: ${message}`, "normalization_error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
