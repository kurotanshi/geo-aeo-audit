import { describe, expect, it } from "vitest";
import {
  AnthropicProviderError,
  createAnthropicProvider,
  normalizeAnthropicResponses,
} from "../src/probe/providers/anthropic.js";
import type { ProviderRequest } from "../src/schema/probe.js";

const REQUEST: ProviderRequest = {
  prompt: "Who explains citation probes clearly?",
  model: "claude-test",
  search: { locale: "zh-TW", country: "TW", timezone: "Asia/Taipei" },
};

const SEARCH_CONTENT = [
  { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "citation probe guide" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "srv_1",
    content: [{
      type: "web_search_result",
      url: "https://source.example/guide",
      title: "Guide",
      page_age: "August 2026",
      encrypted_content: "synthetic-encrypted-content",
    }],
  },
  {
    type: "text",
    text: "The guide explains it.",
    citations: [{
      type: "web_search_result_location",
      url: "https://source.example/guide",
      title: "Guide",
      encrypted_index: "synthetic-index",
      cited_text: "A short source excerpt.",
    }],
  },
];

describe("Anthropic Messages web search adapter", () => {
  it("normalizes search results and citations without inventing answer spans", () => {
    const result = normalizeAnthropicResponses([{
      id: "msg_1",
      model: "claude-test-20260801",
      content: SEARCH_CONTENT,
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
    }], REQUEST);

    expect(result).toMatchObject({ search_status: "used", refused: false });
    expect(result.retrieved_sources).toMatchObject({ status: "present", value: [{ url: "https://source.example/guide" }] });
    expect(result.cited_sources).toMatchObject({ status: "present", value: [{ url: "https://source.example/guide" }] });
    expect(result.citations[0]).toMatchObject({
      answer_span: { value: null, status: "not_exposed" },
      source_excerpt: { value: "A short source excerpt.", status: "present" },
    });
  });

  it("distinguishes an empty successful result from a server tool error", () => {
    const empty = normalizeAnthropicResponses([{
      id: "msg_empty",
      model: "claude-test",
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "nothing" } },
        { type: "web_search_tool_result", tool_use_id: "srv_empty", content: [] },
        { type: "text", text: "No result.", citations: [] },
      ],
      stop_reason: "end_turn",
    }], REQUEST);
    const failed = normalizeAnthropicResponses([{
      id: "msg_failed",
      model: "claude-test",
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "too much" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "srv_failed",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
      ],
      stop_reason: "end_turn",
    }], REQUEST);

    expect(empty).toMatchObject({ search_status: "used", retrieved_sources: { value: [], status: "present" } });
    expect(failed).toMatchObject({ search_status: "tool_error", search_tool_error: true });
  });

  it("continues pause_turn with the exact assistant content and preserves the response chain", async () => {
    const sentBodies: Record<string, unknown>[] = [];
    const fixtures = [
      { id: "msg_pause", model: "claude-test", content: SEARCH_CONTENT.slice(0, 2), stop_reason: "pause_turn" },
      { id: "msg_done", model: "claude-test", content: SEARCH_CONTENT.slice(2), stop_reason: "end_turn", usage: { output_tokens: 10 } },
    ];
    const provider = createAnthropicProvider({
      endpoint: "https://api.anthropic.test/v1/messages",
      fetch: async (_input, init) => {
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json(fixtures.shift(), { headers: { "request-id": `req_${sentBodies.length}` } });
      },
    });

    const result = await provider.invoke(REQUEST, {
      apiKey: "synthetic-key",
      signal: new AbortController().signal,
    });

    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[1]).toMatchObject({
      messages: [
        { role: "user", content: REQUEST.prompt },
        { role: "assistant", content: SEARCH_CONTENT.slice(0, 2) },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });
    expect(result.request_id).toEqual({ value: "req_2", status: "present" });
    expect(result.final_response).toMatchObject({ responses: [{ id: "msg_pause" }, { id: "msg_done" }] });
    expect(result.citations).toHaveLength(1);
    expect(JSON.stringify(result.request_metadata)).not.toContain("synthetic-key");
  });

  it("normalizes refusal and no-search responses", () => {
    const result = normalizeAnthropicResponses([{
      id: "msg_refusal",
      model: "claude-test",
      content: [{ type: "text", text: "I cannot help." }],
      stop_reason: "refusal",
    }], REQUEST);

    expect(result).toMatchObject({ refused: true, search_status: "not_used", cited_sources: { status: "not_used" } });
    expect(result.retrieved_sources.status).toBe("not_used");
  });

  it("raises a typed sanitized error for API failures", async () => {
    const provider = createAnthropicProvider({
      fetch: async () => Response.json({ type: "error", error: { type: "invalid_request_error" } }, {
        status: 400,
        headers: { "request-id": "req_bad" },
      }),
    });
    const error = await provider.invoke(REQUEST, {
      apiKey: "do-not-leak",
      signal: new AbortController().signal,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnthropicProviderError);
    expect(error).toMatchObject({ kind: "api_error", status: 400, requestId: "req_bad" });
    expect(String(error)).not.toContain("do-not-leak");
  });

  it("classifies invalid JSON as an adapter normalization error", async () => {
    const provider = createAnthropicProvider({ fetch: async () => new Response("not json") });
    const error = await provider.invoke(REQUEST, {
      apiKey: "test",
      signal: new AbortController().signal,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnthropicProviderError);
    expect(error).toMatchObject({ kind: "normalization_error" });
  });
});
