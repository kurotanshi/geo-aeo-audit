import { describe, expect, it } from "vitest";
import { auditPageContent } from "../src/rules/content.js";

const URL = "https://example.com/articles/audit";

function find(result: ReturnType<typeof auditPageContent>, id: string) {
  const value = result.findings.find((item) => item.id === id);
  expect(value, `missing finding ${id}`).toBeDefined();
  return value!;
}

function fullArticle(): string {
  return `<!doctype html>
    <html lang="zh-Hant">
      <head>
        <title>如何執行可重現的內容稽核</title>
        <meta name="description" content="逐步介紹如何執行安全且可重現的內容稽核。">
        <meta property="og:type" content="article">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "如何執行可重現的內容稽核",
            "datePublished": "2026-08-01T09:00:00+08:00",
            "dateModified": "2026-08-24T10:30:00+08:00",
            "author": {"@type": "Person", "name": "Kuro"},
            "publisher": {"@type": "Organization", "name": "Example Lab"},
            "citation": "https://www.rfc-editor.org/rfc/rfc9110.html"
          }
        </script>
      </head>
      <body>
        <article>
          <h1>如何執行可重現的內容稽核</h1>
          <h2>安全傳輸</h2>
          <p>文章內容與證據。</p>
          <a href="https://www.w3.org/TR/json-ld11/">JSON-LD standard</a>
        </article>
      </body>
    </html>`;
}

describe("page content, entity and evidence rules", () => {
  it("passes a complete article and emits evidence-complete findings", () => {
    const result = auditPageContent({ url: URL, body: fullArticle() });
    expect(result.findings).toHaveLength(11);
    for (const item of result.findings) {
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          result: expect.any(String),
          severity: expect.any(String),
          evidence: expect.any(Array),
          rationale: expect.any(String),
          recommendation: expect.any(String),
          evidence_kind: expect.any(String),
          claim_scope: expect.any(Array),
        }),
      );
    }
    for (const id of [
      "content.title",
      "content.meta_description",
      "content.language",
      "content.heading_structure",
      "content.jsonld_validity",
      "content.article_structured_data",
      "content.author",
      "content.publication_date",
      "content.entity_identity",
      "content.update_signal",
      "content.source_links",
    ]) {
      expect(find(result, id).result).toBe("pass");
    }
  });

  it("uses not_applicable for article-only rules on a non-article page", () => {
    const result = auditPageContent({
      url: "https://example.com/about",
      body: `<!doctype html><html lang="en"><head><title>About Example</title><meta name="description" content="About the Example team."></head><body><h1>About Example</h1><p>Company information.</p></body></html>`,
    });
    expect(find(result, "content.jsonld_validity").result).toBe("not_applicable");
    for (const id of [
      "content.article_structured_data",
      "content.author",
      "content.publication_date",
      "content.entity_identity",
      "content.update_signal",
      "content.source_links",
    ]) {
      expect(find(result, id).result).toBe("not_applicable");
    }
    expect(result.findings.filter((item) => item.result === "fail")).toEqual([]);
  });

  it("validates an explicit Person entity on a non-article profile page", () => {
    const result = auditPageContent({
      url: "https://example.com/people/ada",
      body: `<!doctype html><html lang="en"><head><title>Ada</title><meta name="description" content="Profile for Ada"><script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfilePage","mainEntity":{"@type":"Person","name":"Ada"}}</script></head><body><main><h1>Ada</h1><p>Profile</p></main></body></html>`,
    });
    expect(find(result, "content.entity_identity")).toMatchObject({ result: "pass", evidence_kind: "official_recommendation" });
    expect(find(result, "content.article_structured_data").result).toBe("not_applicable");
    expect(find(result, "content.author").result).toBe("not_applicable");
  });

  it("reports missing general metadata and malformed heading hierarchy as failures", () => {
    const result = auditPageContent({
      url: URL,
      body: "<html><body><h2>Starts too deep</h2><h4>Skips a level</h4></body></html>",
    });
    expect(find(result, "content.title").result).toBe("fail");
    expect(find(result, "content.meta_description").result).toBe("fail");
    expect(find(result, "content.language").result).toBe("fail");
    expect(find(result, "content.heading_structure").result).toBe("fail");
    expect(find(result, "content.heading_structure").evidence_kind).toBe("heuristic");
  });

  it("reports invalid JSON-LD as an error, not a failed content claim", () => {
    const result = auditPageContent({
      url: URL,
      body: `<html lang="en"><head><title>Article</title><meta name="description" content="Description"><script type="application/ld+json">{"@type":"Article",}</script></head><body><article><h1>Article</h1></article></body></html>`,
    });
    expect(find(result, "content.jsonld_validity")).toMatchObject({ result: "error", severity: "error" });
    expect(find(result, "content.article_structured_data").result).toBe("error");
  });

  it("accepts visible fallback author and publication signals but keeps missing Article JSON-LD separate", () => {
    const result = auditPageContent({
      url: URL,
      body: `<!doctype html><html lang="en"><head><title>Article</title><meta name="description" content="Description"><meta name="author" content="Ada"><meta property="article:published_time" content="2026-08-20"></head><body><article><h1>Article</h1><p>Text</p><a href="https://source.example/report">Source</a></article></body></html>`,
    });
    expect(find(result, "content.article_structured_data").result).toBe("fail");
    expect(find(result, "content.author").result).toBe("pass");
    expect(find(result, "content.publication_date").result).toBe("pass");
    expect(find(result, "content.source_links").result).toBe("pass");
    expect(find(result, "content.entity_identity").result).toBe("fail");
  });

  it("does not count same-origin navigation as an external source", () => {
    const result = auditPageContent({
      url: URL,
      body: `<!doctype html><html lang="en"><head><title>Article</title><meta name="description" content="Description"></head><body><article><h1>Article</h1><a href="/about">About us</a></article></body></html>`,
    });
    expect(find(result, "content.source_links")).toMatchObject({ result: "fail", evidence_kind: "heuristic" });
  });

  it("marks every content rule not tested when page content was intentionally skipped", () => {
    const result = auditPageContent({ url: URL, unavailableReason: "skipped_due_to_robots" });
    expect(result.findings).toHaveLength(11);
    expect(result.findings.every((item) => item.result === "not_tested")).toBe(true);
    expect(result.findings.every((item) => item.evidence_kind === "empirical_observation")).toBe(true);
    expect(result.findings[0]?.evidence).toEqual([`${URL}: skipped_due_to_robots`]);
  });
});
