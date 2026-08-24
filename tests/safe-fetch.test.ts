import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { safeFetch, type TransportDeps } from "../src/transport/safe-fetch.js";
import { TransportError } from "../src/transport/errors.js";
import { DEFAULT_LIMITS, type AuditLimits } from "../src/config.js";
import { startFixture, type Fixture } from "./fixtures/server.js";

// Loopback is non-public by default; loosen the address policy so the fixture
// server (127.0.0.1) is reachable. Production defaults remain fail-closed and
// are covered by the rejection tests below and by ip-guard.test.ts.
const allowLoopback: TransportDeps = { isPublic: () => true };

function limits(overrides: Partial<AuditLimits> = {}): AuditLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

async function expectReason(p: Promise<unknown>, reason: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ reason });
  await expect(p).rejects.toBeInstanceOf(TransportError);
}

describe("safeFetch happy path (fixture server)", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture();
  });
  afterAll(async () => {
    await fx.close();
  });

  it("fetches a page and returns the pinned IP", async () => {
    const res = await safeFetch(`${fx.origin}/`, { limits: limits(), deps: allowLoopback });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain("hello world");
    expect(res.resolvedIp).toBe("127.0.0.1");
    expect(res.ipFamily).toBe(4);
    expect(res.redirects).toHaveLength(0);
  });

  it("transparently decompresses gzip bodies", async () => {
    const res = await safeFetch(`${fx.origin}/gzip`, { limits: limits(), deps: allowLoopback });
    expect(res.body.toString()).toBe("gzipped body content");
    expect(res.contentEncoding).toBe("gzip");
  });

  it("follows redirects within budget", async () => {
    const res = await safeFetch(`${fx.origin}/redirect-once`, { limits: limits(), deps: allowLoopback });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`${fx.origin}/`);
    expect(res.redirects).toHaveLength(1);
  });

  it("resolves the hostname once per hop (no re-resolution / rebinding window)", async () => {
    let calls = 0;
    const deps: TransportDeps = {
      isPublic: () => true,
      resolve: async () => {
        calls += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    };
    const res = await safeFetch(`${fx.origin}/`, { limits: limits(), deps });
    expect(res.status).toBe(200);
    expect(calls).toBe(1); // pinned; the OS never re-resolves at connect time
  });
});

describe("safeFetch fail-closed rejections", () => {
  it("rejects a non-public resolved address (default guard)", async () => {
    const deps: TransportDeps = { resolve: async () => [{ address: "10.0.0.1", family: 4 }] };
    await expectReason(safeFetch("http://internal.example", { limits: limits(), deps }), "non_public_address");
  });

  it("rejects when ANY address is non-public (mixed results)", async () => {
    const deps: TransportDeps = {
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    };
    await expectReason(safeFetch("http://mixed.example", { limits: limits(), deps }), "non_public_address");
  });

  it("rejects an IPv4-mapped IPv6 address", async () => {
    const deps: TransportDeps = { resolve: async () => [{ address: "::ffff:8.8.8.8", family: 6 }] };
    await expectReason(safeFetch("http://mapped.example", { limits: limits(), deps }), "non_public_address");
  });

  it("rejects a URL with embedded credentials before any connection", async () => {
    let resolved = false;
    const deps: TransportDeps = {
      resolve: async () => {
        resolved = true;
        return [{ address: "8.8.8.8", family: 4 }];
      },
    };
    await expectReason(safeFetch("http://user:pass@example.com/", { limits: limits(), deps }), "credentials_in_url");
    expect(resolved).toBe(false);
  });

  it("rejects a non-http(s) scheme", async () => {
    await expectReason(safeFetch("ftp://example.com/", { limits: limits() }), "invalid_url");
  });

  it("maps DNS failure to dns_failure", async () => {
    const deps: TransportDeps = {
      resolve: async () => {
        throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
      },
    };
    await expectReason(safeFetch("http://nope.example/", { limits: limits(), deps }), "dns_failure");
  });
});

describe("safeFetch limit enforcement (fixture server)", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture();
  });
  afterAll(async () => {
    await fx.close();
  });

  it("rejects a non-HTTP(S) redirect target without following it", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/ftp-redirect`, { limits: limits(), deps: allowLoopback }),
      "non_http_redirect",
    );
  });

  it("rejects an out-of-scope redirect before resolving its target", async () => {
    let outsideResolved = false;
    const deps: TransportDeps = {
      isPublic: () => true,
      resolve: async (hostname) => {
        if (hostname === "outside.example") outsideResolved = true;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    };
    await expectReason(
      safeFetch(`${fx.origin}/cross-origin-redirect`, { limits: limits(), deps, allowedOrigin: fx.origin }),
      "out_of_scope",
    );
    expect(outsideResolved).toBe(false);
  });

  it("rejects a redirect loop", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/loop`, { limits: limits({ maxRedirects: 10 }), deps: allowLoopback }),
      "redirect_loop",
    );
  });

  it("rejects when the redirect budget is exceeded", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/chain?n=5`, { limits: limits({ maxRedirects: 2 }), deps: allowLoopback }),
      "redirect_limit",
    );
  });

  it("rejects oversized response headers", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/bigheader`, { limits: limits({ maxHeaderBytes: 4_096 }), deps: allowLoopback }),
      "header_too_large",
    );
  });

  it("rejects an oversized (compressed) body", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/bigbody`, { limits: limits({ maxResponseBytes: 1_000 }), deps: allowLoopback }),
      "response_too_large",
    );
  });

  it("rejects a decompression bomb", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/biggzip`, {
        limits: limits({ maxResponseBytes: 1_000_000, maxDecompressedBytes: 1_000 }),
        deps: allowLoopback,
      }),
      "decompressed_too_large",
    );
  });

  it("times out a slow response", async () => {
    await expectReason(
      safeFetch(`${fx.origin}/slow`, { limits: limits({ timeoutMs: 150 }), deps: allowLoopback }),
      "timeout",
    );
  });
});
