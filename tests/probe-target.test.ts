import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/config.js";
import { providerRequest, type ProbeConfig } from "../src/probe/config.js";
import { matchCitationTarget, observeTarget } from "../src/probe/target.js";
import type { ProbeProvider, ProviderRequest } from "../src/schema/probe.js";
import type { SafeResponse } from "../src/transport/safe-fetch.js";

const REQUESTED = "https://www.example.co.uk/start";
const FINAL = "https://www.example.co.uk/final";
const CANONICAL = "https://example.co.uk/canonical";

function response(finalUrl: string, body: string, status = 200): SafeResponse {
  return {
    finalUrl,
    status,
    headers: {},
    body: Buffer.from(body),
    rawBodyBytes: Buffer.byteLength(body),
    contentEncoding: undefined,
    redirects: [],
    resolvedIp: "203.0.113.1",
    ipFamily: 4,
  };
}

describe("probe target observation and matching", () => {
  it("builds provenance aliases and selects the most precise citation match", async () => {
    const target = await observeTarget(REQUESTED, {
      limits: DEFAULT_LIMITS,
      fetch: async (url) =>
        url.endsWith("/robots.txt")
          ? response(url, "User-agent: *\nAllow: /\n")
          : response(FINAL, `<html><head><link rel="canonical" href="${CANONICAL}"></head></html>`),
    });

    expect(target.aliases.map(({ url, provenance }) => ({ url, provenance }))).toEqual([
      { url: REQUESTED, provenance: "input" },
      { url: FINAL, provenance: "final_redirect" },
      { url: CANONICAL, provenance: "declared_canonical" },
    ]);
    expect(target.public_suffix_list).toMatchObject({ used: true, package_name: "tldts" });
    expect(matchCitationTarget(CANONICAL, target)).toMatchObject({ level: "target_declared_canonical" });
    expect(matchCitationTarget("https://www.example.co.uk/other", target)).toMatchObject({ level: "same_hostname" });
    expect(matchCitationTarget("https://blog.example.co.uk/post", target)).toMatchObject({
      level: "same_registrable_domain",
    });
  });

  it("does not use canonical data when robots blocks the generic crawler", async () => {
    const target = await observeTarget(REQUESTED, {
      fetch: async (url) =>
        url.endsWith("/robots.txt")
          ? response(url, "User-agent: *\nDisallow: /\n")
          : response(FINAL, `<link rel="canonical" href="${CANONICAL}">`),
    });

    expect(target.robots).toBe("blocked");
    expect(target.declared_canonical.status).toBe("not_used");
    expect(target.aliases).toHaveLength(2);
  });

  it("does not trust canonical markup from an unsuccessful target response", async () => {
    const target = await observeTarget(REQUESTED, {
      fetch: async (url) =>
        url.endsWith("/robots.txt")
          ? response(url, "User-agent: *\nAllow: /\n")
          : response(FINAL, `<link rel="canonical" href="${CANONICAL}">`, 404),
    });

    expect(target.declared_canonical.status).toBe("unavailable");
    expect(target.aliases.some((alias) => alias.provenance === "declared_canonical")).toBe(false);
  });

  it("keeps target identifiers out of the mock provider request", async () => {
    const config: ProbeConfig = {
      url: REQUESTED,
      provider: "openai",
      model: "test-model",
      prompts: ["What is Example?"],
      repeats: 1,
      search: {},
    };
    let received: ProviderRequest | undefined;
    const provider: ProbeProvider = {
      name: "openai",
      adapterVersion: "test",
      apiSurface: "test",
      invoke: async (request) => {
        received = request;
        throw new Error("fixture stop");
      },
    };

    await expect(
      provider.invoke(providerRequest(config, config.prompts[0]!), {
        apiKey: "test",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("fixture stop");
    expect(JSON.stringify(received)).not.toContain("example.co.uk");
  });
});
