import { describe, expect, it, vi } from "vitest";
import { parseRobotsTxt } from "../src/discovery/robots.js";
import { auditOriginProbes, OriginProbeBudgetError } from "../src/rules/origin.js";
import { TransportError } from "../src/transport/errors.js";
import type { SafeResponse } from "../src/transport/safe-fetch.js";

const origin = "https://example.com";

function response(url: string, status: number, body = "", contentType = "text/plain"): SafeResponse {
  return {
    finalUrl: url,
    status,
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    rawBodyBytes: Buffer.byteLength(body),
    contentEncoding: undefined,
    redirects: [],
    resolvedIp: "203.0.113.1",
    ipFamily: 4,
  };
}

function robots(input = "User-agent: *\nAllow: /") {
  return { parsed: parseRobotsTxt(input), available: true };
}

describe("origin-scoped probes", () => {
  it("falls back to /.well-known/llms.txt and accepts a substantial plain-text document", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/llms.txt") && !url.includes(".well-known")) return response(url, 404, "missing");
      if (url.includes(".well-known")) return response(url, 200, "a".repeat(100), "text/markdown");
      return response(url, 404, "missing");
    });

    const findings = await auditOriginProbes({ origin, robots: robots(), fetch });

    expect(findings).toContainEqual(
      expect.objectContaining({
        id: "technical.llms_txt",
        result: "pass",
        subject_url: origin,
        evidence: expect.arrayContaining([expect.stringContaining("/.well-known/llms.txt")]),
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ id: "technical.not_found_status", result: "pass", severity: "info" }),
    );
  });

  it.each([
    { name: "Markdown with Vary", status: 200, contentType: "text/markdown", vary: "Accept", result: "pass" },
    { name: "Markdown without Vary", status: 200, contentType: "text/markdown", vary: undefined, result: "fail" },
    { name: "HTML", status: 200, contentType: "text/html", vary: "Accept", result: "fail" },
    { name: "4xx", status: 404, contentType: "text/html", vary: undefined, result: "fail" },
    { name: "5xx", status: 503, contentType: "text/plain", vary: undefined, result: "error" },
  ])("classifies Markdown negotiation: $name", async ({ status, contentType, vary, result }) => {
    const fetch = vi.fn(async (url: string, _allowedOrigin?: string, accept?: string) => {
      if (accept === "text/markdown") {
        const negotiated = response(url, status, "representation", contentType);
        if (vary !== undefined) negotiated.headers.vary = vary;
        return negotiated;
      }
      if (url.endsWith("/llms.txt")) return response(url, 200, "a".repeat(100));
      return response(url, 404, "missing");
    });

    const findings = await auditOriginProbes({
      origin,
      robots: robots(),
      fetch,
      primaryPageUrl: `${origin}/page`,
    });
    const markdown = findings.find((finding) => finding.id === "technical.markdown_negotiation");

    expect(markdown).toMatchObject({ result, score_impact: "experimental" });
    expect(fetch).toHaveBeenCalledWith(`${origin}/page`, origin, "text/markdown");
    if (contentType === "text/markdown" && vary === undefined) {
      expect(markdown).toMatchObject({ evidence: expect.arrayContaining([expect.stringContaining("Vary: missing")]) });
    }
  });

  it("fails app-shell llms.txt responses and soft 404s", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("geo-aeo-audit-not-found")) return response(url, 200, "not found", "text/html");
      return response(url, 200, `<html><body>${"a".repeat(150)}</body></html>`, "text/html");
    });

    const findings = await auditOriginProbes({ origin, robots: robots(), fetch });

    expect(findings).toContainEqual(expect.objectContaining({ id: "technical.llms_txt", result: "fail" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ id: "technical.not_found_status", result: "fail", severity: "warning" }),
    );
    expect(fetch.mock.calls.some(([url]) => String(url).includes("geo-aeo-audit-not-found-"))).toBe(true);
  });

  it("reports server and transport failures as errors without stopping sibling probes", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/llms.txt") && !url.includes(".well-known")) return response(url, 503, "unavailable");
      if (url.includes(".well-known")) return response(url, 404, "missing");
      throw new TransportError("timeout", "timed out");
    });

    const findings = await auditOriginProbes({ origin, robots: robots(), fetch });

    expect(findings).toContainEqual(expect.objectContaining({ id: "technical.llms_txt", result: "error" }));
    expect(findings).toContainEqual(expect.objectContaining({ id: "technical.not_found_status", result: "error" }));
  });

  it("does not request paths disallowed by robots.txt", async () => {
    const fetch = vi.fn();
    const findings = await auditOriginProbes({
      origin,
      robots: robots("User-agent: geo-aeo-audit\nDisallow: /"),
      fetch,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(findings.every((finding) => finding.result === "not_tested")).toBe(true);
  });

  it("returns not_tested when robots or the remaining byte budget is unavailable", async () => {
    const unavailableFetch = vi.fn();
    const unavailable = await auditOriginProbes({
      origin,
      robots: { available: false },
      fetch: unavailableFetch,
      unavailableReason: "robots.txt returned HTTP 503",
    });
    expect(unavailableFetch).not.toHaveBeenCalled();
    expect(unavailable.every((finding) => finding.result === "not_tested")).toBe(true);

    const exhausted = await auditOriginProbes({
      origin,
      robots: robots(),
      fetch: async () => {
        throw new OriginProbeBudgetError();
      },
    });
    expect(exhausted.every((finding) => finding.result === "not_tested")).toBe(true);
  });

  it("passes substantial trust pages discovered from Chinese link text", async () => {
    const fetch = vi.fn(async (url: string, _allowedOrigin?: string, accept?: string) => {
      if (accept === "text/markdown") return response(url, 200, "html", "text/html");
      if (url.endsWith("/llms.txt")) return response(url, 200, "a".repeat(100));
      if (url.includes("geo-aeo-audit-not-found")) return response(url, 404, "missing");
      return response(url, 200, `<main>${"信".repeat(500)}</main>`, "text/html");
    });
    const findings = await auditOriginProbes({
      origin,
      robots: robots(),
      fetch,
      primaryPageUrl: `${origin}/page`,
      primaryPageHtml: '<a href="/company">關於我們</a><a href="/support">聯絡我們</a><a href="/policy">隱私權</a>',
    });

    expect(findings).toContainEqual(
      expect.objectContaining({ id: "technical.trust_pages", result: "pass", subject_url: origin }),
    );
    for (const path of ["/company", "/support", "/policy"]) {
      expect(fetch.mock.calls.some(([url]) => url === `${origin}${path}`)).toBe(true);
    }
  });

  it("fails missing links and records cross-origin candidates without requesting them", async () => {
    const fetch = vi.fn(async (url: string, _allowedOrigin?: string, accept?: string) => {
      if (accept === "text/markdown") return response(url, 200, "html", "text/html");
      if (url.endsWith("/llms.txt")) return response(url, 200, "a".repeat(100));
      if (url.includes("geo-aeo-audit-not-found")) return response(url, 404, "missing");
      return response(url, 200, `<main>${"a".repeat(500)}</main>`, "text/html");
    });
    const findings = await auditOriginProbes({
      origin,
      robots: robots(),
      fetch,
      primaryPageUrl: `${origin}/page`,
      primaryPageHtml: '<a href="/about">About</a><a href="https://group.example/privacy">Privacy</a>',
    });
    const trust = findings.find((finding) => finding.id === "technical.trust_pages");

    expect(trust).toMatchObject({
      result: "fail",
      evidence: expect.arrayContaining([expect.stringContaining("https://group.example/privacy")]),
    });
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith("https://group.example"))).toBe(false);
  });

  it.each([
    { name: "404", status: 404, body: "missing", result: "fail" },
    { name: "5xx", status: 503, body: "unavailable", result: "error" },
    { name: "short content", status: 200, body: "short", result: "fail" },
  ])("classifies trust-page $name responses", async ({ status, body, result }) => {
    const fetch = vi.fn(async (url: string, _allowedOrigin?: string, accept?: string) => {
      if (accept === "text/markdown") return response(url, 200, "html", "text/html");
      if (url.endsWith("/llms.txt")) return response(url, 200, "a".repeat(100));
      if (url.includes("geo-aeo-audit-not-found")) return response(url, 404, "missing");
      if (url.endsWith("/about")) return response(url, status, `<main>${body}</main>`, "text/html");
      return response(url, 200, `<main>${"a".repeat(500)}</main>`, "text/html");
    });
    const findings = await auditOriginProbes({
      origin,
      robots: robots(),
      fetch,
      primaryPageUrl: `${origin}/page`,
      primaryPageHtml: '<a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a>',
    });

    expect(findings).toContainEqual(expect.objectContaining({ id: "technical.trust_pages", result }));
  });
});
