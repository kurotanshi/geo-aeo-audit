import type { FailOn } from "./config.js";
import type { AuditResult } from "./schema/result.js";

/** Semantic process exit codes. */
export const ExitCode = {
  /** Audit completed and the --fail-on threshold was not met. */
  SUCCESS: 0,
  /** Audit completed but the --fail-on threshold was met. */
  FAIL_THRESHOLD: 1,
  /** CLI usage or configuration error. */
  USAGE: 2,
  /** The fetch/audit could not be completed. */
  INCOMPLETE: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Map a *completed* audit result to SUCCESS or FAIL_THRESHOLD per --fail-on.
 * Incomplete audits (exit 3) and usage errors (exit 2) are handled upstream.
 */
export function resolveExitCode(result: AuditResult, failOn: FailOn): ExitCodeValue {
  if (failOn === "never") return ExitCode.SUCCESS;

  const hasBlocker = result.blockers.length > 0;
  if (failOn === "blocker") {
    return hasBlocker ? ExitCode.FAIL_THRESHOLD : ExitCode.SUCCESS;
  }

  // failOn === "error": blockers or any error-result finding trip the threshold.
  const hasError = result.findings.some((f) => f.result === "error");
  return hasBlocker || hasError ? ExitCode.FAIL_THRESHOLD : ExitCode.SUCCESS;
}
