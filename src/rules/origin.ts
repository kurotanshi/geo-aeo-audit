import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { CRAWLER_PRODUCT_TOKEN } from "../discovery/discover.js";
import { evaluateRobots, type ParsedRobots } from "../discovery/robots.js";
import type { Finding, RuleResult } from "../schema/result.js";
import { TransportError } from "../transport/errors.js";
import type { SafeResponse } from "../transport/safe-fetch.js";

type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

export type OriginProbeFetch = (url: string, allowedOrigin?: string, accept?: string) => Promise<SafeResponse>;

export interface OriginProbeInput {
  origin: string;
  robots: {
    parsed?: ParsedRobots;
    available: boolean;
  };
  fetch: OriginProbeFetch;
  primaryPageUrl?: string;
  primaryPageHtml?: string;
  unavailableReason?: string;
}

export class OriginProbeBudgetError extends Error {
  constructor() {
    super("origin probe byte budget is exhausted");
    this.name = "OriginProbeBudgetError";
  }
}

export async function auditOriginProbes(input: OriginProbeInput): Promise<Finding[]> {
  if (input.unavailableReason !== undefined || !input.robots.available || input.robots.parsed === undefined) {
    const reason = input.unavailableReason ?? "robots.txt is unavailable";
    return [
      unavailableLlmsTxt(input.origin, reason),
      unavailableNotFound(input.origin, reason),
      unavailableMarkdownNegotiation(input.origin, reason),
      unavailableTrustPages(input.origin, reason),
    ];
  }

  return [
    await auditLlmsTxt(input),
    await auditNotFoundStatus(input),
    await auditMarkdownNegotiation(input),
    await auditTrustPages(input),
  ];
}

function unavailableLlmsTxt(origin: string, reason: string): Finding {
  return finding("technical.llms_txt", "not_tested", origin, {
    severity: "warning",
    category: "discoverability",
    evidence: [reason],
    rationale: "The origin-scoped llms.txt probe could not be measured.",
    recommendation: "Allow the audit crawler to fetch llms.txt and rerun the audit.",
    evidence_kind: "heuristic",
    score_impact: "experimental",
    claim_scope: [],
    source_url: "https://llmstxt.org/",
  });
}

function unavailableNotFound(origin: string, reason: string): Finding {
  return finding("technical.not_found_status", "not_tested", origin, {
    severity: "warning",
    category: "access_and_eligibility",
    evidence: [reason],
    rationale: "The origin-scoped not-found response probe could not be measured.",
    recommendation: "Allow the audit crawler to fetch a synthetic missing path and rerun the audit.",
    evidence_kind: "official_behavior",
    score_impact: "scored",
    claim_scope: [],
    source_url: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
  });
}

function unavailableMarkdownNegotiation(origin: string, reason: string): Finding {
  return finding("technical.markdown_negotiation", "not_tested", origin, {
    severity: "warning",
    category: "parseability",
    evidence: [reason],
    rationale: "The primary page was unavailable for Markdown content negotiation.",
    recommendation: "Make the primary page retrievable and rerun the audit.",
    evidence_kind: "heuristic",
    score_impact: "experimental",
    claim_scope: [],
    source_url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
  });
}

function unavailableTrustPages(origin: string, reason: string): Finding {
  return finding("technical.trust_pages", "not_tested", origin, {
    severity: "warning",
    category: "source_and_evidence",
    evidence: [reason],
    rationale: "The primary page was unavailable for trust-page discovery.",
    recommendation: "Make the primary page and its trust links available to the audit crawler.",
    evidence_kind: "official_recommendation",
    score_impact: "scored",
    claim_scope: [],
    source_url: "https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf",
  });
}

