import type { AuditConfig } from "../config.js";
import { CRAWLER_PRODUCT_TOKEN, discoverSite, type DiscoveryFetch } from "../discovery/discover.js";
import { evaluateRobots, parseRobotsTxt, type ParsedRobots } from "../discovery/robots.js";
import { normalizeHttpUrl } from "../discovery/url.js";
import { auditTechnicalEligibility, type TechnicalAuditResult } from "../rules/technical.js";
import type { AuditResult, Blocker, Finding } from "../schema/result.js";
import { TransportError } from "../transport/errors.js";
import { safeFetch, type SafeResponse, type TransportDeps } from "../transport/safe-fetch.js";
import { SCHEMA_VERSION, TOOL_VERSION, RULESET_VERSION, USER_AGENT } from "../version.js";

export interface RunAuditDeps {
  fetch?: DiscoveryFetch;
  transportDeps?: TransportDeps;
  now?: () => Date;
}

/** Fetch the requested scope and run the technical rules implemented so far. */
export async function runAudit(config: AuditConfig, deps: RunAuditDeps = {}): Promise<AuditResult> {
  const findings: Finding[] = [];
  const blockers: Blocker[] = [];

  if (config.mode === "site") {
    try {
      const discovery = await discoverSite(config.url, {
        limits: config.limits,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        ...(deps.transportDeps === undefined ? {} : { transportDeps: deps.transportDeps }),
      });
      const robotsAvailable = discovery.robots.error === undefined && (discovery.robots.status ?? 200) < 500;
      for (const sampled of discovery.pages) {
        let audit: TechnicalAuditResult;
        if (sampled.state === "fetch_error") {
          audit = auditTechnicalEligibility({
            targetUrl: sampled.url,
            transportError: { reason: "fetch_error", message: sampled.error ?? "sample fetch failed" },
            robots: { url: discovery.robots.url, parsed: discovery.robots.parsed, available: robotsAvailable },
            sitemapUrls: discovery.sitemapUrls,
            sitemapDiscoveryAttempted: true,
          });
        } else if (sampled.response === undefined) {
          audit = auditTechnicalEligibility({
            targetUrl: sampled.url,
            unavailableReason:
              sampled.state === "skipped_by_robots"
                ? "skipped_due_to_robots"
                : sampled.error ?? "skipped_due_to_robots_unavailable",
            robots: { url: discovery.robots.url, parsed: discovery.robots.parsed, available: robotsAvailable },
            sitemapUrls: discovery.sitemapUrls,
            sitemapDiscoveryAttempted: true,
          });
        } else {
          audit = auditTechnicalEligibility({
            targetUrl: sampled.url,
            page: responseObservation(sampled.response),
            skipContentDueToRobots: sampled.state === "skipped_by_robots",
            robots: { url: discovery.robots.url, parsed: discovery.robots.parsed, available: robotsAvailable },
            sitemapUrls: discovery.sitemapUrls,
            sitemapDiscoveryAttempted: true,
          });
        }
        appendSubject(audit, sampled.url, findings, blockers);
      }
    } catch (error) {
      appendSubject(transportFailure(config.url, error), config.url, findings, blockers);
    }
  } else {
    const audit = await auditSinglePage(config, deps);
    appendSubject(audit.result, audit.subjectUrl, findings, blockers);
  }

  return {
    schema_version: SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    ruleset_version: RULESET_VERSION,
    generated_at: (deps.now?.() ?? new Date()).toISOString(),
    target: { requested_url: config.url, mode: config.mode },
    findings,
    blockers,
  };
}

async function auditSinglePage(
  config: AuditConfig,
  deps: RunAuditDeps,
): Promise<{ subjectUrl: string; result: TechnicalAuditResult }> {
  const fetchImpl = deps.fetch ?? safeFetch;
  let downloadedBytes = 0;
  const fetchWithinBudget = async (url: string, allowedOrigin?: string): Promise<SafeResponse> => {
    const remaining = config.limits.maxTotalBytes - downloadedBytes;
    if (remaining <= 0) throw new TransportError("response_too_large", "total download byte limit reached");
    const response = await fetchImpl(url, {
      limits: { ...config.limits, maxResponseBytes: Math.min(config.limits.maxResponseBytes, remaining) },
      userAgent: USER_AGENT,
      ...(deps.transportDeps === undefined ? {} : { deps: deps.transportDeps }),
      ...(allowedOrigin === undefined ? {} : { allowedOrigin }),
    });
    downloadedBytes += response.rawBodyBytes;
    return response;
  };

  let response: SafeResponse;
  try {
    response = await fetchWithinBudget(normalizeHttpUrl(config.url));
  } catch (error) {
    return { subjectUrl: config.url, result: transportFailure(config.url, error) };
  }

  const subjectUrl = normalizeHttpUrl(response.finalUrl);
  const origin = new URL(subjectUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  let robots: ParsedRobots | undefined;
  let robotsAvailable = false;
  try {
    const robotsResponse = await fetchWithinBudget(robotsUrl, origin);
    if (robotsResponse.status >= 200 && robotsResponse.status < 300) {
      robots = parseRobotsTxt(robotsResponse.body.toString("utf8"));
      robotsAvailable = true;
    } else if (robotsResponse.status >= 400 && robotsResponse.status < 500) {
      robots = parseRobotsTxt("");
      robotsAvailable = true;
    }
  } catch {
    // The page remains auditable; provider robots checks become NOT_TESTED.
  }

  const ownCrawlerDenied =
    robotsAvailable && robots !== undefined && !evaluateRobots(robots, subjectUrl, CRAWLER_PRODUCT_TOKEN).allowed;
  return {
    subjectUrl,
    result: auditTechnicalEligibility({
      targetUrl: subjectUrl,
      page: responseObservation(response),
      skipContentDueToRobots: ownCrawlerDenied,
      robots: { url: robotsUrl, ...(robots === undefined ? {} : { parsed: robots }), available: robotsAvailable },
      sitemapDiscoveryAttempted: false,
    }),
  };
}

function responseObservation(response: SafeResponse) {
  return {
    url: normalizeHttpUrl(response.finalUrl),
    status: response.status,
    headers: response.headers,
    body: response.body,
  };
}

function transportFailure(url: string, error: unknown): TechnicalAuditResult {
  const reason = error instanceof TransportError ? error.reason : "audit_failure";
  const message = error instanceof Error ? error.message : String(error);
  return auditTechnicalEligibility({
    targetUrl: url,
    transportError: { reason, message },
    robots: { url: safeRobotsUrl(url), available: false },
    sitemapDiscoveryAttempted: false,
  });
}

function safeRobotsUrl(raw: string): string {
  try {
    return new URL("/robots.txt", raw).toString();
  } catch {
    return raw;
  }
}

function appendSubject(
  result: TechnicalAuditResult,
  subjectUrl: string,
  findings: Finding[],
  blockers: Blocker[],
): void {
  findings.push(...result.findings.map((item) => ({ ...item, subject_url: subjectUrl })));
  blockers.push(...result.blockers.map((item) => ({ ...item, subject_url: subjectUrl })));
}
