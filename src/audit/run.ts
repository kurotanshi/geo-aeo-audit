import type { AuditConfig } from "../config.js";
import {
  CRAWLER_PRODUCT_TOKEN,
  DEFAULT_SAMPLING_SEED,
  discoverSite,
  SAMPLING_HASH_ALGORITHM,
  type DiscoveryFetch,
} from "../discovery/discover.js";
import { evaluateRobots, parseRobotsTxt, type ParsedRobots } from "../discovery/robots.js";
import { normalizeHttpUrl, URL_NORMALIZATION_VERSION } from "../discovery/url.js";
import { auditPageContent } from "../rules/content.js";
import {
  auditOriginProbes,
  OriginProbeBudgetError,
  type OriginProbeFetch,
} from "../rules/origin.js";
import { auditTechnicalEligibility, type TechnicalAuditResult } from "../rules/technical.js";
import { buildScorecards } from "../scorecard.js";
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
  const selectedSamples: AuditResult["metadata"]["sampling"]["selected"] = [];

  if (config.mode === "site") {
    try {
      const discovery = await discoverSite(config.url, {
        limits: config.limits,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        ...(deps.transportDeps === undefined ? {} : { transportDeps: deps.transportDeps }),
      });
      const robotsAvailable = discovery.robots.error === undefined && (discovery.robots.status ?? 200) < 500;
      selectedSamples.push(
        ...discovery.pages.map((page) => ({
          url: page.url,
          hash: page.hash,
          state: page.state,
        })),
      );
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
          appendContentFindings(audit, sampled.url, undefined, sampled.error ?? "fetch_error");
        } else if (sampled.response === undefined) {
          const unavailableReason =
            sampled.state === "skipped_by_robots"
              ? "skipped_due_to_robots"
              : sampled.error ?? "skipped_due_to_robots_unavailable";
          audit = auditTechnicalEligibility({
            targetUrl: sampled.url,
            unavailableReason,
            robots: { url: discovery.robots.url, parsed: discovery.robots.parsed, available: robotsAvailable },
            sitemapUrls: discovery.sitemapUrls,
            sitemapDiscoveryAttempted: true,
          });
          appendContentFindings(audit, sampled.url, undefined, unavailableReason);
        } else {
          audit = auditTechnicalEligibility({
            targetUrl: sampled.url,
            page: responseObservation(sampled.response),
            skipContentDueToRobots: sampled.state === "skipped_by_robots",
            robots: { url: discovery.robots.url, parsed: discovery.robots.parsed, available: robotsAvailable },
            sitemapUrls: discovery.sitemapUrls,
            sitemapDiscoveryAttempted: true,
          });
          if (sampled.response.status >= 200 && sampled.response.status < 300) {
            appendContentFindings(audit, sampled.url, sampled.response.body);
          } else {
            appendContentFindings(
              audit,
              sampled.url,
              undefined,
              `content_not_evaluated_for_http_${sampled.response.status}`,
            );
          }
        }
        appendSubject(audit, sampled.url, findings, blockers);
      }
      const primary = primaryPage(discovery.pages);
      findings.push(
        ...(await auditOriginProbes({
          origin: discovery.origin,
          robots: { parsed: discovery.robots.parsed, available: robotsAvailable },
          fetch: createBudgetedFetch(config, deps, discovery.resources.downloadedBytes),
          ...(primary === undefined
            ? {}
            : { primaryPageUrl: primary.url, primaryPageHtml: primary.body.toString("utf8") }),
        })),
      );
    } catch (error) {
      appendSubject(transportFailure(config.url, error), config.url, findings, blockers);
      findings.push(...(await unavailableOriginProbes(config, deps, "initial fetch failed; final origin unavailable")));
    }
  } else {
    const audit = await auditSinglePage(config, deps);
    appendSubject(audit.result, audit.subjectUrl, findings, blockers);
    findings.push(...audit.originFindings);
  }

  return {
    schema_version: SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    ruleset_version: RULESET_VERSION,
    generated_at: (deps.now?.() ?? new Date()).toISOString(),
    target: {
      requested_url: config.url,
      normalized_url: normalizeHttpUrl(config.url),
      mode: config.mode,
    },
    metadata: {
      url_normalization: { version: URL_NORMALIZATION_VERSION },
      sampling: {
        applied: config.mode === "site",
        method: "stable-hash",
        hash_algorithm: SAMPLING_HASH_ALGORITHM,
        seed: DEFAULT_SAMPLING_SEED,
        selected: selectedSamples,
      },
      public_suffix_list: {
        used: false,
        package_name: null,
        package_version: null,
        data_version: null,
        scope_basis: "origin",
      },
      limits: { ...config.limits },
    },
    findings,
    scorecards: buildScorecards(findings),
    blockers,
  };
}

