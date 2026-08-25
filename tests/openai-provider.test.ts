import { describe, expect, it } from "vitest";
import { createOpenAIProvider, normalizeOpenAIResponse, OpenAIProviderError } from "../src/probe/providers/openai.js";
import type { ProviderRequest } from "../src/schema/probe.js";

const REQUEST: ProviderRequest = {
  prompt: "Who explains citation probes clearly?",
  model: "gpt-test",
  search: { locale: "zh-TW", country: "TW", timezone: "Asia/Taipei" },
};

const NORMAL_RESPONSE = {
  id: "resp_123",
  model: "gpt-test-2026-08-01",
  usage: { input_tokens: 20, output_tokens: 10 },
  output: [
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        queries: ["citation probe guide"],
        sources: [
          { type: "url", url: "https://source.example/guide", title: "Guide" },
          { type: "url", url: "https://source.example/background", title: "Background" },
        ],
      },
    },
    {
      type: "message",
      content: [{
        type: "output_text",
        text: "The guide explains it.",
        annotations: [{
          type: "url_citation",
          start_index: 4,
          end_index: 9,
          url: "https://source.example/guide",
          title: "Guide",
        }],
      }],
    },
  ],
};

describe("OpenAI Responses web search adapter", () => {
  it("keeps retrieved sources separate from inline citations and sends no target hint", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const provider = createOpenAIProvider({
      endpoint: "https://api.openai.test/v1/responses",
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(NORMAL_RESPONSE, {
          headers: { "x-request-id": "req_123", "openai-version": "2026-08-01" },
        });
      },
    });

    const result = await provider.invoke(REQUEST, {
      apiKey: "secret-test-key",
      signal: new AbortController().signal,
    });

    expect(result.retrieved_sources).toMatchObject({ status: "present", value: [{ url: "https://source.example/guide" }, { url: "https://source.example/background" }] });
    expect(result.cited_sources).toMatchObject({ status: "present", value: [{ url: "https://source.example/guide" }] });
    expect(result.citations[0]).toMatchObject({
      answer_span: { value: { start: 4, end: 9 }, status: "present" },
      source_excerpt: { value: null, status: "not_exposed" },
    });
    expect(result.request_id).toEqual({ value: "req_123", status: "present" });
    expect(result.api_version).toEqual({ value: "2026-08-01", status: "present" });
    expect(sentBody).toMatchObject({
      model: "gpt-test",
      input: REQUEST.prompt,
      tools: [{ type: "web_search", user_location: { type: "approximate", country: "TW", timezone: "Asia/Taipei" } }],
      include: ["web_search_call.action.sources"],
      store: false,
    });
    expect(JSON.stringify(sentBody)).not.toContain("zh-TW");
    expect(JSON.stringify(result.request_metadata)).not.toContain("secret-test-key");
  });

  it("normalizes refusal and no-search responses", () => {
    const refusal = normalizeOpenAIResponse({
      id: "resp_refusal",
      model: "gpt-test",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot help." }] }],
    }, REQUEST);

    expect(refusal).toMatchObject({ refused: true, search_status: "not_used", search_tool_error: false });
    expect(refusal.search_tool_type).toEqual({ value: "web_search", status: "present" });
    expect(refusal.retrieved_sources.status).toBe("not_used");
    expect(refusal.cited_sources.status).toBe("not_used");
  });

  it("distinguishes a completed search with no citation from no search", () => {
    const searched = normalizeOpenAIResponse({
      id: "resp_no_citation",
      model: "gpt-test",
      output: [
        { type: "web_search_call", status: "completed", action: { type: "search", queries: [], sources: [] } },
        { type: "message", content: [{ type: "output_text", text: "No citation.", annotations: [] }] },
      ],
    }, REQUEST);
    const notSearched = normalizeOpenAIResponse({
      id: "resp_no_search",
      model: "gpt-test",
      output: [{ type: "message", content: [{ type: "output_text", text: "Direct answer.", annotations: [] }] }],
    }, REQUEST);

    expect(searched).toMatchObject({ search_status: "used", cited_sources: { status: "not_used" } });
    expect(searched.retrieved_sources).toEqual({ value: [], status: "present" });
    expect(notSearched).toMatchObject({ search_status: "not_used", cited_sources: { status: "not_used" } });
  });

  it("records server tool errors without converting them to API errors", () => {
    const result = normalizeOpenAIResponse({
      id: "resp_tool_error",
      model: "gpt-test",
      output: [
        { type: "web_search_call", status: "failed", action: { type: "search", queries: ["test"], sources: [] } },
        { type: "message", content: [{ type: "output_text", text: "Search failed.", annotations: [] }] },
      ],
    }, REQUEST);

    expect(result).toMatchObject({ search_status: "tool_error", search_tool_error: true });
  });

  it("raises a sanitized typed error for HTTP and response-level API errors", async () => {
    const provider = createOpenAIProvider({
      fetch: async () => Response.json({ error: { message: "bad request" } }, {
        status: 400,
        headers: { "x-request-id": "req_bad" },
      }),
    });

    const error = await provider.invoke(REQUEST, {
      apiKey: "do-not-leak",
      signal: new AbortController().signal,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toMatchObject({ kind: "api_error", status: 400, requestId: "req_bad" });
    expect(String(error)).not.toContain("do-not-leak");
    expect(() => normalizeOpenAIResponse({ error: { message: "failed" }, output: [] }, REQUEST))
      .toThrowError(OpenAIProviderError);
  });

  it("classifies invalid JSON as an adapter normalization error", async () => {
    const provider = createOpenAIProvider({ fetch: async () => new Response("not json") });
    const error = await provider.invoke(REQUEST, {
      apiKey: "test",
      signal: new AbortController().signal,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toMatchObject({ kind: "normalization_error" });
  });
});
