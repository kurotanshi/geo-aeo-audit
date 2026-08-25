import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import zlib from "node:zlib";
import type { LookupFunction } from "node:net";
import type { AuditLimits } from "../config.js";
import { USER_AGENT } from "../version.js";
import { isPublicUnicastIp } from "./ip-guard.js";
import { TransportError, mapNodeError } from "./errors.js";

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Injection seam. Defaults are the strict, fail-closed production behaviour. */
export interface TransportDeps {
  /** Resolve a hostname to all addresses. Default: DNS getaddrinfo. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy. Default: {@link isPublicUnicastIp}. */
  isPublic?: (ip: string) => boolean;
}

export interface SafeResponse {
  finalUrl: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Number of response-body bytes received before content decoding. */
  rawBodyBytes: number;
  contentEncoding: string | undefined;
  redirects: { from: string; status: number; to: string }[];
  resolvedIp: string;
  ipFamily: number;
}

export interface SafeFetchOptions {
  limits: AuditLimits;
  userAgent?: string;
  accept?: string;
  deps?: TransportDeps;
  allowedOrigin?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const res = await dnsLookup(hostname, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
}

function parseAndValidate(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new TransportError("invalid_url", `invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new TransportError("invalid_url", `unsupported scheme: ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new TransportError("credentials_in_url", "URL must not embed credentials");
  }
  return u;
}

async function resolveAndVet(
  hostname: string,
  resolve: NonNullable<TransportDeps["resolve"]>,
  isPublic: NonNullable<TransportDeps["isPublic"]>,
): Promise<ResolvedAddress> {
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolve(hostname);
  } catch (err) {
    throw new TransportError("dns_failure", `DNS resolution failed for ${hostname}`, err);
  }
  if (addrs.length === 0) {
    throw new TransportError("dns_failure", `no addresses resolved for ${hostname}`);
  }
  // Fail closed: EVERY resolved address must be public (mixed results are rejected).
  for (const a of addrs) {
    if (!isPublic(a.address)) {
      throw new TransportError("non_public_address", `${hostname} resolved to non-public address ${a.address}`);
    }
  }
  return addrs[0]!;
}

function decompress(raw: Buffer, encoding: string | undefined, maxOut: number): Buffer {
  const enc = (encoding ?? "").toLowerCase();
  if (enc === "" || enc === "identity") {
    if (raw.length > maxOut) {
      throw new TransportError("decompressed_too_large", `body exceeds ${maxOut} bytes`);
    }
    return raw;
  }
  const opts = { maxOutputLength: maxOut };
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(raw, opts);
    if (enc === "br") return zlib.brotliDecompressSync(raw, opts);
    if (enc === "deflate") {
      try {
        return zlib.inflateSync(raw, opts);
      } catch {
        return zlib.inflateRawSync(raw, opts);
      }
    }
    throw new TransportError("decompress_error", `unsupported content-encoding: ${enc}`);
  } catch (err) {
    if (err instanceof TransportError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (err instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE") {
      throw new TransportError("decompressed_too_large", `decompressed body exceeds ${maxOut} bytes`, err);
    }
    throw new TransportError("decompress_error", `failed to decompress ${enc} body`, err);
  }
}

type HopResult =
  | { kind: "redirect"; status: number; location: string }
  | { kind: "final"; status: number; headers: http.IncomingHttpHeaders; body: Buffer; rawBodyBytes: number };