async function auditLlmsTxt(input: OriginProbeInput): Promise<Finding> {
  const candidates = ["/llms.txt", "/.well-known/llms.txt"].map((path) => new URL(path, input.origin).toString());
  const evidence: string[] = [];
  let measurementError = false;
  let measurementUnavailable = false;

  for (const url of candidates) {
    if (!evaluateRobots(input.robots.parsed!, url, CRAWLER_PRODUCT_TOKEN).allowed) {
      evidence.push(`${url}: blocked by robots.txt`);
      measurementUnavailable = true;
      continue;
    }

    let response: SafeResponse;
    try {
      response = await input.fetch(url, input.origin);
    } catch (error) {
      evidence.push(`${url}: ${errorMessage(error)}`);
      if (error instanceof OriginProbeBudgetError) measurementUnavailable = true;
      else measurementError = true;
      continue;
    }

    const contentType = headerValue(response, "content-type").toLowerCase();
    const text = response.body.toString("utf8").trim();
    const html = contentType.includes("text/html") || /^\s*<(?:!doctype\s+html|html)\b/i.test(text);
    evidence.push(`${url}: HTTP ${response.status}, ${contentType || "content-type missing"}, ${text.length} characters`);
    if (response.status >= 200 && response.status < 300 && !html && text.length >= 100) {
      return finding("technical.llms_txt", "pass", input.origin, {
        severity: "info",
        category: "discoverability",
        evidence,
        rationale: "A substantial non-HTML llms.txt document is available.",
        recommendation: "Keep the document current and aligned with the public site.",
        evidence_kind: "heuristic",
        score_impact: "experimental",
        claim_scope: [],
        source_url: "https://llmstxt.org/",
      });
    }
    if (response.status >= 500) measurementError = true;
  }

  if (measurementError) {
    return finding("technical.llms_txt", "error", input.origin, {
      severity: "error",
      category: "discoverability",
      evidence,
      rationale: "At least one llms.txt location failed during measurement and neither location passed.",
      recommendation: "Make the llms.txt locations reliably retrievable and rerun the audit.",
      evidence_kind: "heuristic",
      score_impact: "experimental",
      claim_scope: [],
      source_url: "https://llmstxt.org/",
    });
  }
  if (measurementUnavailable) return unavailableLlmsTxt(input.origin, evidence.join("; "));

  return finding("technical.llms_txt", "fail", input.origin, {
    severity: "warning",
    category: "discoverability",
    evidence,
    rationale: "Neither standard llms.txt location returned a substantial non-HTML document.",
    recommendation: "Publish at least 100 characters of plain text or Markdown at /llms.txt or /.well-known/llms.txt.",
    evidence_kind: "heuristic",
    score_impact: "experimental",
    claim_scope: [],
    source_url: "https://llmstxt.org/",
  });
}

async function auditNotFoundStatus(input: OriginProbeInput): Promise<Finding> {
  const suffix = createHash("sha256").update(input.origin).digest("hex").slice(0, 16);
  const url = new URL(`/geo-aeo-audit-not-found-${suffix}`, input.origin).toString();
  if (!evaluateRobots(input.robots.parsed!, url, CRAWLER_PRODUCT_TOKEN).allowed) {
    return unavailableNotFound(input.origin, `${url}: blocked by robots.txt`);
  }

  let response: SafeResponse;
  try {
    response = await input.fetch(url, input.origin);
  } catch (error) {
    if (error instanceof OriginProbeBudgetError) return unavailableNotFound(input.origin, `${url}: ${error.message}`);
    return finding("technical.not_found_status", "error", input.origin, {
      severity: "error",
      category: "access_and_eligibility",
      evidence: [`${url}: ${errorMessage(error)}`],
      rationale: "The synthetic not-found path could not be measured.",
      recommendation: "Make missing paths respond reliably and rerun the audit.",
      evidence_kind: "official_behavior",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
    });
  }

  const evidence = [`${url}: HTTP ${response.status} (final URL ${response.finalUrl})`];
  if (response.status >= 500) {
    return finding("technical.not_found_status", "error", input.origin, {
      severity: "error",
      category: "access_and_eligibility",
      evidence,
      rationale: "The synthetic not-found path returned a server error.",
      recommendation: "Return a stable 404 or 410 response for missing paths.",
      evidence_kind: "official_behavior",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
    });
  }

  const pass = response.status === 404 || response.status === 410;
  return finding("technical.not_found_status", pass ? "pass" : "fail", input.origin, {
    severity: pass ? "info" : "warning",
    category: "access_and_eligibility",
    evidence,
    rationale: pass
      ? "The synthetic missing path returned an explicit not-found status."
      : "The synthetic missing path did not return 404 or 410.",
    recommendation: pass ? "No change required." : "Return HTTP 404 or 410 for missing resources instead of a soft-404 page.",
    evidence_kind: "official_behavior",
    score_impact: "scored",
    claim_scope: [],
    source_url: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
  });
}

