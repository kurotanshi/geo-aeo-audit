import { describe, expect, it } from "vitest";
import { evaluateRobots, parseRobotsTxt } from "../src/discovery/robots.js";
import { parseSitemapXml } from "../src/discovery/sitemap.js";
import { normalizeHttpUrl } from "../src/discovery/url.js";

describe("URL normalization", () => {
  it("normalizes only conservative URL components", () => {
    expect(normalizeHttpUrl("HTTPS://Example.COM:443#part")).toBe("https://example.com/");
    expect(normalizeHttpUrl("https://example.com/path?utm_source=x#part")).toBe(
      "https://example.com/path?utm_source=x",
    );
  });

  it("rejects credentials and non-HTTP schemes", () => {
    expect(() => normalizeHttpUrl("https://user:pass@example.com/")).toThrow();
    expect(() => normalizeHttpUrl("ftp://example.com/")).toThrow();
  });
});

describe("robots.txt", () => {
  it("selects the most specific agent and longest path rule", () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /

      User-agent: geo-aeo-audit
      Disallow: /private
      Allow: /private/public
      Sitemap: https://example.com/sitemap.xml
    `);
    expect(evaluateRobots(robots, "https://example.com/private/page", "geo-aeo-audit").allowed).toBe(false);
    expect(evaluateRobots(robots, "https://example.com/private/public/page", "geo-aeo-audit").allowed).toBe(true);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("supports wildcards, end anchors and Allow winning equal-length ties", () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /*.pdf$
      Disallow: /same
      Allow: /same
    `);
    expect(evaluateRobots(robots, "https://example.com/file.pdf", "geo-aeo-audit").allowed).toBe(false);
    expect(evaluateRobots(robots, "https://example.com/file.pdf?download=1", "geo-aeo-audit").allowed).toBe(true);
    expect(evaluateRobots(robots, "https://example.com/same", "geo-aeo-audit").allowed).toBe(true);
  });
});

describe("sitemap XML", () => {
  it("parses urlsets, namespaces, CDATA and XML entities", () => {
    const sitemap = parseSitemapXml(`
      <sm:urlset xmlns:sm="urn:test">
        <sm:url><sm:loc>https://example.com/a?x=1&amp;y=2</sm:loc></sm:url>
        <sm:url><sm:loc><![CDATA[https://example.com/b?x=1&y=2]]></sm:loc></sm:url>
      </sm:urlset>
    `);
    expect(sitemap).toEqual({
      kind: "urlset",
      locations: ["https://example.com/a?x=1&y=2", "https://example.com/b?x=1&y=2"],
    });
  });

  it("rejects non-sitemap documents", () => {
    expect(() => parseSitemapXml("<html></html>")).toThrow();
  });
});
