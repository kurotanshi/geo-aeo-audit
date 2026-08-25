import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { describe, expect, it } from "vitest";
import { renderProbeHtmlReport } from "../src/report/probe-html.js";
import type { ProbeResult } from "../src/schema/probe.js";

const PAYLOAD = '</script><script>alert("owned")</script><img src=x onerror="alert(1)">';

function result(): ProbeResult {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    generated_at: "2026-08-25T00:00:00.000Z",
    experiment: {
      provider: "openai",
      requested_model: PAYLOAD,
      adapter_version: "fixture",
      api_surface: "fixture.search",
      prompts: [PAYLOAD],
      repeats: 1,
      search_settings: { locale: PAYLOAD },
      timeout_ms: 100,
    },
    target: {
      requested_url: `https://target.example/?q=${encodeURIComponent(PAYLOAD)}`,
      final_url: { value: null, status: "unavailable" },
      declared_canonical: { value: null, status: "unavailable" },
      robots: "unavailable",
      aliases: [],
      limitations: [PAYLOAD],
      public_suffix_list: { used: true, package_name: "tldts", package_version: "test", data_version: "test" },
    },
    attempts: [{
      ordinal: 1,
      prompt_index: 1,
      repeat_index: 1,
      prompt: PAYLOAD,
      provider: "openai",
      adapter_version: "fixture",
      api_surface: "fixture.search",
      requested_model: PAYLOAD,
      returned_model: PAYLOAD,
      search_settings: { locale: PAYLOAD },
      started_at: "2026-08-25T00:00:00.000Z",
      finished_at: "2026-08-25T00:00:00.001Z",
      duration_ms: 1,
      outcome: "completed_answer",
      completed: true,
      search_status: "used",
      cited_sources_status: "present",
      target_domain_status: "unavailable",
      citations: [
        {
          url: { value: "javascript:alert(1)", status: "present" },
          title: { value: PAYLOAD, status: "present" },
          answer_span: { value: null, status: "not_exposed" },
          source_excerpt: { value: PAYLOAD, status: "present" },
          target_match: null,
        },
        {
          url: { value: "https://source.example/path", status: "present" },
          title: { value: "Safe source", status: "present" },
          answer_span: { value: { start: 0, end: 4 }, status: "present" },
          source_excerpt: { value: "excerpt", status: "present" },
          target_match: null,
        },
      ],
      response: { value: { payload: PAYLOAD } as never, status: "present" },
      error: { value: null, status: "not_used" },
    }],
    rates: [{
      metric: "search_use_rate",
      view: "all_attempts",
      numerator: 1,
      denominator: 1,
      value: 1,
      unknown_count: 0,
      denominator_definition: "search use / all attempts",
      observable_coverage: { measured: 1, total: 1, value: 1 },
    }],
    source_overlaps: [],
    limitations: [PAYLOAD, "Not the consumer product."],
  };
}

describe("probe HTML report", () => {
  it("renders grouped rates, attribution, attempts, coverage, and limitations without JavaScript", () => {
    const html = renderProbeHtmlReport(result());
    expect(html).toContain("Experiment group");
    expect(html).toContain("Rates and observable coverage");
    expect(html).toContain("Source attribution");
    expect(html).toContain("Not the consumer product.");
    expect(html).not.toMatch(/<script\b/i);
    const elements = findElements(parse(html));
    expect(elements.some((element) => element.tagName === "main")).toBe(true);
    expect(elements.some((element) => element.tagName === "nav")).toBe(true);
    expect(elements.some((element) => element.tagName === "details")).toBe(true);
  });

  it("escapes provider data and emits only safe source links", () => {
    const html = renderProbeHtmlReport(result());
    const elements = findElements(parse(html));
    expect(html).toContain("&lt;/script&gt;");
    expect(elements.some((element) => element.tagName === "script")).toBe(false);
    expect(elements.every((element) => element.attrs.every((attribute) => !attribute.name.startsWith("on")))).toBe(true);
    const links = elements.filter((element) => element.tagName === "a");
    const externalLinks = links.filter((link) =>
      /^https?:\/\//.test(link.attrs.find((attribute) => attribute.name === "href")?.value ?? ""),
    );
    expect(externalLinks).toHaveLength(1);
    expect(externalLinks[0]?.attrs.find((attribute) => attribute.name === "href")?.value).toMatch(/^https:\/\//);
    expect(links.every((link) => {
      const href = link.attrs.find((attribute) => attribute.name === "href")?.value ?? "";
      return href.startsWith("#") || /^https?:\/\//.test(href);
    })).toBe(true);
    expect(html).not.toContain('href="javascript:');
  });
});

function findElements(root: DefaultTreeAdapterTypes.Document): DefaultTreeAdapterTypes.Element[] {
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && "attrs" in node) elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return elements;
}
