import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { describe, expect, it } from "vitest";
import { renderOraHtmlReport } from "../src/report/ora-html.js";
import type { OraResult } from "../src/schema/ora.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const payload = '</script><script>alert("owned")</script><img src=x onerror="alert(1)">';

function result(): OraResult {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    generated_at: "2026-08-25T00:00:00.000Z",
    request: {
      endpoint: "https://ora.ai/api/score/example.com?include=essentials&format=audit",
      mode: "cached",
      polls: 0,
      http_status: 200,
      cache: { age: "60", x_vercel_cache: "HIT" },
    },
    ora: {
      contractVersion: "1.21.0",
      score: 72,
      grade: payload,
      scannedAt: "2026-08-25T00:00:00.000Z",
      analysisStatus: "complete",
      essentials: { score: 80, label: payload, checks: {} },
      topFixes: [
        { id: "first", name: `First ${payload}`, recommendation: payload, estScoreGain: 5, specUrl: "javascript:alert(1)" },
        { id: "second", name: "Second", recommendation: "Fix second", estScoreGain: 2, specUrl: "https://example.com/spec" },
      ],
      layers: [{ id: "discovery", name: payload, score: 10, maxScore: 20 }],
    },
    crosswalk: [{ ora_id: payload, mapping: "unmapped", local_rule_ids: [], explanation: payload }],
    limitations: [
      "estScoreGain is an estimate, not a guaranteed score increase.",
      "Check tier is display metadata and does not determine score contribution.",
      "This report is a point-in-time snapshot of the Ora response.",
      "Crosswalk mappings are not equivalent unless explicitly marked equivalent.",
      "Ora scores use Ora methodology.",
    ],
  };
}

describe("Ora HTML report", () => {
  it("renders score, essentials, fixes, layers, crosswalk, and limitations without JavaScript", () => {
    const html = renderOraHtmlReport(result());
    expect(html).toContain("Ora score 72/100");
    expect(html).toContain("Essentials");
    expect(html).toContain("Top fixes (2)");
    expect(html).toContain("Next up");
    expect(html).toContain("Layer scores");
    expect(html).toContain("Ora-to-local crosswalk");
    expect(html).toContain("estScoreGain is an estimate");
    expect(html).toContain("tier is display metadata");
    expect(html).toContain("point-in-time snapshot");
    expect(html).toContain("not equivalent");
    expect(html).not.toMatch(/<script\b/i);
  });

  it("preserves top-fix order and escapes untrusted values", () => {
    const html = renderOraHtmlReport(result());
    expect(html.indexOf("First &lt;/script&gt;")).toBeLessThan(html.indexOf("Second"));
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;");
    const elements = findElements(parse(html));
    expect(elements.some((element) => element.tagName === "script")).toBe(false);
    expect(elements.every((element) => element.attrs.every((attribute) => !attribute.name.startsWith("on")))).toBe(true);
  });

  it("creates links only for credential-free HTTP(S) URLs", () => {
    const links = findElements(parse(renderOraHtmlReport(result()))).filter((element) => element.tagName === "a");
    expect(links).toHaveLength(1);
    expect(links[0]?.attrs.find((attribute) => attribute.name === "href")?.value).toBe("https://example.com/spec");
  });
});

function findElements(root: DefaultTreeAdapterTypes.ParentNode): Element[] {
  const found: Element[] = [];
  const visit = (node: Node): void => {
    if ("tagName" in node && "attrs" in node) found.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return found;
}
