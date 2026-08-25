import { createHash } from "node:crypto";
import type { AuditLimits } from "../config.js";
import { USER_AGENT } from "../version.js";
import {
  safeFetch,
  type SafeResponse,
  type TransportDeps,
} from "../transport/safe-fetch.js";
import { evaluateRobots, parseRobotsTxt, type ParsedRobots, type RobotsRule } from "./robots.js";
import { parseSitemapXml } from "./sitemap.js";
import { normalizeHttpUrl, URL_NORMALIZATION_VERSION } from "./url.js";

export const SAMPLING_HASH_ALGORITHM = "sha256";
export const DEFAULT_SAMPLING_SEED = "geo-aeo-audit-v1";
export const CRAWLER_PRODUCT_TOKEN = "geo-aeo-audit";

export type DiscoveryFetch = (
  url: string,
  options: {
    limits: AuditLimits;
    userAgent?: string;
    accept?: string;
    deps?: TransportDeps;
    allowedOrigin?: string;
  },
) => Promise<SafeResponse>;

export interface DiscoveredOutsideScope {
  url: string;
  source: string;
  state: "discovered_but_out_of_scope";
}

export interface InvalidDiscoveredUrl {
  url: string;
  source: string;
  state: "invalid_url";
  reason: string;
}

export interface SampledPage {
  url: string;
  hash: string;
  source: string;
  state: "fetched" | "skipped_by_robots" | "skipped_due_to_robots_unavailable" | "fetch_error";
  robotsRule?: RobotsRule;
  response?: SafeResponse;
  error?: string;
}

export interface SitemapVisit {
  url: string;
  depth: number;
  state: "fetched" | "fetch_error" | "invalid_sitemap" | "depth_limit" | "out_of_scope";
  kind?: "urlset" | "index";
  error?: string;
}

export interface SiteDiscoveryResult {
  requestedUrl: string;
  finalUrl: string;
  origin: string;
  robots: {
    url: string;
    status?: number;
    parsed: ParsedRobots;
    error?: string;
  };
  sitemaps: SitemapVisit[];
  pages: SampledPage[];
  /** Unique, normalized, in-scope URLs observed specifically in sitemap urlsets. */
  sitemapUrls: string[];
  outOfScope: DiscoveredOutsideScope[];
  invalidUrls: InvalidDiscoveredUrl[];
  sampling: {
    method: "stable-hash";
    hashAlgorithm: "sha256";
    seed: string;
    normalizationVersion: string;
    discovered: number;
    inScope: number;
    syntacticallyValid: number;
    unique: number;
    sampled: number;
  };
  resources: {
    downloadedBytes: number;
    maxTotalBytes: number;
    sitemapCount: number;
    maxSitemaps: number;
    concurrency: number;
  };
  warnings: string[];
}

export interface DiscoverSiteOptions {
  limits: AuditLimits;
  seed?: string;
  fetch?: DiscoveryFetch;
  transportDeps?: TransportDeps;
  userAgent?: string;
}

interface Candidate {
  url: string;
  source: string;
}

interface SitemapQueueItem {
  url: string;
  depth: number;
}

/**
 * Discover and sample pages within the final origin of an entry URL.
 *
 * The pipeline is deliberately ordered: discover, classify scope, validate,
 * de-duplicate, stable-hash sample, apply robots, then fetch allowed samples.
 */