async function auditSinglePage(
  config: AuditConfig,
  deps: RunAuditDeps,
): Promise<{ subjectUrl: string; result: TechnicalAuditResult; originFindings: Finding[] }> {
  const fetchWithinBudget = createBudgetedFetch(config, deps);

  let response: SafeResponse;
  try {
    response = await fetchWithinBudget(normalizeHttpUrl(config.url));
  } catch (error) {
    return {
      subjectUrl: config.url,
      result: transportFailure(config.url, error),
      originFindings: await unavailableOriginProbes(config, deps, "initial fetch failed; final origin unavailable"),
    };
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
  const result = withPageContent(
    auditTechnicalEligibility({
      targetUrl: subjectUrl,
      page: responseObservation(response),
      skipContentDueToRobots: ownCrawlerDenied,
      robots: { url: robotsUrl, ...(robots === undefined ? {} : { parsed: robots }), available: robotsAvailable },
      sitemapDiscoveryAttempted: false,
    }),
    subjectUrl,
    response.status >= 200 && response.status < 300 && !ownCrawlerDenied ? response.body : undefined,
    ownCrawlerDenied ? "skipped_due_to_robots" : `content_not_evaluated_for_http_${response.status}`,
  );
  return {
    subjectUrl,
    result,
    originFindings: await auditOriginProbes({
      origin,
      robots: { ...(robots === undefined ? {} : { parsed: robots }), available: robotsAvailable },
      fetch: fetchWithinBudget,
      primaryPageUrl: subjectUrl,
      ...(response.status >= 200 && response.status < 300 && !ownCrawlerDenied
        ? { primaryPageHtml: response.body.toString("utf8") }
        : {}),
    }),
  };
}

function createBudgetedFetch(config: AuditConfig, deps: RunAuditDeps, initialDownloadedBytes = 0): OriginProbeFetch {
  const fetchImpl = deps.fetch ?? safeFetch;
  let downloadedBytes = initialDownloadedBytes;
  return async (url: string, allowedOrigin?: string, accept?: string): Promise<SafeResponse> => {
    const remaining = config.limits.maxTotalBytes - downloadedBytes;
    if (remaining <= 0) throw new OriginProbeBudgetError();
    const responseLimit = Math.min(config.limits.maxResponseBytes, remaining);
    let response: SafeResponse;
    try {
      response = await fetchImpl(url, {
        limits: { ...config.limits, maxResponseBytes: responseLimit },
        userAgent: USER_AGENT,
        ...(accept === undefined ? {} : { accept }),
        ...(deps.transportDeps === undefined ? {} : { deps: deps.transportDeps }),
        ...(allowedOrigin === undefined ? {} : { allowedOrigin }),
      });
    } catch (error) {
      if (
        remaining < config.limits.maxResponseBytes &&
        error instanceof TransportError &&
        error.reason === "response_too_large"
      ) {
        throw new OriginProbeBudgetError();
      }
      throw error;
    }
    if (response.rawBodyBytes > remaining) throw new OriginProbeBudgetError();
    downloadedBytes += response.rawBodyBytes;
    return response;
  };
}

function primaryPage(
  pages: readonly { state: string; response?: SafeResponse }[],
): { url: string; body: Buffer } | undefined {
  const page = pages.find(
    (candidate) =>
      candidate.state === "fetched" &&
      candidate.response !== undefined &&
      candidate.response.status >= 200 &&
      candidate.response.status < 300,
  );
  return page?.response === undefined
    ? undefined
    : { url: normalizeHttpUrl(page.response.finalUrl), body: page.response.body };
}

async function unavailableOriginProbes(
  config: AuditConfig,
  deps: RunAuditDeps,
  reason: string,
): Promise<Finding[]> {
  const origin = new URL(normalizeHttpUrl(config.url)).origin;
  return auditOriginProbes({
    origin,
    robots: { available: false },
    fetch: createBudgetedFetch(config, deps),
    unavailableReason: reason,
  });
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
  const result = auditTechnicalEligibility({
    targetUrl: url,
    transportError: { reason, message },
    robots: { url: safeRobotsUrl(url), available: false },
    sitemapDiscoveryAttempted: false,
  });
  appendContentFindings(result, url, undefined, `${reason}: ${message}`);
  return result;
}

function withPageContent(
  result: TechnicalAuditResult,
  url: string,
  body: Buffer | undefined,
  unavailableReason: string,
): TechnicalAuditResult {
  appendContentFindings(result, url, body, unavailableReason);
  return result;
}

function appendContentFindings(
  result: TechnicalAuditResult,
  url: string,
  body?: Buffer,
  unavailableReason?: string,
): void {
  const content = auditPageContent({
    url,
    ...(body === undefined ? {} : { body }),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  });
  result.findings.push(...content.findings);
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
