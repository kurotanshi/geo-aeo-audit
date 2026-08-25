import type { IncomingHttpHeaders } from "node:http";
import { evaluateRobots, type ParsedRobots } from "../discovery/robots.js";
import { normalizeHttpUrl } from "../discovery/url.js";
import {
  AGENT_REGISTRY,
  ALL_PRODUCT_SCOPES,
  type AgentRegistryEntry,
} from "../registry/agents.js";
import type {
  Blocker,
  EvidenceKind,
  Finding,
  RuleResult,
  ScoreImpact,
} from "../schema/result.js";

export interface TechnicalPageObservation {
  url: string;
  status: number;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body: Buffer | string;
}

export interface TechnicalAuditInput {
  targetUrl: string;
  page?: TechnicalPageObservation;
  transportError?: { reason: string; message: string };
  skipContentDueToRobots?: boolean;
  unavailableReason?: string;
  robots: {
    url: string;
    parsed?: ParsedRobots;
    available: boolean;
  };
  sitemapUrls?: readonly string[];
  sitemapDiscoveryAttempted: boolean;
  agents?: readonly AgentRegistryEntry[];
}

export interface TechnicalAuditResult {
  findings: Finding[];
  blockers: Blocker[];
}

type FindingFields = Omit<Finding, "id" | "result"> & {
  severity: "info" | "warning" | "error" | "blocker";
  category: "access_and_eligibility" | "discoverability" | "parseability";
  evidence: string[];
  rationale: string;
  recommendation: string;
  evidence_kind: EvidenceKind;
  score_impact: ScoreImpact;
  claim_scope: string[];
  source_url?: string;
};

const GOOGLE_NOINDEX_SCOPES = ["google_search", "google_discover", "google_images", "google_video", "google_news"];

/** Run the technical eligibility rules without making any network requests. */
export function auditTechnicalEligibility(input: TechnicalAuditInput): TechnicalAuditResult {
  const findings: Finding[] = [];
  const blockers: Blocker[] = [];
  const agents = input.agents ?? AGENT_REGISTRY;

  if (input.transportError !== undefined) {
    const reason = input.transportError?.reason ?? "missing_response";
    const message = input.transportError?.message ?? "No page response was available";
    findings.push(
      finding("technical.transport", "error", {
        severity: "blocker",
        category: "access_and_eligibility",
        evidence: [`${reason}: ${message}`],
        rationale: "The audit transport could not obtain a response, so technical eligibility cannot be measured.",
        recommendation: "Resolve the DNS, TLS, redirect, HTTP, or network failure and run the audit again.",
        evidence_kind: "empirical_observation",
        score_impact: "informational",
        claim_scope: [],
      }),
    );
    blockers.push({
      kind: "transport_or_protocol",
      rule_id: "technical.transport",
      evidence: [`${reason}: ${message}`],
      applies_to: [],
      not_asserted_for: ALL_PRODUCT_SCOPES,
    });
    return { findings, blockers };
  }

  if (input.page === undefined) {
    addUnavailablePageFindings(
      input.targetUrl,
      findings,
      input.unavailableReason ?? "Page content was not fetched because of a measurement limitation.",
    );
    auditProviderRobots(input.targetUrl, input.robots, agents, findings, blockers);
    auditSitemap(input.targetUrl, input.sitemapUrls, input.sitemapDiscoveryAttempted, findings);
    return { findings, blockers };
  }

  const page = input.page;
  const html = typeof page.body === "string" ? page.body : page.body.toString("utf8");
  const httpOk = auditHttp(page, findings, blockers);
  if (!httpOk) {
    addUnavailableContentFindings(page.url, findings, `content_not_evaluated_for_http_${page.status}`);
  } else if (input.skipContentDueToRobots) {
    addUnavailableContentFindings(page.url, findings, "skipped_due_to_robots");
  } else {
    auditIndexability(page, html, findings, blockers);
    auditCanonical(page.url, html, findings);
    auditInitialHtml(html, findings);
    auditRedirectHygiene(html, findings);
  }
  auditProviderRobots(page.url, input.robots, agents, findings, blockers);
  auditSitemap(page.url, input.sitemapUrls, input.sitemapDiscoveryAttempted, findings);
  return { findings, blockers };
}

