import { describe, it, expect } from "vitest";
import { ExitCode, resolveExitCode } from "../src/exit.js";
import type { AuditResult, Blocker, BlockerKind } from "../src/schema/result.js";

function blocker(kind: BlockerKind): Blocker {
  return {
    kind,
    rule_id: "test.blocker",
    evidence: [],
    applies_to: [],
    not_asserted_for: [],
  };
}

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    schema_version: "1.1.0",
    tool_version: "0.1.0",
    ruleset_version: "0.1.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    target: {
      requested_url: "https://example.com/",
      normalized_url: "https://example.com/",
      mode: "page",
    },
    metadata: {
      url_normalization: { version: "conservative-v1" },
      sampling: {
        applied: false,
        method: "stable-hash",
        hash_algorithm: "sha256",
        seed: "geo-aeo-audit-v1",
        selected: [],
      },
      public_suffix_list: {
        used: false,
        package_name: null,
        package_version: null,
        data_version: null,
        scope_basis: "origin",
      },
      limits: {
        timeoutMs: 15_000,
        maxRedirects: 5,
        maxPages: 25,
        maxHeaderBytes: 32_768,
        maxResponseBytes: 5_000_000,
        maxDecompressedBytes: 20_000_000,
        maxTotalBytes: 100_000_000,
        maxSitemaps: 50,
        maxSitemapDepth: 5,
        concurrency: 4,
      },
    },
    findings: [],
    scorecards: [],
    blockers: [],
    ...overrides,
  };
}

describe("resolveExitCode", () => {
  it("returns SUCCESS for a clean result on any fail-on mode", () => {
    const clean = makeResult();
    expect(resolveExitCode(clean, "never")).toBe(ExitCode.SUCCESS);
    expect(resolveExitCode(clean, "blocker")).toBe(ExitCode.SUCCESS);
    expect(resolveExitCode(clean, "error")).toBe(ExitCode.SUCCESS);
  });

  it("never trips the threshold under fail-on=never even with blockers", () => {
    const withBlocker = makeResult({ blockers: [blocker("transport_or_protocol")] });
    expect(resolveExitCode(withBlocker, "never")).toBe(ExitCode.SUCCESS);
  });

  it("trips FAIL_THRESHOLD on a blocker under fail-on=blocker", () => {
    const withBlocker = makeResult({ blockers: [blocker("provider_eligibility")] });
    expect(resolveExitCode(withBlocker, "blocker")).toBe(ExitCode.FAIL_THRESHOLD);
  });

  it("fail-on=blocker ignores error-result findings when there is no blocker", () => {
    const withError = makeResult({ findings: [{ id: "r1", result: "error" }] });
    expect(resolveExitCode(withError, "blocker")).toBe(ExitCode.SUCCESS);
  });

  it("fail-on=error trips on either a blocker or an error-result finding", () => {
    expect(resolveExitCode(makeResult({ findings: [{ id: "r1", result: "error" }] }), "error")).toBe(
      ExitCode.FAIL_THRESHOLD,
    );
    expect(resolveExitCode(makeResult({ blockers: [blocker("transport_or_protocol")] }), "error")).toBe(
      ExitCode.FAIL_THRESHOLD,
    );
    expect(resolveExitCode(makeResult({ findings: [{ id: "r1", result: "fail" }] }), "error")).toBe(
      ExitCode.SUCCESS,
    );
  });
});
