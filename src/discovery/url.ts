/** Conservative URL normalization used for scope checks, de-duplication and sampling. */
export function normalizeHttpUrl(raw: string, base?: string | URL): string {
  const url = base === undefined ? new URL(raw) : new URL(raw, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`unsupported URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError("URL must not contain credentials");
  }

  // URL already lower-cases schemes/hostnames, removes default ports and gives
  // an authority URL the canonical empty-path spelling `/`.
  url.hash = "";
  return url.toString();
}

export function isSameOrigin(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}
