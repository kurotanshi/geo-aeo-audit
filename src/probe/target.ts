import { createRequire } from "node:module";
import { getDomain } from "tldts";
import { DEFAULT_LIMITS, type AuditLimits } from "../config.js";
import { CRAWLER_PRODUCT_TOKEN } from "../discovery/discover.js";
import { evaluateRobots, parseRobotsTxt } from "../discovery/robots.js";
import { normalizeHttpUrl } from "../discovery/url.js";
import { auditCanonical } from "../rules/technical.js";
import type {
  Availability,
  CitationTargetMatch,
  TargetAlias,
  TargetAliasProvenance,
  TargetObservation,
} from "../schema/probe.js";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../transport/safe-fetch.js";
import { USER_AGENT } from "../version.js";

const { version: TLDTS_VERSION } = createRequire(import.meta.url)("tldts/package.json") as { version: string };

export const PSL_METADATA: TargetObservation["public_suffix_list"] = {
  used: true,
  package_name: "tldts",
  package_version: TLDTS_VERSION,
  data_version: `bundled-with-tldts@${TLDTS_VERSION}`,
};

export type TargetFetch = (url: string, options: SafeFetchOptions) => Promise<SafeResponse>;

export async function observeTarget(
  rawUrl: string,
  options: { fetch?: TargetFetch; limits?: AuditLimits } = {},
): Promise<TargetObservation> {
  const requestedUrl = normalizeHttpUrl(rawUrl);
  const aliases = new Map<string, TargetAlias>();
  addAlias(aliases, requestedUrl, "input");
  const fetch = options.fetch ?? safeFetch;
  const limits = options.limits ?? DEFAULT_LIMITS;
  let page: SafeResponse;

  try {
    page = await fetch(requestedUrl, { limits, userAgent: USER_AGENT });
  } catch (error) {
    return observation(requestedUrl, aliases, unavailable(), unavailable(), "unavailable", [message(error)]);
  }

  const finalUrl = normalizeHttpUrl(page.finalUrl);
  addAlias(aliases, finalUrl, "final_redirect");
  const origin = new URL(finalUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  let robotsAllowed: boolean;
  try {
    const robots = await fetch(robotsUrl, { limits, userAgent: USER_AGENT, allowedOrigin: origin });
    if (robots.status >= 200 && robots.status < 300) {
      robotsAllowed = evaluateRobots(
        parseRobotsTxt(robots.body.toString("utf8")),
        finalUrl,
        CRAWLER_PRODUCT_TOKEN,
      ).allowed;
    } else if (robots.status >= 400 && robots.status < 500) {
      robotsAllowed = true;
    } else {
      return observation(requestedUrl, aliases, present(finalUrl), unavailable(), "unavailable", [
        `robots.txt returned HTTP ${robots.status}`,
      ]);
    }
  } catch (error) {
    return observation(requestedUrl, aliases, present(finalUrl), unavailable(), "unavailable", [message(error)]);
  }

  if (!robotsAllowed) {
    return observation(requestedUrl, aliases, present(finalUrl), { value: null, status: "not_used" }, "blocked", [
      "target canonical was not used because the generic crawler is blocked by robots.txt",
    ]);
  }

  if (page.status < 200 || page.status >= 300) {
    return observation(requestedUrl, aliases, present(finalUrl), unavailable(), "allowed", [
      `target returned HTTP ${page.status}; canonical was not used`,
    ]);
  }

  const canonical = auditCanonical(finalUrl, page.body.toString("utf8"), []);
  if (canonical !== undefined) addAlias(aliases, canonical, "declared_canonical");
  return observation(
    requestedUrl,
    aliases,
    present(finalUrl),
    canonical === undefined ? unavailable() : present(canonical),
    "allowed",
    canonical === undefined ? ["target did not expose one valid canonical URL"] : [],
  );
}

export function matchCitationTarget(citationUrl: string, target: TargetObservation): CitationTargetMatch | null {
  let normalized: string;
  try {
    normalized = normalizeHttpUrl(citationUrl);
  } catch {
    return null;
  }
  const exact = target.aliases.find((alias) => alias.url === normalized);
  if (exact !== undefined) {
    const levels = {
      input: "exact_input_url",
      final_redirect: "exact_final_url",
      declared_canonical: "target_declared_canonical",
    } as const;
    return { level: levels[exact.provenance], alias: exact.url, provenance: exact.provenance };
  }

  const url = new URL(normalized);
  const hostname = target.aliases.find((alias) => alias.hostname === url.hostname);
  if (hostname !== undefined) return match("same_hostname", hostname);
  const domain = registrableDomain(url.hostname);
  const domainAlias = target.aliases.find(
    (alias) => alias.registrable_domain.value !== null && alias.registrable_domain.value === domain,
  );
  return domainAlias === undefined ? null : match("same_registrable_domain", domainAlias);
}

export function registrableDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: true, validateHostname: true });
}

function addAlias(aliases: Map<string, TargetAlias>, url: string, provenance: TargetAliasProvenance): void {
  if (aliases.has(url)) return;
  const hostname = new URL(url).hostname;
  const domain = registrableDomain(hostname);
  aliases.set(url, {
    url,
    provenance,
    hostname,
    registrable_domain: domain === null ? unavailable() : present(domain),
  });
}

function observation(
  requestedUrl: string,
  aliases: Map<string, TargetAlias>,
  finalUrl: Availability<string>,
  canonical: Availability<string>,
  robots: TargetObservation["robots"],
  limitations: string[],
): TargetObservation {
  return {
    requested_url: requestedUrl,
    final_url: finalUrl,
    declared_canonical: canonical,
    robots,
    aliases: [...aliases.values()],
    limitations,
    public_suffix_list: PSL_METADATA,
  };
}

function present<T>(value: T): Availability<T> {
  return { value, status: "present" };
}

function unavailable<T>(): Availability<T> {
  return { value: null, status: "unavailable" };
}

function match(level: CitationTargetMatch["level"], alias: TargetAlias): CitationTargetMatch {
  return { level, alias: alias.url, provenance: alias.provenance };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
