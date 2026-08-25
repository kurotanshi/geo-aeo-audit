import type { OraMapping } from "../registry/ora-checks.js";

export const ORA_SCHEMA_VERSION = "1.0.0";

export interface OraAuditPayload extends Record<string, unknown> {
  contractVersion?: string;
  score?: number;
  grade?: string;
  scannedAt?: string | null;
  analysisStatus?: "complete" | "partial" | "stuck";
  pendingChecks?: unknown[];
  layers?: unknown[];
  topFixes?: unknown[];
  essentials?: Record<string, unknown>;
}

export interface OraCrosswalkResult {
  ora_id: string;
  mapping: OraMapping | "unmapped";
  local_rule_ids: readonly string[];
  explanation: string;
}

export interface OraResult {
  schema_version: typeof ORA_SCHEMA_VERSION;
  tool_version: string;
  generated_at: string;
  request: {
    endpoint: string;
    mode: "cached" | "scan";
    polls: number;
    http_status: number;
    cache: {
      age: string | null;
      x_vercel_cache: string | null;
    };
  };
  ora: OraAuditPayload;
  crosswalk: OraCrosswalkResult[];
  limitations: string[];
}
