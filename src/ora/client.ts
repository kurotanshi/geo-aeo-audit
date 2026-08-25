import type { OraConfig } from "./config.js";
import type { OraAuditPayload } from "../schema/ora.js";
import { USER_AGENT } from "../version.js";

const ORA_ORIGIN = "https://ora.ai";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 20_000;
const MAX_POLLS = 15;
const OVERALL_DEADLINE_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type OraClientErrorCode = "not_found" | "rate_limited" | "invalid_response";

export class OraClientError extends Error {
  override name = "OraClientError";

  constructor(
    readonly code: OraClientErrorCode,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

export interface OraClientDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface OraClientResult {
  payload: OraAuditPayload;
  endpoint: string;
  polls: number;
  httpStatus: number;
  cache: {
    age: string | null;
    xVercelCache: string | null;
  };
}

export async function fetchOraReport(config: OraConfig, deps: OraClientDeps = {}): Promise<OraClientResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const endpoint = config.mode === "cached"
    ? `${ORA_ORIGIN}/api/score/${encodeURIComponent(config.hostname)}?include=essentials&format=audit`
    : `${ORA_ORIGIN}/api/scan?include=essentials&format=audit`;
  const initial = await request(fetchImpl, endpoint, config.mode === "scan" ? {
    method: "POST",
    body: JSON.stringify({ url: config.url }),
  } : { method: "GET" });

  if (initial.response.status === 200) {
    return completedResult(endpoint, 0, initial.response, requireCompletePayload(initial.payload));
  }
  handleTerminalHttpError(initial.response);
  if (config.mode !== "scan" || initial.response.status !== 202) {
    throw new OraClientError("invalid_response", `Ora returned unexpected HTTP ${initial.response.status}`);
  }

  let latest = objectPayload(initial.payload);
  let location = pollingLocation(initial.response);
  let polls = 0;
  let lastResponse = initial.response;
  while (polls < MAX_POLLS && now() - startedAt < OVERALL_DEADLINE_MS) {
    const remaining = OVERALL_DEADLINE_MS - (now() - startedAt);
    if (remaining <= 0) break;
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    if (now() - startedAt >= OVERALL_DEADLINE_MS) break;

    const polled = await request(fetchImpl, location, { method: "GET" });
    polls += 1;
    lastResponse = polled.response;
    if (polled.response.status === 200) {
      return completedResult(endpoint, polls, polled.response, requireCompletePayload(polled.payload));
    }
    handleTerminalHttpError(polled.response);
    if (polled.response.status !== 202) {
      throw new OraClientError("invalid_response", `Ora poll returned unexpected HTTP ${polled.response.status}`);
    }
    latest = objectPayload(polled.payload);
    location = pollingLocation(polled.response);
  }

  return completedResult(endpoint, polls, lastResponse, { ...latest, analysisStatus: "partial" });
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<{ response: Response; payload: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
  } catch (error) {
    throw new OraClientError(
      "invalid_response",
      `Ora request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 404 || response.status === 429 || response.status >= 500) {
    return { response, payload: {} };
  }
  const bytes = await boundedBody(response);
  try {
    return { response, payload: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    throw new OraClientError("invalid_response", "Ora returned a non-JSON response");
  }
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  if (response.body === null) throw new OraClientError("invalid_response", "Ora returned an empty response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OraClientError("invalid_response", `Ora response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function handleTerminalHttpError(response: Response): void {
  if (response.status === 404) {
    throw new OraClientError("not_found", "Ora has no cached report; rerun with --scan");
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") ?? undefined;
    throw new OraClientError(
      "rate_limited",
      `Ora rate limit exceeded${retryAfter === undefined ? "" : `; retry after ${retryAfter} seconds`}`,
      retryAfter,
    );
  }
  if (response.status >= 500) {
    throw new OraClientError("invalid_response", `Ora returned HTTP ${response.status}`);
  }
}

function pollingLocation(response: Response): string {
  const raw = response.headers.get("location");
  if (raw === null || raw === "") throw new OraClientError("invalid_response", "Ora HTTP 202 omitted Location");
  let url: URL;
  try {
    url = new URL(raw, ORA_ORIGIN);
  } catch {
    throw new OraClientError("invalid_response", "Ora HTTP 202 returned an invalid Location");
  }
  if (url.username !== "" || url.password !== "" || url.origin !== ORA_ORIGIN) {
    throw new OraClientError("invalid_response", "Ora polling Location must remain credential-free on https://ora.ai");
  }
  return url.toString();
}

function objectPayload(value: unknown): OraAuditPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OraClientError("invalid_response", "Ora response must be a JSON object");
  }
  return value as OraAuditPayload;
}

function requireCompletePayload(value: unknown): OraAuditPayload {
  const payload = objectPayload(value);
  if (
    typeof payload.contractVersion !== "string" ||
    typeof payload.score !== "number" ||
    typeof payload.grade !== "string" ||
    !Array.isArray(payload.layers) ||
    !Array.isArray(payload.topFixes) ||
    payload.essentials === null ||
    typeof payload.essentials !== "object" ||
    Array.isArray(payload.essentials)
  ) {
    throw new OraClientError("invalid_response", "Ora response omitted required audit fields");
  }
  return payload;
}

function completedResult(
  endpoint: string,
  polls: number,
  response: Response,
  payload: OraAuditPayload,
): OraClientResult {
  return {
    payload,
    endpoint,
    polls,
    httpStatus: response.status,
    cache: {
      age: response.headers.get("age"),
      xVercelCache: response.headers.get("x-vercel-cache"),
    },
  };
}
