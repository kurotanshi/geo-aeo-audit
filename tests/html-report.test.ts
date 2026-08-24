import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/config.js";
import { renderHtmlReport } from "../src/report/html.js";
import { buildScorecards } from "../src/scorecard.js";
import type { AuditResult, Finding } from "../src/schema/result.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const PAYLOAD = '</script><script>alert("owned")</script><img src=x onerror="alert(1)">';

function maliciousResult(): AuditResult {
  const findings: Finding[] = [
    {
      id: `content.payload.${PAYLOAD}`,
      result: "not_tested",
      severity: "warning",
      category: "parseability",
      score_impact: "scored",
      evidence: [PAYLOAD, 'attribute " autofocus onfocus="alert(1)'],
      rationale: PAYLOAD,
      recommendation: "Retry only after the measurement limitation is resolved.",
      evidence_kind: "empirical_observation",
      claim_scope: ["javascript:alert(1)"],
      source_url: "javascript:alert(1)",
      subject_url: `https://example.com/?q=${PAYLOAD}`,
    },
    {
      id: "content.valid-source",
      result: "pass",
      severity: "info",
      category: "source_and_evidence",
      score_impact: "experimental",
      evidence: ["A source was observed."],
      rationale: "Fixture finding with a valid HTTPS source.",
      recommendation: "No change required.",
      evidence_kind: "heuristic",
      claim_scope: ["fixture"],
      source_url: "https://example.com/source?value=%3Ctag%3E",
    },
  ];

  return {
    schema_version: "1.1.0",
    tool_version: "0.1.0",
    ruleset_version: "0.2.0",
    generated_at: "2026-08-25T00:00:00.000Z",
    target: {
      requested_url: PAYLOAD,
      normalized_url: PAYLOAD,
      mode: "page",
    },
    metadata: {
      url_normalization: { version: "conservative-v1" },
      sampling: {
        applied: false,
        method: "stable-hash",
        hash_algorithm: "sha256",
        seed: PAYLOAD,
        selected: [],
      },
      public_suffix_list: {
        used: false,
        package_name: null,
        package_version: null,
        data_version: null,
        scope_basis: "origin",
      },
      limits: { ...DEFAULT_LIMITS },
    },
    findings,
    scorecards: buildScorecards(findings),
    blockers: [
      {
        kind: "transport_or_protocol",
        rule_id: `technical.transport.${PAYLOAD}`,
        evidence: [PAYLOAD],
        applies_to: [],
        not_asserted_for: [PAYLOAD],
        subject_url: PAYLOAD,
      },
    ],
  };
}

describe("renderHtmlReport", () => {
  it("renders all report sections without JavaScript", () => {
    const html = renderHtmlReport(maliciousResult());
    expect(html).toContain("Category scorecards");
    expect(html).toContain("Blockers (1)");
    expect(html).toContain("Transport and protocol errors (1)");
    expect(html).toContain("Measurement limitations (1)");
    expect(html).toContain("NOT_TESTED items (1)");
    expect(html).toContain("Findings (2)");
    expect(html).toContain("not a citation-probability estimate");
    expect(html).not.toMatch(/<script\b/i);
  });

  it("escapes untrusted text and emits only safe HTTP(S) links", () => {
    const html = renderHtmlReport(maliciousResult());
    const elements = findElements(parse(html));

    expect(html).toContain("&lt;/script&gt;");
    expect(elements.some((element) => element.tagName === "script")).toBe(false);
    expect(
      elements.every((element) => element.attrs.every((attribute) => !attribute.name.startsWith("on"))),
    ).toBe(true);

    const links = elements.filter((element) => element.tagName === "a");
    expect(links).toHaveLength(1);
    for (const link of links) {
      const href = link.attrs.find((attribute) => attribute.name === "href")?.value;
      expect(href).toMatch(/^https?:\/\//);
    }
    expect(html).not.toContain('href="javascript:');
  });

  it("ships a restrictive CSP in the document itself", () => {
    const html = renderHtmlReport(maliciousResult());
    const csp = findElements(parse(html))
      .find(
        (element) =>
          element.tagName === "meta" &&
          element.attrs.some(
            (attribute) =>
              attribute.name === "http-equiv" && attribute.value === "Content-Security-Policy",
          ),
      )
      ?.attrs.find((attribute) => attribute.name === "content")?.value;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});

function findElements(root: DefaultTreeAdapterTypes.Document): Element[] {
  const elements: Element[] = [];
  const visit = (node: Node): void => {
    if ("tagName" in node && "attrs" in node) elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return elements;
}