function addUnavailablePageFindings(url: string, findings: Finding[], reason: string): void {
  findings.push(
    finding("technical.http_status", "not_tested", {
      severity: "warning",
      category: "access_and_eligibility",
      evidence: [`${url}: ${reason}`],
      rationale: reason,
      recommendation: "Review the measurement limitation and rerun when the page can be fetched.",
      evidence_kind: "empirical_observation",
      score_impact: "scored",
      claim_scope: [],
    }),
  );
  addUnavailableContentFindings(url, findings, reason);
}

function addUnavailableContentFindings(url: string, findings: Finding[], reason: string): void {
  const specs = [
    ["technical.indexability", "access_and_eligibility", "scored"],
    ["technical.canonical", "discoverability", "scored"],
    ["technical.initial_html_content", "parseability", "informational"],
    ["technical.redirect_hygiene", "access_and_eligibility", "scored"],
  ] as const;
  for (const [id, category, scoreImpact] of specs) {
    findings.push(
      finding(id, "not_tested", {
        severity: "warning",
        category,
        evidence: [`${url}: ${reason}`],
        rationale: "The initial page content was intentionally not evaluated.",
        recommendation: "Review robots access and rerun the content audit when appropriate.",
        evidence_kind: "empirical_observation",
        score_impact: scoreImpact,
        claim_scope: [],
      }),
    );
  }
}

function auditHttp(page: TechnicalPageObservation, findings: Finding[], blockers: Blocker[]): boolean {
  const ok = page.status >= 200 && page.status < 300;
  findings.push(
    finding("technical.http_status", ok ? "pass" : "fail", {
      severity: ok ? "info" : "blocker",
      category: "access_and_eligibility",
      evidence: [`HTTP ${page.status} for ${page.url}`],
      rationale: ok ? "The final response has a successful HTTP status." : "The final response is not a successful HTTP status.",
      recommendation: ok ? "No change required." : "Serve the audited URL with a successful final HTTP response.",
      evidence_kind: "standard",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes",
    }),
  );
  if (!ok) {
    blockers.push({
      kind: "transport_or_protocol",
      rule_id: "technical.http_status",
      evidence: [`HTTP ${page.status} for ${page.url}`],
      applies_to: [],
      not_asserted_for: ALL_PRODUCT_SCOPES,
    });
  }
  return ok;
}

function auditIndexability(
  page: TechnicalPageObservation,
  html: string,
  findings: Finding[],
  blockers: Blocker[],
): void {
  const directives = [
    ...headerValues(page.headers, "x-robots-tag"),
    ...extractTags(html, "meta")
      .filter((tag) => ["robots", "googlebot"].includes((tag.name ?? "").toLowerCase()))
      .map((tag) => tag.content ?? ""),
  ]
    .flatMap((value) => value.toLowerCase().split(/[\s,]+/))
    .filter(Boolean);
  const noindex = directives.includes("noindex") || directives.includes("none");
  findings.push(
    finding("technical.indexability", noindex ? "fail" : "pass", {
      severity: noindex ? "blocker" : "info",
      category: "access_and_eligibility",
      evidence: directives.length === 0 ? ["No robots noindex directive was observed."] : [`Observed directives: ${directives.join(", ")}`],
      rationale: noindex
        ? "A noindex directive prevents inclusion in the officially documented Google Search scopes."
        : "No noindex directive was observed in the initial response headers or HTML.",
      recommendation: noindex ? "Remove noindex only if this page should be eligible for indexing." : "No change required.",
      evidence_kind: "official_behavior",
      score_impact: "scored",
      claim_scope: GOOGLE_NOINDEX_SCOPES,
      source_url: "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag",
    }),
  );
  if (noindex) {
    blockers.push(providerBlocker("technical.indexability", GOOGLE_NOINDEX_SCOPES, ["Observed a noindex directive."]));
  }
}

