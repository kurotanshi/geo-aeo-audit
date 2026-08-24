import { describe, expect, it } from "vitest";
import { parseRobotsTxt } from "../src/discovery/robots.js";
import { AGENT_REGISTRY, type AgentRegistryEntry } from "../src/registry/agents.js";
import { auditTechnicalEligibility, type TechnicalAuditInput } from "../src/rules/technical.js";

const URL = "https://example.com/article";

function input(overrides: Partial<TechnicalAuditInput> = {}): TechnicalAuditInput {
  return {
    targetUrl: URL,
    page: {
      url: URL,
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><head><link rel="canonical" href="${URL}"></head><body><main>${"Useful initial content. ".repeat(8)}</main></body></html>`,
    },
    robots: {
      url: "https://example.com/robots.txt",
      available: true,
      parsed: parseRobotsTxt("User-agent: *\nAllow: /\n"),
    },
    sitemapUrls: [URL],
    sitemapDiscoveryAttempted: true,
    ...overrides,
  };
}

function finding(result: ReturnType<typeof auditTechnicalEligibility>, id: string) {
  const value = result.findings.find((item) => item.id === id);
  expect(value, `missing finding ${id}`).toBeDefined();
  return value!;
}

describe("technical eligibility rules", () => {
  it("passes a successful, indexable, canonical, discoverable static page", () => {
    const result = auditTechnicalEligibility(input());
    expect(result.blockers).toEqual([]);
    expect(finding(result, "technical.http_status").result).toBe("pass");
    expect(finding(result, "technical.indexability").result).toBe("pass");
    expect(finding(result, "technical.canonical").result).toBe("pass");
    expect(finding(result, "technical.sitemap_membership").result).toBe("pass");
    expect(finding(result, "technical.initial_html_content").result).toBe("pass");
    expect(result.findings.filter((item) => item.id.startsWith("technical.robots."))).toHaveLength(
      AGENT_REGISTRY.length,
    );
  });

  it("scopes noindex and provider robots blockers only to official behavior", () => {
    const robots = parseRobotsTxt(`
      User-agent: OAI-SearchBot
      Disallow: /
      User-agent: ChatGPT-User
      Disallow: /
      User-agent: Perplexity-User
      Disallow: /
      User-agent: *
      Allow: /
    `);
    const result = auditTechnicalEligibility(
      input({
        page: {
          url: URL,
          status: 200,
          headers: { "x-robots-tag": "noindex" },
          body: `<html><head><link rel="canonical" href="${URL}"></head><body>content</body></html>`,
        },
        robots: { url: "https://example.com/robots.txt", available: true, parsed: robots },
      }),
    );

    const noindex = result.blockers.find((blocker) => blocker.rule_id === "technical.indexability");
    expect(noindex?.applies_to).toContain("google_search");
    expect(noindex?.not_asserted_for).toContain("chatgpt_search");

    expect(result.blockers.some((blocker) => blocker.rule_id === "technical.robots.openai.oai_searchbot")).toBe(true);
    expect(result.blockers.some((blocker) => blocker.rule_id === "technical.robots.openai.chatgpt_user")).toBe(false);
    expect(result.blockers.some((blocker) => blocker.rule_id === "technical.robots.perplexity.perplexity_user")).toBe(
      false,
    );
    expect(finding(result, "technical.robots.openai.chatgpt_user").severity).toBe("warning");
    expect(finding(result, "technical.robots.perplexity.perplexity_user").severity).toBe("warning");
  });

  it("treats Google-Extended as an explicit control token, not an HTTP crawler", () => {
    const result = auditTechnicalEligibility(
      input({
        robots: {
          url: "https://example.com/robots.txt",
          available: true,
          parsed: parseRobotsTxt("User-agent: Google-Extended\nDisallow: /\nUser-agent: *\nAllow: /\n"),
        },
      }),
    );
    const blocker = result.blockers.find((item) => item.rule_id === "technical.robots.google.google_extended");
    expect(blocker?.applies_to).toEqual([
      "gemini_model_training",
      "gemini_apps_grounding",
      "vertex_ai_gemini_grounding",
    ]);
  });

  it("does not infer applicability from agent_kind", () => {
    const custom: AgentRegistryEntry = {
      id: "test.search_fetcher",
      provider: "openai",
      productToken: "TestSearchFetcher",
      agentKind: "search_crawler",
      robotsApplicability: "generally_ignored",
      productScopes: ["test_scope"],
      officialSourceUrl: "https://developers.openai.com/api/docs/bots",
      checkedAt: "2026-08-24",
      rulesetVersion: "0.2.0",
      officialSummary: "Test-only explicit applicability.",
    };
    const result = auditTechnicalEligibility(
      input({
        agents: [custom],
        robots: {
          url: "https://example.com/robots.txt",
          available: true,
          parsed: parseRobotsTxt("User-agent: TestSearchFetcher\nDisallow: /\n"),
        },
      }),
    );
    expect(finding(result, "technical.robots.test.search_fetcher")).toMatchObject({
      result: "fail",
      severity: "warning",
    });
    expect(result.blockers).toEqual([]);
  });

  it("reports a transport/protocol blocker when no page response exists", () => {
    const result = auditTechnicalEligibility(
      input({
        targetUrl: URL,
        page: undefined,
        transportError: { reason: "tls_failure", message: "certificate mismatch" },
      }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ id: "technical.transport", result: "error" });
    expect(result.blockers[0]).toMatchObject({ kind: "transport_or_protocol" });
  });

  it("reports unsuccessful HTTP as transport_or_protocol instead of provider eligibility", () => {
    const result = auditTechnicalEligibility(
      input({ page: { url: URL, status: 503, headers: {}, body: "unavailable" } }),
    );
    expect(finding(result, "technical.http_status")).toMatchObject({ result: "fail", severity: "blocker" });
    expect(result.blockers).toContainEqual(expect.objectContaining({ kind: "transport_or_protocol" }));
  });

  it("uses NOT_TESTED for JavaScript-only uncertainty without claiming content is absent", () => {
    const result = auditTechnicalEligibility(
      input({
        page: {
          url: URL,
          status: 200,
          headers: {},
          body: '<html><body><div id="app"></div><script src="/app.js"></script></body></html>',
        },
      }),
    );
    expect(finding(result, "technical.initial_html_content")).toMatchObject({
      result: "not_tested",
      severity: "warning",
    });
    expect(finding(result, "technical.initial_html_content").rationale).toContain("需要瀏覽器渲染才能確認");
  });

  it("marks crawler and sitemap checks not tested when their evidence is unavailable", () => {
    const result = auditTechnicalEligibility(
      input({
        robots: { url: "https://example.com/robots.txt", available: false },
        sitemapUrls: [],
      }),
    );
    expect(finding(result, "technical.robots.openai.oai_searchbot").result).toBe("not_tested");
    expect(finding(result, "technical.sitemap_membership").result).toBe("not_tested");
    expect(result.blockers).toEqual([]);
  });

  it("flags absent, multiple and invalid canonical declarations", () => {
    for (const body of [
      "<html><body>content</body></html>",
      '<link rel="canonical" href="/one"><link rel="canonical" href="/two">',
      '<link rel="canonical" href="javascript:alert(1)">',
    ]) {
      const result = auditTechnicalEligibility(input({ page: { url: URL, status: 200, headers: {}, body } }));
      expect(finding(result, "technical.canonical").result).toBe("fail");
    }
  });
});
