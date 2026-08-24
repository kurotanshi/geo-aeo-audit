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
    expect(result.target.normalized_url).toBe(`${fx.origin}/site-entry`);
    expect(result.metadata).toMatchObject({
      url_normalization: { version: "conservative-v1" },
      sampling: {
        applied: false,
        method: "stable-hash",
        hash_algorithm: "sha256",
        selected: [],
      },
      public_suffix_list: {
        used: false,
        package_name: null,
        package_version: null,
        data_version: null,
        scope_basis: "origin",
      },
    });
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

  it("reports an HTTP-unavailable page as a transport blocker without content failures", async () => {
    const result = await runAudit(config(`${fx.origin}/unavailable`), { transportDeps: allowLoopback });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ id: "technical.http_status", result: "fail", severity: "blocker" }),
    );
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ kind: "transport_or_protocol", rule_id: "technical.http_status" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ id: "content.title", result: "not_tested" }),
    );
  });

  it("preserves JavaScript-only uncertainty as a rendering limitation", async () => {
    const result = await runAudit(config(`${fx.origin}/javascript-only`), { transportDeps: allowLoopback });
    const initialHtml = result.findings.find((item) => item.id === "technical.initial_html_content");
    expect(initialHtml).toMatchObject({ result: "not_tested", severity: "warning" });
    expect(initialHtml?.rationale).toContain("需要瀏覽器渲染才能確認");
    expect(initialHtml?.rationale).toContain("不代表內容無法被任何 AI 使用");
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
    expect(result.metadata.sampling.applied).toBe(true);
    expect(result.metadata.sampling.selected.length).toBeGreaterThan(0);
    expect(result.metadata.sampling.selected.every((item) => /^[a-f0-9]{64}$/.test(item.hash))).toBe(true);
  });
});