export function auditCanonical(pageUrl: string, html: string, findings: Finding[]): string | undefined {
  const hrefs = extractTags(html, "link")
    .filter((tag) => (tag.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .map((tag) => tag.href)
    .filter((href): href is string => href !== undefined && href !== "");
  let result: RuleResult = "pass";
  let canonical: string | undefined;
  let evidence: string[];
  let rationale: string;
  if (hrefs.length === 0) {
    result = "fail";
    evidence = ["No canonical link was found in the initial HTML."];
    rationale = "The page does not state a preferred URL for duplicate consolidation.";
  } else if (hrefs.length > 1) {
    result = "fail";
    evidence = [`Multiple canonical links were found: ${hrefs.join(", ")}`];
    rationale = "Multiple canonical declarations are ambiguous.";
  } else {
    try {
      canonical = normalizeHttpUrl(hrefs[0]!, pageUrl);
      evidence = [`Canonical URL: ${canonical}`];
      rationale = "The initial HTML contains one syntactically valid canonical URL.";
    } catch {
      result = "fail";
      evidence = [`Invalid canonical URL: ${hrefs[0]}`];
      rationale = "The canonical declaration is not a valid HTTP(S) URL.";
    }
  }
  findings.push(
    finding("technical.canonical", result, {
      severity: result === "pass" ? "info" : "warning",
      category: "discoverability",
      evidence,
      rationale,
      recommendation: result === "pass" ? "No change required." : "Provide exactly one valid canonical link in the initial HTML.",
      evidence_kind: "official_recommendation",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
    }),
  );
  return canonical;
}

function auditProviderRobots(
  pageUrl: string,
  robots: TechnicalAuditInput["robots"],
  agents: readonly AgentRegistryEntry[],
  findings: Finding[],
  blockers: Blocker[],
): void {
  for (const agent of agents) {
    const id = `technical.robots.${agent.id}`;
    if (!robots.available || robots.parsed === undefined) {
      findings.push(
        finding(id, "not_tested", {
          severity: "warning",
          category: "access_and_eligibility",
          evidence: [`robots.txt was unavailable at ${robots.url}`],
          rationale: `The ${agent.productToken} policy could not be measured.`,
          recommendation: "Make robots.txt reliably available and rerun the audit.",
          evidence_kind: "empirical_observation",
          score_impact:
            agent.robotsApplicability === "applies" || agent.robotsApplicability === "control_token"
              ? "scored"
              : "informational",
          claim_scope: [...agent.productScopes],
          source_url: agent.officialSourceUrl,
        }),
      );
      continue;
    }

    const decision = evaluateRobots(robots.parsed, pageUrl, agent.productToken);
    const denied = !decision.allowed;
    const asserted = agent.robotsApplicability === "applies" || agent.robotsApplicability === "control_token";
    findings.push(
      finding(id, denied ? "fail" : "pass", {
        severity: denied && asserted ? "blocker" : denied ? "warning" : "info",
        category: "access_and_eligibility",
        evidence: [
          denied
            ? `${agent.productToken} is disallowed by ${decision.matchedRule?.pattern ?? "a matching robots rule"}.`
            : `${agent.productToken} is allowed for ${new URL(pageUrl).pathname}.`,
          `Documented applicability: ${agent.robotsApplicability}.`,
        ],
        rationale: agent.officialSummary,
        recommendation: denied
          ? asserted
            ? `Allow ${agent.productToken} only if the documented product scopes should access this page.`
            : `Review the ${agent.productToken} rule; its official behavior does not support a definitive eligibility blocker.`
          : "No change required.",
        evidence_kind: "official_behavior",
        score_impact: asserted ? "scored" : "informational",
        claim_scope: [...agent.productScopes],
        source_url: agent.officialSourceUrl,
      }),
    );
    if (denied && asserted) {
      blockers.push(providerBlocker(id, [...agent.productScopes], [`${agent.productToken} is disallowed by robots.txt.`]));
    }
  }
}

function auditSitemap(
  pageUrl: string,
  sitemapUrls: readonly string[] | undefined,
  attempted: boolean,
  findings: Finding[],
): void {
  const normalizedPage = normalizeHttpUrl(pageUrl);
  const normalizedSitemapUrls = new Set<string>();
  for (const url of sitemapUrls ?? []) {
    try {
      normalizedSitemapUrls.add(normalizeHttpUrl(url));
    } catch {
      // Invalid sitemap entries are reported by discovery and cannot match.
    }
  }
  const tested = attempted && normalizedSitemapUrls.size > 0;
  const included = normalizedSitemapUrls.has(normalizedPage);
  const result: RuleResult = !tested ? "not_tested" : included ? "pass" : "fail";
  findings.push(
    finding("technical.sitemap_membership", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "discoverability",
      evidence: !tested
        ? ["No successfully parsed sitemap URL set was available."]
        : [included ? `${normalizedPage} was found in a sitemap.` : `${normalizedPage} was not found in parsed sitemaps.`],
      rationale: !tested
        ? "Sitemap membership could not be measured."
        : included
          ? "The audited page is explicitly discoverable through a parsed sitemap."
          : "The audited page was not present in the sitemap URLs observed by this bounded audit.",
      recommendation: result === "fail" ? "Add the canonical page URL to an appropriate sitemap if it should be discovered." : "No change required.",
      evidence_kind: "standard",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://www.sitemaps.org/protocol.html",
    }),
  );
}

function auditInitialHtml(html: string, findings: Finding[]): void {
  const hasScripts = /<script\b/i.test(html);
  const visibleText = initialVisibleText(html);
  const needsRendering = hasScripts && visibleText.length < 80;
  findings.push(
    finding("technical.initial_html_content", needsRendering ? "not_tested" : "pass", {
      severity: needsRendering ? "warning" : "info",
      category: "parseability",
      evidence: [`Initial HTML visible-text length: ${visibleText.length}; script element observed: ${hasScripts}.`],
      rationale: needsRendering
        ? "需要瀏覽器渲染才能確認；靜態回應不足以判定主要內容是否存在，也不代表內容無法被任何 AI 使用。"
        : "The initial HTML contains directly observable text, so static content checks can proceed.",
      recommendation: needsRendering
        ? "Render meaningful primary content in the initial HTML when practical, or verify it separately with a browser-based audit."
        : "No change required.",
      evidence_kind: "empirical_observation",
      score_impact: "informational",
      claim_scope: [],
      source_url: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
    }),
  );
}

function auditRedirectHygiene(html: string, findings: Finding[]): void {
  const metaRefresh = extractTags(html, "meta").some(
    (tag) => (tag["http-equiv"] ?? "").trim().toLowerCase() === "refresh",
  );
  const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => match[1] ?? "")
    .join("\n");
  const jsRedirect =
    initialVisibleText(html).length < 80 &&
    /\b(?:window\.)?location\.href\s*=|\b(?:window\.)?location\.replace\s*\(|\bwindow\.location\s*=/i.test(
      inlineScripts,
    );
  const failed = metaRefresh || jsRedirect;
  const evidence = [
    `Meta refresh observed: ${metaRefresh}.`,
    `JavaScript-only redirect stub observed: ${jsRedirect}.`,
  ];
  findings.push(
    finding("technical.redirect_hygiene", failed ? "fail" : "pass", {
      severity: failed ? "warning" : "info",
      category: "access_and_eligibility",
      evidence,
      rationale: failed
        ? "The initial HTML depends on a client-side redirect that non-rendering agents may not follow."
        : "No meta refresh or low-content JavaScript-only redirect stub was observed.",
      recommendation: failed
        ? "Use an appropriate HTTP redirect and serve the destination URL directly to non-rendering clients."
        : "No change required.",
      evidence_kind: "empirical_observation",
      score_impact: "scored",
      claim_scope: [],
      source_url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections",
    }),
  );
}

function initialVisibleText(html: string): string {
  return html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function providerBlocker(ruleId: string, appliesTo: string[], evidence: string[]): Blocker {
  const applies = new Set(appliesTo);
  return {
    kind: "provider_eligibility",
    rule_id: ruleId,
    applies_to: appliesTo,
    not_asserted_for: ALL_PRODUCT_SCOPES.filter((scope) => !applies.has(scope)),
    evidence,
    evidence_kind: "official_behavior",
  };
}

function finding(id: string, result: RuleResult, fields: FindingFields): Finding {
  return { id, result, ...fields };
}

function headerValues(
  headers: TechnicalPageObservation["headers"],
  name: string,
): string[] {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return Array.isArray(direct) ? direct : [direct];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && value !== undefined) {
      return Array.isArray(value) ? value : [value];
    }
  }
  return [];
}

function extractTags(html: string, tagName: "meta" | "link"): Record<string, string>[] {
  const tags: Record<string, string>[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(pattern)) {
    const attributes: Record<string, string> = {};
    const source = match[0];
    const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of source.matchAll(attrPattern)) {
      const key = (attr[1] ?? "").toLowerCase();
      if (key === tagName) continue;
      attributes[key] = decodeHtmlAttribute(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    tags.push(attributes);
  }
  return tags;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
