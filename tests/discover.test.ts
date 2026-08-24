import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, type AuditLimits } from "../src/config.js";
import { discoverSite } from "../src/discovery/discover.js";
import type { TransportDeps } from "../src/transport/safe-fetch.js";
import { startFixture, type Fixture } from "./fixtures/server.js";

const allowLoopback: TransportDeps = { isPublic: () => true };

function limits(overrides: Partial<AuditLimits> = {}): AuditLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

describe("origin-scoped site discovery", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await startFixture();
  });

  afterAll(async () => {
    await fx.close();
  });

  it("recurses sitemaps, de-duplicates, samples deterministically and obeys robots", async () => {
    const result = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxPages: 20, concurrency: 2 }),
      transportDeps: allowLoopback,
      seed: "fixed-test-seed",
    });

    expect(result.origin).toBe(fx.origin);
    expect(result.sampling.method).toBe("stable-hash");
    expect(result.sampling.hashAlgorithm).toBe("sha256");
    expect(result.sampling.seed).toBe("fixed-test-seed");
    expect(result.sampling.unique).toBe(5);

    expect(result.outOfScope).toContainEqual(
      expect.objectContaining({ url: "https://outside.example/page", state: "discovered_but_out_of_scope" }),
    );
    expect(result.invalidUrls).toContainEqual(expect.objectContaining({ url: "not a URL", state: "invalid_url" }));
    expect(result.sitemaps).toContainEqual(
      expect.objectContaining({ url: "https://outside.example/sitemap.xml", state: "out_of_scope" }),
    );

    const blocked = result.pages.find((page) => page.url === `${fx.origin}/private`);
    expect(blocked).toMatchObject({ state: "skipped_by_robots", robotsRule: { directive: "disallow" } });
    expect(fx.requests).not.toContain("/private");
    expect(result.pages.find((page) => page.url === `${fx.origin}/private/public`)).toMatchObject({ state: "fetched" });
    expect(result.pages.find((page) => page.url === `${fx.origin}/public-b?x=1&y=2`)).toMatchObject({ state: "fetched" });
    expect(fx.maxConcurrentRequests()).toBeLessThanOrEqual(2);
    expect(result.resources.downloadedBytes).toBeGreaterThan(0);
    expect(result.resources.downloadedBytes).toBeLessThanOrEqual(result.resources.maxTotalBytes);
  });

  it("produces identical stable-hash ordering for the same seed", async () => {
    const first = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxPages: 3 }),
      transportDeps: allowLoopback,
      seed: "repeatable",
    });
    const second = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxPages: 3 }),
      transportDeps: allowLoopback,
      seed: "repeatable",
    });
    expect(first.pages.map(({ url, hash }) => ({ url, hash }))).toEqual(
      second.pages.map(({ url, hash }) => ({ url, hash })),
    );
  });

  it("does not fetch nested sitemap documents above the depth limit", async () => {
    const before = fx.requests.length;
    const result = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxSitemapDepth: 0 }),
      transportDeps: allowLoopback,
    });
    const requests = fx.requests.slice(before);
    expect(requests).not.toContain("/sitemap-a.xml");
    expect(requests).not.toContain("/sitemap-b.xml");
    expect(result.sitemaps.filter((visit) => visit.state === "depth_limit")).toHaveLength(3);
  });

  it("stops scheduling sitemap requests at the sitemap count limit", async () => {
    const before = fx.requests.length;
    const result = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxSitemaps: 1 }),
      transportDeps: allowLoopback,
    });
    const requests = fx.requests.slice(before);
    expect(result.resources.sitemapCount).toBe(1);
    expect(result.warnings).toContain("sitemap_limit_reached: 1");
    expect(requests).toContain("/sitemap-index.xml");
    expect(requests).not.toContain("/sitemap.xml");
    expect(requests).not.toContain("/sitemap-a.xml");
  });

  it("does not commit successful downloads above the total byte limit", async () => {
    const result = await discoverSite(`${fx.origin}/site-entry`, {
      limits: limits({ maxTotalBytes: 40 }),
      transportDeps: allowLoopback,
    });
    expect(result.resources.downloadedBytes).toBeLessThanOrEqual(40);
    expect(result.warnings.some((warning) => warning.startsWith("robots_fetch_error:"))).toBe(true);
  });
});