export async function discoverSite(requestedUrl: string, options: DiscoverSiteOptions): Promise<SiteDiscoveryResult> {
  const fetcher = new ByteBudgetFetcher(
    options.fetch ?? safeFetch,
    options.limits,
    options.transportDeps,
    options.userAgent ?? USER_AGENT,
  );
  const warnings: string[] = [];

  // This request establishes the redirect-derived origin. It can be reused if
  // the entry URL is selected later, avoiding a duplicate page fetch.
  const entryResponse = await fetcher.fetch(normalizeHttpUrl(requestedUrl));
  const finalUrl = normalizeHttpUrl(entryResponse.finalUrl);
  const origin = new URL(finalUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();

  let robots = parseRobotsTxt("");
  let robotsStatus: number | undefined;
  let robotsError: string | undefined;
  let robotsUnavailable = false;
  try {
    const response = await fetcher.fetch(robotsUrl, origin);
    robotsStatus = response.status;
    if (response.status >= 200 && response.status < 300) {
      robots = parseRobotsTxt(response.body.toString("utf8"));
    } else if (response.status >= 500) {
      robotsUnavailable = true;
      robotsError = `robots.txt returned HTTP ${response.status}`;
      warnings.push(`robots_fetch_error: ${robotsError}`);
    }
  } catch (error) {
    robotsUnavailable = true;
    robotsError = errorMessage(error);
    warnings.push(`robots_fetch_error: ${robotsError}`);
  }

  const sitemaps: SitemapVisit[] = [];
  let sitemapFetchCount = 0;
  const outOfScope: DiscoveredOutsideScope[] = [];
  const invalidUrls: InvalidDiscoveredUrl[] = [];
  const candidates = new Map<string, Candidate>();
  const sitemapPageUrls = new Set<string>();
  let discovered = 0;
  let inScope = 0;
  let syntacticallyValid = 0;

  addPageCandidate(finalUrl, "entrypoint");

  const sitemapQueue: SitemapQueueItem[] = [];
  const queuedSitemaps = new Set<string>();
  for (const raw of [...robots.sitemaps, new URL("/sitemap.xml", origin).toString()]) {
    enqueueSitemap(raw, 0, robotsUrl);
  }

  while (sitemapQueue.length > 0) {
    if (sitemapFetchCount >= options.limits.maxSitemaps) {
      warnings.push(`sitemap_limit_reached: ${options.limits.maxSitemaps}`);
      break;
    }
    const item = sitemapQueue.shift()!;
    sitemapFetchCount += 1;
    let response: SafeResponse;
    try {
      response = await fetcher.fetch(item.url, origin);
    } catch (error) {
      sitemaps.push({ url: item.url, depth: item.depth, state: "fetch_error", error: errorMessage(error) });
      continue;
    }

    let document;
    try {
      document = parseSitemapXml(response.body.toString("utf8"));
    } catch (error) {
      sitemaps.push({ url: item.url, depth: item.depth, state: "invalid_sitemap", error: errorMessage(error) });
      continue;
    }
    sitemaps.push({ url: item.url, depth: item.depth, state: "fetched", kind: document.kind });

    if (document.kind === "index") {
      for (const location of document.locations) {
        if (item.depth >= options.limits.maxSitemapDepth) {
          sitemaps.push({
            url: location,
            depth: item.depth + 1,
            state: "depth_limit",
            error: `maximum sitemap depth is ${options.limits.maxSitemapDepth}`,
          });
          continue;
        }
        enqueueSitemap(location, item.depth + 1, item.url);
      }
    } else {
      for (const location of document.locations) addPageCandidate(location, item.url);
    }
  }

  const seed = options.seed ?? DEFAULT_SAMPLING_SEED;
  const ranked = [...candidates.values()]
    .map((candidate) => ({ ...candidate, hash: stableHash(candidate.url, seed) }))
    .sort((a, b) => a.hash.localeCompare(b.hash) || a.url.localeCompare(b.url));
  const selected = ranked.slice(0, options.limits.maxPages);

  const pages = await mapWithConcurrency(selected, options.limits.concurrency, async (candidate): Promise<SampledPage> => {
    // RFC 9309 treats server/network failures as unreachable. Do not crawl
    // sampled content until robots policy can be determined.
    if (robotsUnavailable) {
      return {
        url: candidate.url,
        hash: candidate.hash,
        source: candidate.source,
        state: "skipped_due_to_robots_unavailable",
        error: robotsError ?? "robots.txt is unavailable",
      };
    }
    const decision = evaluateRobots(robots, candidate.url, CRAWLER_PRODUCT_TOKEN);
    if (!decision.allowed) {
      return {
        url: candidate.url,
        hash: candidate.hash,
        source: candidate.source,
        state: "skipped_by_robots",
        ...(decision.matchedRule === undefined ? {} : { robotsRule: decision.matchedRule }),
      };
    }

    if (candidate.url === finalUrl) {
      return { url: candidate.url, hash: candidate.hash, source: candidate.source, state: "fetched", response: entryResponse };
    }
    try {
      const response = await fetcher.fetch(candidate.url, origin);
      return { url: candidate.url, hash: candidate.hash, source: candidate.source, state: "fetched", response };
    } catch (error) {
      return {
        url: candidate.url,
        hash: candidate.hash,
        source: candidate.source,
        state: "fetch_error",
        error: errorMessage(error),
      };
    }
  });

  return {
    requestedUrl: normalizeHttpUrl(requestedUrl),
    finalUrl,
    origin,
    robots: {
      url: robotsUrl,
      ...(robotsStatus === undefined ? {} : { status: robotsStatus }),
      parsed: robots,
      ...(robotsError === undefined ? {} : { error: robotsError }),
    },
    sitemaps,
    pages,
    sitemapUrls: [...sitemapPageUrls].sort(),
    outOfScope,
    invalidUrls,
    sampling: {
      method: "stable-hash",
      hashAlgorithm: SAMPLING_HASH_ALGORITHM,
      seed,
      normalizationVersion: URL_NORMALIZATION_VERSION,
      discovered,
      inScope,
      syntacticallyValid,
      unique: candidates.size,
      sampled: selected.length,
    },
    resources: {
      downloadedBytes: fetcher.usedBytes,
      maxTotalBytes: options.limits.maxTotalBytes,
      sitemapCount: sitemapFetchCount,
      maxSitemaps: options.limits.maxSitemaps,
      concurrency: options.limits.concurrency,
    },
    warnings,
  };

  function addPageCandidate(raw: string, source: string): void {
    discovered += 1;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch (error) {
      invalidUrls.push({ url: raw, source, state: "invalid_url", reason: errorMessage(error) });
      return;
    }
    if (parsed.origin !== origin) {
      outOfScope.push({ url: raw, source, state: "discovered_but_out_of_scope" });
      return;
    }
    inScope += 1;
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(raw);
    } catch (error) {
      invalidUrls.push({ url: raw, source, state: "invalid_url", reason: errorMessage(error) });
      return;
    }
    syntacticallyValid += 1;
    if (source !== "entrypoint") sitemapPageUrls.add(normalized);
    if (!candidates.has(normalized)) candidates.set(normalized, { url: normalized, source });
  }

  function enqueueSitemap(raw: string, depth: number, source: string): void {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(raw, source);
    } catch (error) {
      sitemaps.push({ url: raw, depth, state: "invalid_sitemap", error: errorMessage(error) });
      return;
    }
    if (new URL(normalized).origin !== origin) {
      sitemaps.push({ url: normalized, depth, state: "out_of_scope" });
      return;
    }
    if (!queuedSitemaps.has(normalized)) {
      queuedSitemaps.add(normalized);
      sitemapQueue.push({ url: normalized, depth });
    }
  }
}

