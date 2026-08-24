import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, type AuditConfig } from "../src/config.js";
import { runAudit } from "../src/audit/run.js";
import type { TransportDeps } from "../src/transport/safe-fetch.js";
import { startFixture, type Fixture } from "./fixtures/server.js";

const allowLoopback: TransportDeps = { isPublic: () => true };

function config(url: string, mode: "page" | "site" = "page"): AuditConfig {
  return {
    url,
    mode,
    failOn: "never",
    output: { json: true },
    limits: { ...DEFAULT_LIMITS, maxPages: 20, concurrency: 2 },
  };
}

describe("runAudit technical integration", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await startFixture();
  });

  afterAll(async () => {
    await fx.close();
  });

  it("fetches one page plus robots and emits provider-scoped technical findings", async () => {
    const result = await runAudit(config(`${fx.origin}/site-entry`), {
      transportDeps: allowLoopback,
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });
    expect(result.generated_at).toBe("2026-08-24T00:00:00.000Z");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        id: "technical.robots.openai.oai_searchbot",
        result: "pass",
        subject_url: `${fx.origin}/site-entry`,
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ id: "technical.sitemap_membership", result: "not_tested" }),
    );
  });

  it("runs content, entity and evidence rules for fetched static HTML", async () => {
    const result = await runAudit(config(`${fx.origin}/article`), { transportDeps: allowLoopback });
    for (const id of [
      "content.title",
      "content.meta_description",
      "content.language",
      "content.heading_structure",
      "content.article_structured_data",
      "content.author",
      "content.publication_date",
      "content.entity_identity",
      "content.update_signal",
      "content.source_links",
    ]) {
      expect(result.findings).toContainEqual(
        expect.objectContaining({ id, result: "pass", subject_url: `${fx.origin}/article` }),
      );
    }
    expect(result.findings.every((item) => typeof item.score_impact === "string")).toBe(true);
    expect(result.scorecards.map((item) => item.category)).toEqual([
      "access_and_eligibility",
      "discoverability",
      "parseability",
      "freshness_and_entity",
      "source_and_evidence",
    ]);
    expect(result.scorecards.find((item) => item.category === "parseability")?.score.value).toBe(100);
    expect(result.scorecards.find((item) => item.category === "source_and_evidence")?.score).toMatchObject({
      value: null,
      denominator: 0,
    });
    expect(result).not.toHaveProperty("score");
  });

  it("marks initial-content checks not tested when the audit crawler is blocked", async () => {
    const result = await runAudit(config(`${fx.origin}/crawler-private`), { transportDeps: allowLoopback });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        id: "technical.initial_html_content",
        result: "not_tested",
        evidence: [`${fx.origin}/crawler-private: skipped_due_to_robots`],
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ id: "technical.robots.openai.oai_searchbot", result: "pass" }),
    );
  });

  it("audits sampled site pages and preserves a subject URL on every result", async () => {
    const result = await runAudit(config(`${fx.origin}/site-entry`, "site"), { transportDeps: allowLoopback });
    expect(result.findings.length).toBeGreaterThan(20);
    expect(result.findings.every((item) => typeof item.subject_url === "string")).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        id: "technical.robots.openai.oai_searchbot",
        subject_url: `${fx.origin}/public-a`,
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        id: "technical.initial_html_content",
        result: "not_tested",
        subject_url: `${fx.origin}/private`,
        evidence: [`${fx.origin}/private: skipped_due_to_robots`],
      }),
    );
  });
});
