import { describe, expect, it } from "vitest";
import { runProbe } from "../src/probe/run.js";
import type { ProbeConfig } from "../src/probe/config.js";
import type { NormalizedProviderResponse, ProbeProvider, TargetObservation } from "../src/schema/probe.js";

const TARGET: TargetObservation = {
  requested_url: "https://target.example/page",
  final_url: { value: "https://target.example/page", status: "present" },
  declared_canonical: { value: null, status: "unavailable" },
  robots: "allowed",
  aliases: [{
    url: "https://target.example/page",
    provenance: "input",
    hostname: "target.example",
    registrable_domain: { value: "target.example", status: "present" },
  }],
  limitations: [],
  public_suffix_list: {
    used: true,
    package_name: "tldts",
    package_version: "fixture",
    data_version: "fixture",
  },
};

const CONFIG: ProbeConfig = {
  url: TARGET.requested_url,
  provider: "openai",
  model: "test-model",
  prompts: ["first", "second"],
  repeats: 2,
  search: { locale: "zh-TW" },
};

function response(citationUrl?: string): NormalizedProviderResponse {
  const citations = citationUrl === undefined ? [] : [{
    url: { value: citationUrl, status: "present" as const },
    title: { value: "Target", status: "present" as const },
    answer_span: { value: null, status: "not_exposed" as const },
    source_excerpt: { value: null, status: "not_exposed" as const },
  }];
  return {
    requested_model: "test-model",
    returned_model: { value: "returned-model", status: "present" },
    api_version: { value: null, status: "not_exposed" },
    search_tool_type: { value: "web_search", status: "present" },
    search_tool_version: { value: null, status: "not_exposed" },
    sdk_version: { value: null, status: "not_used" },
    request_id: { value: "req_test", status: "present" },
    response_id: { value: "resp_test", status: "present" },
    usage: { value: {}, status: "present" },
    request_metadata: {},
    final_response: {},
    search_status: "used",
    refused: false,
    search_tool_error: false,
    retrieved_sources: { value: [], status: "present" },
    cited_sources: { value: citations, status: "present" },
    search_queries: { value: ["query"], status: "present" },
    citations,
  };
}

describe("probe runner", () => {
  it("runs attempts sequentially, matches citations locally, and preserves exact ordering", async () => {
    const calls: string[] = [];
    let active = 0;
    const provider: ProbeProvider = {
      name: "openai",
      adapterVersion: "fixture-v1",
      apiSurface: "fixture.search",
      invoke: async (request) => {
        active += 1;
        expect(active).toBe(1);
        calls.push(request.prompt);
        await Promise.resolve();
        active -= 1;
        return response(TARGET.requested_url);
      },
    };

    const result = await runProbe({ ...CONFIG, prompts: ["private-key", "second"] }, "private-key", {
      provider,
      observeTarget: async () => TARGET,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(calls).toEqual(["private-key", "private-key", "second", "second"]);
    expect(result.experiment.prompts[0]).toBe("[REDACTED]");
    expect(result.schema_version).toBe("1.0.0");
    expect(result.attempts.map(({ ordinal, prompt_index, repeat_index }) => ({ ordinal, prompt_index, repeat_index })))
      .toEqual([
        { ordinal: 1, prompt_index: 1, repeat_index: 1 },
        { ordinal: 2, prompt_index: 1, repeat_index: 2 },
        { ordinal: 3, prompt_index: 2, repeat_index: 1 },
        { ordinal: 4, prompt_index: 2, repeat_index: 2 },
      ]);
    expect(result.attempts[0]?.citations[0]?.target_match).toMatchObject({ level: "exact_input_url" });
    expect(result.rates).toContainEqual(expect.objectContaining({ metric: "target_page_citation_rate", value: 1 }));
    expect(JSON.stringify(result)).not.toContain("private-key");
  });

  it("records provider, normalization, and timeout errors then continues", async () => {
    let call = 0;
    const provider: ProbeProvider = {
      name: "openai",
      adapterVersion: "fixture-v1",
      apiSurface: "fixture.search",
      invoke: async (_request, { signal }) => {
        call += 1;
        if (call === 1) throw new Error("provider failed with private-key");
        if (call === 2) throw Object.assign(new Error("bad response"), { kind: "normalization_error" });
        if (call === 3) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
        }
        return response();
      },
    };

    const result = await runProbe(CONFIG, "private-key", {
      provider,
      observeTarget: async () => TARGET,
      timeoutMs: 5,
    });

    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "provider_error",
      "normalization_error",
      "timeout",
      "completed_answer",
    ]);
    expect(result.attempts[0]?.error.value?.message).not.toContain("private-key");
    expect(JSON.stringify(result)).not.toContain("private-key");
    expect(result.attempts[3]?.completed).toBe(true);
    expect(call).toBe(4);
  });
});
