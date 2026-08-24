import { describe, it, expect } from "vitest";
import { ExitCode, resolveExitCode } from "../src/exit.js";
import type { AuditResult } from "../src/schema/result.js";

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    ruleset_version: "0.1.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    target: { requested_url: "https://example.com/", mode: "page" },
    findings: [],
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
    const withBlocker = makeResult({ blockers: [{ kind: "transport_or_protocol" }] });
    expect(resolveExitCode(withBlocker, "never")).toBe(ExitCode.SUCCESS);
  });

  it("trips FAIL_THRESHOLD on a blocker under fail-on=blocker", () => {
    const withBlocker = makeResult({ blockers: [{ kind: "provider_eligibility" }] });
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
    expect(resolveExitCode(makeResult({ blockers: [{ kind: "transport_or_protocol" }] }), "error")).toBe(
      ExitCode.FAIL_THRESHOLD,
    );
    expect(resolveExitCode(makeResult({ findings: [{ id: "r1", result: "fail" }] }), "error")).toBe(
      ExitCode.SUCCESS,
    );
  });
});
