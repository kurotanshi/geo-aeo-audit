import { describe, expect, it, vi } from "vitest";
import { OraClientError, fetchOraReport } from "../src/ora/client.js";
import type { OraConfig } from "../src/ora/config.js";
import { runOra } from "../src/ora/run.js";

function config(overrides: Partial<OraConfig> = {}): OraConfig {
  return {
    url: "https://example.com/path",
    hostname: "example.com",
    mode: "cached",
    output: { json: true },
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.21.0",
    score: 72,
    grade: "B",
    scannedAt: "2026-08-25T00:00:00.000Z",
    analysisStatus: "complete",
    pendingChecks: [],
    layers: [{ id: "discovery", score: 12 }],
    topFixes: [{ id: "second" }, { id: "first" }],
    essentials: { checks: { "metadata-completeness": {}, "new-check": {} } },
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function mockFetch(implementation: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    implementation(String(input), init ?? {})) as unknown as typeof fetch;
}

describe("Ora client", () => {
  it("reads the fixed cached endpoint without contacting the target or sending credentials", async () => {
    const fetch = mockFetch(async (url, init) => {
      expect(url).toBe("https://ora.ai/api/score/example.com?include=essentials&format=audit");
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      const headers = new Headers(init.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("x-api-key")).toBe(false);
      return jsonResponse(payload(), 200, { age: "60", "x-vercel-cache": "HIT" });
    });

    const result = await fetchOraReport(config(), { fetch });

    expect(result).toMatchObject({ polls: 0, httpStatus: 200, cache: { age: "60", xVercelCache: "HIT" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("encodes the hostname as one path segment", async () => {
    const fetch = mockFetch(async (url) => {
      expect(url).toContain("/api/score/%5B%3A%3A1%5D?");
      return jsonResponse(payload());
    });
    await fetchOraReport(config({ url: "http://[::1]/path", hostname: "[::1]" }), { fetch });
  });

  it("preserves Ora payload order and builds mapped and unmapped crosswalk rows", async () => {
    const result = await runOra(config(), {
      fetch: mockFetch(async () => jsonResponse(payload())),
      generatedAt: () => new Date("2026-08-25T01:00:00.000Z"),
    });

    expect(result.generated_at).toBe("2026-08-25T01:00:00.000Z");
    expect(result.ora.topFixes).toEqual([{ id: "second" }, { id: "first" }]);
    expect(result.crosswalk).toContainEqual(expect.objectContaining({ ora_id: "metadata-completeness", mapping: "composite" }));
    expect(result.crosswalk).toContainEqual({
      ora_id: "new-check",
      mapping: "unmapped",
      local_rule_ids: [],
      explanation: "No local crosswalk entry exists for this Ora check id.",
    });
  });

  it.each([
    { status: 404, headers: {}, code: "not_found", message: "--scan" },
    { status: 429, headers: { "retry-after": "17" }, code: "rate_limited", message: "17 seconds" },
    { status: 503, headers: {}, code: "invalid_response", message: "HTTP 503" },
  ])("fails closed for HTTP $status", async ({ status, headers, code, message }) => {
    const promise = fetchOraReport(config(), { fetch: mockFetch(async () => new Response("", { status, headers })) });
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.toThrow(message);
  });

  it("rejects non-JSON, oversized, redirected, and incomplete responses", async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => new Response("not json", { status: 200 }),
      async () => new Response(JSON.stringify({ value: "a".repeat(2 * 1024 * 1024) }), { status: 200 }),
      async () => { throw new TypeError("redirect mode is set to error"); },
      async () => jsonResponse({ contractVersion: "1.21.0" }),
    ];
    for (const makeResponse of cases) {
      await expect(fetchOraReport(config(), { fetch: mockFetch(async () => makeResponse()) })).rejects.toBeInstanceOf(OraClientError);
    }
  });

  it.each([
    { location: undefined, label: "missing" },
    { location: "https://user:pass@ora.ai/api/scan/1", label: "credentials" },
    { location: "https://outside.example/api/scan/1", label: "other origin" },
  ])("rejects $label polling Location", async ({ location }) => {
    const headers = location === undefined ? {} : { location };
    await expect(fetchOraReport(config({ mode: "scan" }), {
      fetch: mockFetch(async () => jsonResponse({ analysisStatus: "partial" }, 202, headers)),
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("polls a scan Location until the third GET completes without resending POST", async () => {
    const calls: { url: string; method: string }[] = [];
    let polls = 0;
    const fetch = mockFetch(async (url, init) => {
      calls.push({ url, method: String(init.method) });
      if (init.method === "POST") return jsonResponse({ analysisStatus: "partial" }, 202, { location: "/api/scan/jobs/1" });
      polls += 1;
      return polls === 3
        ? jsonResponse(payload())
        : jsonResponse({ analysisStatus: "partial" }, 202, { location: "/api/scan/jobs/1" });
    });

    const result = await fetchOraReport(config({ mode: "scan" }), { fetch, sleep: async () => {} });

    expect(result).toMatchObject({ polls: 3, httpStatus: 200 });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(3);
    expect(calls.slice(1).every((call) => call.url === "https://ora.ai/api/scan/jobs/1")).toBe(true);
  });

  it("returns a partial result when the poll-count or overall deadline wins", async () => {
    const alwaysPending = mockFetch(async () =>
      jsonResponse({ analysisStatus: "partial", essentials: { checks: {} } }, 202, { location: "/api/scan/jobs/1" }));
    const byCount = await fetchOraReport(config({ mode: "scan" }), {
      fetch: alwaysPending,
      now: () => 0,
      sleep: async () => {},
    });
    expect(byCount).toMatchObject({ polls: 15, httpStatus: 202, payload: { analysisStatus: "partial" } });

    let clock = 0;
    const byDeadline = await fetchOraReport(config({ mode: "scan" }), {
      fetch: alwaysPending,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    });
    expect(byDeadline.polls).toBeLessThan(15);
    expect(byDeadline.payload.analysisStatus).toBe("partial");
  });
});
