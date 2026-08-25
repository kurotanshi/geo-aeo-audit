import { sanitizeRequestMetadata } from "../config.js";
import type {
  Availability,
  NormalizedCitation,
  NormalizedProviderResponse,
  ProbeProvider,
  ProviderRequest,
} from "../../schema/probe.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

export class OpenAIProviderError extends Error {
  override name = "OpenAIProviderError";

  constructor(
    message: string,
    readonly kind: "api_error" | "normalization_error",
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function createOpenAIProvider(options: { fetch?: typeof fetch; endpoint?: string } = {}): ProbeProvider {
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  return {
    name: "openai",
    adapterVersion: "responses-web-search-v1",
    apiSurface: "responses.web_search",
    async invoke(request, context) {
      const body = buildRequestBody(request);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${context.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: context.signal,
      });
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const apiVersion = response.headers.get("openai-version") ?? undefined;

      if (!response.ok) {
        throw new OpenAIProviderError(`OpenAI API returned HTTP ${response.status}`, "api_error", response.status, requestId);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new OpenAIProviderError("OpenAI API returned invalid JSON", "normalization_error", response.status, requestId);
      }

      return normalizeOpenAIResponse(raw, request, {
        requestId,
        apiVersion,
        requestMetadata: { method: "POST", endpoint, body, search_settings: request.search },
      });
    },
  };
}

export function normalizeOpenAIResponse(
  raw: unknown,
  request: ProviderRequest,
  metadata: { requestId?: string; apiVersion?: string; requestMetadata?: unknown } = {},
): NormalizedProviderResponse {
  if (!isRecord(raw)) throw normalizationError("response must be an object");
  if (raw.error !== undefined && raw.error !== null) {
    throw new OpenAIProviderError("OpenAI API returned an error response", "api_error", undefined, metadata.requestId);
  }
  if (!Array.isArray(raw.output)) throw normalizationError("response.output must be an array");

  const toolCalls = raw.output.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "web_search_call");
  const messages = raw.output.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "message");
  const toolFailed = toolCalls.some((call) => call.status === "failed" || call.status === "error");
  const retrievedSources = toolCalls.flatMap(readRetrievedSources);
  const searchQueries = toolCalls.flatMap(readSearchQueries);
  const citations = messages.flatMap(readMessageCitations);
  const refused = messages.some(hasRefusal);
  const messageContentObserved = messages.some((message) => Array.isArray(message.content));

  return {
    requested_model: request.model,
    returned_model: optionalString(raw.model, "unavailable"),
    api_version: optionalString(metadata.apiVersion, "not_exposed"),
    search_tool_type: present("web_search"),
    search_tool_version: unavailable("not_exposed"),
    sdk_version: unavailable("not_used"),
    request_id: optionalString(metadata.requestId, "unavailable"),
    response_id: optionalString(raw.id, "unavailable"),
    usage: raw.usage === undefined ? unavailable("unavailable") : present(raw.usage),
    request_metadata: sanitizeMetadata(metadata.requestMetadata),
    final_response: raw,
    search_status: toolFailed ? "tool_error" : toolCalls.length > 0 ? "used" : "not_used",
    refused,
    search_tool_error: toolFailed,
    retrieved_sources: toolCalls.length > 0 ? present(retrievedSources) : notUsed(),
    cited_sources: citations.length > 0
      ? present(citations.map(({ url, title }) => ({ url: url.value, title: title.value })))
      : messageContentObserved
        ? notUsed()
        : unavailable("not_exposed"),
    search_queries: toolCalls.length > 0 ? present(searchQueries) : notUsed(),
    citations,
  };
}

function buildRequestBody(request: ProviderRequest): Record<string, unknown> {
  const userLocation = {
    type: "approximate",
    ...(request.search.country === undefined ? {} : { country: request.search.country }),
    ...(request.search.timezone === undefined ? {} : { timezone: request.search.timezone }),
  };

  return {
    model: request.model,
    input: request.prompt,
    tools: [{ type: "web_search", ...(Object.keys(userLocation).length === 1 ? {} : { user_location: userLocation }) }],
    include: ["web_search_call.action.sources"],
    store: false,
  };
}

function readRetrievedSources(call: Record<string, unknown>): unknown[] {
  if (!isRecord(call.action) || !Array.isArray(call.action.sources)) return [];
  return call.action.sources.filter(isRecord).map((source) => ({
    url: typeof source.url === "string" ? source.url : null,
    title: typeof source.title === "string" ? source.title : null,
  }));
}

function readSearchQueries(call: Record<string, unknown>): string[] {
  if (!isRecord(call.action)) return [];
  if (Array.isArray(call.action.queries)) return call.action.queries.filter((query): query is string => typeof query === "string");
  return typeof call.action.query === "string" ? [call.action.query] : [];
}

function readMessageCitations(message: Record<string, unknown>): NormalizedCitation[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((content) => {
    if (!isRecord(content) || content.type !== "output_text" || !Array.isArray(content.annotations)) return [];
    return content.annotations.flatMap((annotation) => {
      if (!isRecord(annotation) || annotation.type !== "url_citation") return [];
      const start = annotation.start_index;
      const end = annotation.end_index;
      return [{
        url: optionalString(annotation.url, "unavailable"),
        title: optionalString(annotation.title, "not_exposed"),
        answer_span: typeof start === "number" && typeof end === "number"
          ? present({ start, end })
          : unavailable("unavailable"),
        source_excerpt: unavailable("not_exposed"),
      }];
    });
  });
}

function hasRefusal(message: Record<string, unknown>): boolean {
  return Array.isArray(message.content)
    && message.content.some((content) => isRecord(content) && content.type === "refusal");
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

function optionalString(
  value: unknown,
  missingStatus: "not_exposed" | "unavailable",
): Availability<string> {
  return typeof value === "string" ? present(value) : unavailable(missingStatus);
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeRequestMetadata(value);
  return isRecord(sanitized) ? sanitized : {};
}

function normalizationError(message: string): OpenAIProviderError {
  return new OpenAIProviderError(`Could not normalize OpenAI response: ${message}`, "normalization_error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