async function auditMarkdownNegotiation(input: OriginProbeInput): Promise<Finding> {
  const url = input.primaryPageUrl;
  if (url === undefined) return unavailableMarkdownNegotiation(input.origin, "no successful primary page was available");
  if (!evaluateRobots(input.robots.parsed!, url, CRAWLER_PRODUCT_TOKEN).allowed) {
    return unavailableMarkdownNegotiation(input.origin, `${url}: blocked by robots.txt`);
  }

  let response: SafeResponse;
  try {
    response = await input.fetch(url, input.origin, "text/markdown");
  } catch (error) {
    if (error instanceof OriginProbeBudgetError) {
      return unavailableMarkdownNegotiation(input.origin, `${url}: ${error.message}`);
    }
    return finding("technical.markdown_negotiation", "error", input.origin, {
      severity: "error",
      category: "parseability",
      evidence: [`${url}: ${errorMessage(error)}`],
      rationale: "The Markdown negotiation request failed during measurement.",
      recommendation: "Make the negotiated representation reliably retrievable and rerun the audit.",
      evidence_kind: "heuristic",
      score_impact: "experimental",
      claim_scope: [],
      source_url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
    });
  }

  const contentType = headerValue(response, "content-type").toLowerCase();
  const vary = headerValue(response, "vary");
  const variesOnAccept = vary
    .split(",")
    .some((name) => name.trim().toLowerCase() === "accept");
  const markdown = contentType.split(";", 1)[0]?.trim() === "text/markdown";
  const evidence = [`${url}: HTTP ${response.status}, ${contentType || "content-type missing"}, Vary: ${vary || "missing"}`];

  if (response.status >= 500) {
    return markdownFinding("error", "error", input.origin, evidence, "The negotiation request returned a server error.");
  }
  if (response.status >= 200 && response.status < 300 && markdown && variesOnAccept) {
    return markdownFinding("pass", "info", input.origin, evidence, "The page serves Markdown and varies caches by Accept.");
  }
  const rationale = markdown && !variesOnAccept
    ? "The page serves Markdown but does not declare Vary: Accept."
    : "The page did not return a valid Markdown representation for the requested Accept header.";
  return markdownFinding("fail", "warning", input.origin, evidence, rationale);
}

function markdownFinding(
  result: RuleResult,
  severity: "info" | "warning" | "error",
  origin: string,
  evidence: string[],
  rationale: string,
): Finding {
  return finding("technical.markdown_negotiation", result, origin, {
    severity,
    category: "parseability",
    evidence,
    rationale,
    recommendation: result === "pass" ? "No change required." : "Serve text/markdown for Accept: text/markdown and include Vary: Accept.",
    evidence_kind: "heuristic",
    score_impact: "experimental",
    claim_scope: [],
    source_url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
  });
}