/** Perform one request to a pre-validated, pinned IP. Times out the whole hop. */
function hop(target: URL, pin: ResolvedAddress, limits: AuditLimits, userAgent: string, accept: string): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;

    // Pin the connection to the exact vetted IP; the OS never re-resolves the hostname.
    const pinnedLookup: LookupFunction = (_hostname, _options, cb) => {
      // eslint-disable-next-line n/no-callback-literal
      (cb as (e: null, a: string, f: number) => void)(null, pin.address, pin.family);
    };

    const options: https.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname, // drives Host header, TLS SNI and cert hostname check
      servername: isHttps ? target.hostname : undefined,
      port,
      method: "GET",
      path: `${target.pathname}${target.search}`,
      headers: {
        "user-agent": userAgent,
        accept,
        "accept-encoding": "gzip, br, deflate",
      },
      lookup: pinnedLookup,
      agent: false, // one-off agent: no connection reuse, no proxy env, no shared state
      rejectUnauthorized: true,
      maxHeaderSize: limits.maxHeaderBytes,
    };

    let settled = false;
    const timer = setTimeout(() => {
      req.destroy(new TransportError("timeout", `request timed out after ${limits.timeoutMs}ms`));
    }, limits.timeoutMs);

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err instanceof TransportError ? err : mapNodeError(err));
    };
    const succeed = (r: HopResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const req = lib.request(options);
    req.on("error", fail);
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(status) && typeof location === "string") {
        res.destroy();
        succeed({ kind: "redirect", status, location });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limits.maxResponseBytes) {
          res.destroy();
          req.destroy();
          fail(new TransportError("response_too_large", `response exceeds ${limits.maxResponseBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", fail);
      res.on("end", () => {
        if (settled) return;
        try {
          const body = decompress(Buffer.concat(chunks), res.headers["content-encoding"], limits.maxDecompressedBytes);
          succeed({ kind: "final", status, headers: res.headers, body, rawBodyBytes: size });
        } catch (err) {
          fail(err);
        }
      });
    });
    req.end();
  });
}

/**
 * Fetch a URL through the fail-closed audit transport.
 *
 * Every hop re-validates the URL and resolves the hostname, rejects unless ALL
 * resolved addresses are public global-unicast, then pins the TCP connection to
 * one vetted IP while keeping the original hostname for the Host header, TLS SNI
 * and certificate verification. No proxy, no implicit re-resolution. Redirects
 * consume the budget and re-run the whole check; non-HTTP(S) redirects, loops,
 * oversized headers/bodies, decompression bombs and timeouts all fail closed.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<SafeResponse> {
  const resolve = opts.deps?.resolve ?? defaultResolve;
  const isPublic = opts.deps?.isPublic ?? isPublicUnicastIp;
  const userAgent = opts.userAgent ?? USER_AGENT;
  const accept = opts.accept ?? "*/*";
  const { limits } = opts;

  let current = parseAndValidate(rawUrl);
  if (opts.allowedOrigin !== undefined && current.origin !== opts.allowedOrigin) {
    throw new TransportError("out_of_scope", `URL origin ${current.origin} is outside ${opts.allowedOrigin}`);
  }
  const visited = new Set<string>([current.toString()]);
  const redirects: SafeResponse["redirects"] = [];

  for (;;) {
    const pin = await resolveAndVet(current.hostname, resolve, isPublic);
    const result = await hop(current, pin, limits, userAgent, accept);

    if (result.kind === "final") {
      return {
        finalUrl: current.toString(),
        status: result.status,
        headers: result.headers,
        body: result.body,
        rawBodyBytes: result.rawBodyBytes,
        contentEncoding: result.headers["content-encoding"],
        redirects,
        resolvedIp: pin.address,
        ipFamily: pin.family,
      };
    }

    if (redirects.length >= limits.maxRedirects) {
      throw new TransportError("redirect_limit", `exceeded ${limits.maxRedirects} redirects`);
    }
    let next: URL;
    try {
      next = new URL(result.location, current);
    } catch {
      throw new TransportError("non_http_redirect", `invalid redirect location: ${result.location}`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new TransportError("non_http_redirect", `redirect to non-HTTP(S) target: ${next.protocol}`);
    }
    if (next.username || next.password) {
      throw new TransportError("credentials_in_url", "redirect target embeds credentials");
    }
    if (opts.allowedOrigin !== undefined && next.origin !== opts.allowedOrigin) {
      throw new TransportError("out_of_scope", `redirect origin ${next.origin} is outside ${opts.allowedOrigin}`);
    }
    const key = next.toString();
    if (visited.has(key)) {
      throw new TransportError("redirect_loop", `redirect loop detected at ${key}`);
    }
    visited.add(key);
    redirects.push({ from: current.toString(), status: result.status, to: key });
    current = next;
  }
}
