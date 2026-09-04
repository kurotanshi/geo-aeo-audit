import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, validateAgentRegistry, type AgentRegistryEntry } from "../src/registry/agents.js";

describe("agent registry", () => {
  it("contains every provider token required by the first ruleset", () => {
    expect(AGENT_REGISTRY.map((entry) => entry.productToken)).toEqual([
      "Googlebot",
      "Google-Extended",
      "Google-Agent",
      "Google-GeminiNotebook",
      "bingbot",
      "OAI-SearchBot",
      "GPTBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "ClaudeBot",
      "PerplexityBot",
      "Perplexity-User",
      "Applebot",
      "Applebot-Extended",
      "Meta-ExternalAgent",
      "Meta-ExternalFetcher",
      "meta-webindexer",
      "Amazonbot",
      "Amzn-SearchBot",
      "Amzn-User",
      "CCBot",
      "MistralAI-Training",
      "MistralAI-Index",
      "MistralAI-User",
      "DuckAssistBot",
    ]);
  });

  it("has valid unique identities, sources, dates, scopes and ruleset versions", () => {
    expect(() => validateAgentRegistry()).not.toThrow();
    for (const entry of AGENT_REGISTRY) {
      expect(entry.officialSourceUrl).toMatch(/^https:\/\//);
      expect(entry.checkedAt).toBe("2026-09-03");
      expect(entry.productScopes.length).toBeGreaterThan(0);
      expect(entry.officialSummary).not.toBe("");
    }
    expect(AGENT_REGISTRY.find((entry) => entry.productToken === "bingbot")?.officialSourceUrl).toBe(
      "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
    );
  });

  it("rejects duplicate tokens instead of silently shadowing a policy", () => {
    const duplicate = { ...AGENT_REGISTRY[0], id: "duplicate" } as AgentRegistryEntry;
    expect(() => validateAgentRegistry([AGENT_REGISTRY[0], duplicate])).toThrow("duplicate product token");
  });
});