async function auditTrustPages(input: OriginProbeInput): Promise<Finding> {
  if (input.primaryPageUrl === undefined || input.primaryPageHtml === undefined) {
    return unavailableTrustPages(input.origin, "no successful primary page was available");
  }

  const candidates = trustPageCandidates(input.primaryPageHtml, input.primaryPageUrl, input.origin);
  const evidence: string[] = [];
  let failed = false;
  let errored = false;
  let unavailable = false;

  for (const category of ["about", "contact", "privacy"] as const) {
    const candidate = candidates[category];
    if (candidate.url === undefined) {
      failed = true;
      evidence.push(
        candidate.crossOriginUrl === undefined
          ? `${category}: no matching link found`
          : `${category}: no same-origin link; cross-origin candidate ${candidate.crossOriginUrl}`,
      );
      continue;
    }
    if (!evaluateRobots(input.robots.parsed!, candidate.url, CRAWLER_PRODUCT_TOKEN).allowed) {
      unavailable = true;
      evidence.push(`${category}: ${candidate.url}, blocked by robots.txt`);
      continue;
    }

    let response: SafeResponse;
    try {
      response = await input.fetch(candidate.url, input.origin);
    } catch (error) {
      if (error instanceof OriginProbeBudgetError) unavailable = true;
      else errored = true;
      evidence.push(`${category}: ${candidate.url}, ${errorMessage(error)}`);
      continue;
    }
    const characters = visibleText(response.body.toString("utf8")).length;
    evidence.push(`${category}: ${candidate.url}, HTTP ${response.status}, ${characters} visible characters`);
    if (response.status >= 500) errored = true;
    else if (response.status < 200 || response.status >= 300 || characters < 500) failed = true;
  }

  const result: RuleResult = errored ? "error" : unavailable ? "not_tested" : failed ? "fail" : "pass";
  return finding("technical.trust_pages", result, input.origin, {
    severity: result === "pass" ? "info" : result === "error" ? "error" : "warning",
    category: "source_and_evidence",
    evidence,
    rationale:
      result === "pass"
        ? "The primary page links to substantial same-origin about, contact, and privacy pages."
        : result === "error"
          ? "At least one trust page failed during measurement."
          : result === "not_tested"
            ? "At least one trust page could not be measured."
            : "One or more trust-page links were missing, unsuccessful, or lacked substantial visible text.",
    recommendation:
      result === "pass"
        ? "No change required."
        : "Link same-origin about, contact, and privacy pages from the primary page and provide at least 500 visible characters on each.",
    evidence_kind: "official_recommendation",
    score_impact: "scored",
    claim_scope: [],
    source_url: "https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf",
  });
}

function trustPageCandidates(html: string, pageUrl: string, origin: string) {
  const result: Record<"about" | "contact" | "privacy", { url?: string; crossOriginUrl?: string }> = {
    about: {},
    contact: {},
    privacy: {},
  };
  const document = parse(html);
  for (const anchor of findElements(document, "a")) {
    const href = attribute(anchor, "href");
    if (href === undefined || href === "") continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const haystack = `${url.pathname} ${textContent(anchor)}`.toLowerCase();
    const category = classifyTrustLink(haystack);
    if (category === undefined) continue;
    const normalized = url.toString();
    if (url.origin === origin) result[category].url ??= normalized;
    else result[category].crossOriginUrl ??= normalized;
  }
  return result;
}

function classifyTrustLink(value: string): "about" | "contact" | "privacy" | undefined {
  if (/\babout\b|關於|公司簡介/.test(value)) return "about";
  if (/\bcontact\b|聯絡|聯繫|客服/.test(value)) return "contact";
  if (/\bprivacy\b|隱私/.test(value)) return "privacy";
  return undefined;
}

function visibleText(html: string): string {
  const document = parse(html);
  return textContent(document, new Set(["script", "style", "noscript", "svg"]))
    .replace(/\s+/g, " ")
    .trim();
}

function findElements(root: ParentNode, tagName: string): Element[] {
  const found: Element[] = [];
  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === tagName) found.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return found;
}

function isElement(node: Node): node is Element {
  return "tagName" in node && "attrs" in node;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function textContent(node: Node, excluded = new Set<string>()): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
  if (isElement(node) && excluded.has(node.tagName)) return "";
  if ("childNodes" in node) return node.childNodes.map((child) => textContent(child, excluded)).join("");
  return "";
}

function headerValue(response: SafeResponse, name: string): string {
  const value = response.headers[name];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function errorMessage(error: unknown): string {
  if (error instanceof TransportError || error instanceof Error) return error.message;
  return String(error);
}

function finding(
  id: string,
  result: RuleResult,
  subjectUrl: string,
  fields: Omit<Finding, "id" | "result" | "subject_url">,
): Finding {
  return { id, result, ...fields, subject_url: subjectUrl };
}
