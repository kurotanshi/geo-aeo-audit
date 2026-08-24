export type TransportReason =
  | "invalid_url"
  | "credentials_in_url"
  | "dns_failure"
  | "non_public_address"
  | "connection_error"
  | "tls_failure"
  | "timeout"
  | "redirect_limit"
  | "redirect_loop"
  | "non_http_redirect"
  | "response_too_large"
  | "decompressed_too_large"
  | "header_too_large"
  | "decompress_error";

/** A transport/protocol failure. Callers surface these as transport_or_protocol blockers. */
export class TransportError extends Error {
  override name = "TransportError";
  constructor(
    public readonly reason: TransportReason,
    message?: string,
    public override readonly cause?: unknown,
  ) {
    super(message ?? reason);
  }
}

/** Map a low-level Node error to a TransportError with a stable reason. */
export function mapNodeError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  const e = err as NodeJS.ErrnoException & { code?: string };
  const code = e?.code ?? "";

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") {
    return new TransportError("dns_failure", e.message, err);
  }
  if (code === "HPE_HEADER_OVERFLOW") {
    return new TransportError("header_too_large", e.message, err);
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new TransportError("timeout", e.message, err);
  }
  if (isTlsError(code)) {
    return new TransportError("tls_failure", e.message, err);
  }
  return new TransportError("connection_error", e.message || code || "connection error", err);
}

function isTlsError(code: string): boolean {
  return (
    code.startsWith("ERR_TLS") ||
    code.startsWith("ERR_SSL") ||
    code === "CERT_HAS_EXPIRED" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "HOSTNAME_MISMATCH"
  );
}
