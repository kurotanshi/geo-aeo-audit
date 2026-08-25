import { describe, expect, it } from "vitest";
import { parseRobotsTxt } from "../src/discovery/robots.js";
import {
  ORA_CHECK_CROSSWALK,
  ORA_CHECKS_CHECKED_AT,
  ORA_CHECKS_CONTRACT_VERSION,
} from "../src/registry/ora-checks.js";
import { auditPageContent } from "../src/rules/content.js";
import { auditOriginProbes } from "../src/rules/origin.js";
import { auditTechnicalEligibility } from "../src/rules/technical.js";
import type { SafeResponse } from "../src/transport/safe-fetch.js";

const origin = "https://example.com";

function response(url: string, status: number, body: string): SafeResponse {
  return {
    finalUrl: url,
    status,
    headers: { "content-type": "text/plain" },
    body: Buffer.from(body),
    rawBodyBytes: Buffer.byteLength(body),
    contentEncoding: undefined,
    redirects: [],
    resolvedIp: "203.0.113.1",
    ipFamily: 4,
  };
}

function entry(id: string) {
  const value = ORA_CHECK_CROSSWALK.find((item) => item.id === id);
  expect(value, `missing Ora crosswalk entry ${id}`).toBeDefined();
  return value!;
}

describe("Ora check crosswalk", () => {
  it("pins the catalog contract and contains unique Ora ids", () => {
    expect(ORA_CHECKS_CONTRACT_VERSION).toBe("1.21.0");
    expect(ORA_CHECKS_CHECKED_AT).toBe("2026-08-25");
    expect(new Set(ORA_CHECK_CROSSWALK.map((item) => item.id)).size).toBe(ORA_CHECK_CROSSWALK.length);
  });

  it("keeps every referenced local rule grounded in rule-function output", async () => {
    const robots = parseRobotsTxt("User-agent: *\nAllow: /");
    const technical = auditTechnicalEligibility({
      targetUrl: `${origin}/page`,
      page: {
        url: `${origin}/page`,
        status: 200,
        headers: {},
        body: '<link rel="canonical" href="/page"><main><h1>Page</h1></main>',
      },
      robots: { url: `${origin}/robots.txt`, parsed: robots, available: true },
      sitemapUrls: [`${origin}/page`],
      sitemapDiscoveryAttempted: true,
    });
    const content = auditPageContent({
      url: `${origin}/page`,
      body: '<html lang="en"><head><meta property="og:type" content="website"><meta property="og:image" content="/image.png"><script type="application/ld+json">{"@type":"Organization","name":"Example","sameAs":"https://example.org"}</script></head><body><nav>Nav</nav><main><h1>Page</h1></main></body></html>',
    });
    const originFindings = await auditOriginProbes({
      origin,
      robots: { parsed: robots, available: true },
      fetch: async (url) =>
        url.endsWith("/llms.txt")
          ? response(url, 200, "a".repeat(100))
          : response(url, 404, "missing"),
    });
    const ids = new Set(
      [...technical.findings, ...content.findings, ...originFindings].map((finding) => finding.id),
    );

    for (const row of ORA_CHECK_CROSSWALK) {
      for (const localId of row.localRuleIds) expect(ids.has(localId), `${row.id} -> ${localId}`).toBe(true);
    }
  });

  it("requires deliberate not-ported rows to have no local ids and a reason", () => {
    for (const row of ORA_CHECK_CROSSWALK.filter((item) => item.mapping === "not_ported")) {
      expect(row.localRuleIds).toEqual([]);
      expect(row.explanation.trim()).not.toBe("");
    }
  });

  it("records the required composite and partial mappings", () => {
    expect(entry("metadata-completeness")).toMatchObject({
      mapping: "composite",
      localRuleIds: ["technical.canonical", "content.language", "content.open_graph"],
    });
    expect(entry("ax-document-structure")).toMatchObject({
      mapping: "composite",
      localRuleIds: ["content.document_landmarks", "content.heading_structure"],
    });
    for (const id of [
      "trust-anchors",
      "agent-friendly-404",
      "redirect-hygiene",
      "markdown-negotiation-vary",
      "content-no-js",
    ]) {
      expect(entry(id).mapping).toBe("partial");
      expect(entry(id).explanation.trim()).not.toBe("");
    }
    for (const id of ["bot-detection", "agent-crawler-reachability"]) {
      expect(entry(id)).toMatchObject({ mapping: "not_ported", localRuleIds: [] });
      expect(entry(id).explanation).toContain("does not impersonate");
    }
  });
});