function stableHash(url: string, seed: string): string {
  return createHash("sha256").update(seed).update("\0").update(url).digest("hex");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, visit: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("concurrency must be at least 1");
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await visit(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Reserve wire-byte capacity before each request so concurrent responses cannot exceed the total cap. */
class ByteBudgetFetcher {
  usedBytes = 0;
  private reservedBytes = 0;
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly fetchImpl: DiscoveryFetch,
    private readonly limits: AuditLimits,
    private readonly deps: TransportDeps | undefined,
    private readonly userAgent: string,
  ) {}

  async fetch(url: string, allowedOrigin?: string): Promise<SafeResponse> {
    const reservation = await this.reserve();
    try {
      const response = await this.fetchImpl(url, {
        limits: { ...this.limits, maxResponseBytes: reservation },
        userAgent: this.userAgent,
        ...(this.deps === undefined ? {} : { deps: this.deps }),
        ...(allowedOrigin === undefined ? {} : { allowedOrigin }),
      });
      if (response.rawBodyBytes > reservation) {
        throw new RangeError(`fetch returned ${response.rawBodyBytes} raw bytes above its ${reservation}-byte cap`);
      }
      this.usedBytes += response.rawBodyBytes;
      return response;
    } finally {
      this.reservedBytes -= reservation;
      this.active -= 1;
      const waiters = this.waiters;
      this.waiters = [];
      for (const wake of waiters) wake();
    }
  }

  private async reserve(): Promise<number> {
    for (;;) {
      const available = this.limits.maxTotalBytes - this.usedBytes - this.reservedBytes;
      if (available > 0) {
        const amount = Math.min(this.limits.maxResponseBytes, available);
        this.reservedBytes += amount;
        this.active += 1;
        return amount;
      }
      if (this.active === 0) throw new RangeError(`total download limit reached: ${this.limits.maxTotalBytes} bytes`);
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
