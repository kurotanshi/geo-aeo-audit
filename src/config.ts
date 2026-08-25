import { ConfigError } from "./errors.js";

export type FailOn = "never" | "blocker" | "error";
const FAIL_ON_VALUES: readonly FailOn[] = ["never", "blocker", "error"];
export type HtmlLanguage = "en" | "zh-TW";
const HTML_LANGUAGES: readonly HtmlLanguage[] = ["en", "zh-TW"];

/**
 * First-class resource limits. All are written into report metadata by later
 * tasks; transport/discovery tasks read them. Defaults live in one place.
 */
export interface AuditLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxPages: number;
  maxHeaderBytes: number;
  maxResponseBytes: number;
  maxDecompressedBytes: number;
  maxTotalBytes: number;
  maxSitemaps: number;
  maxSitemapDepth: number;
  concurrency: number;
}

export const DEFAULT_LIMITS: AuditLimits = {
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
};

export interface AuditConfig {
  url: string;
  mode: "page" | "site";
  failOn: FailOn;
  output: {
    json: boolean;
    htmlPath?: string;
    htmlLanguage?: HtmlLanguage;
  };
  limits: AuditLimits;
}

export interface ParsedFlags {
  site?: boolean;
  "fail-on"?: string;
  json?: boolean;
  "no-json"?: boolean;
  html?: string;
  "html-lang"?: string;
}

/**
 * Build a validated AuditConfig from parsed CLI flags and the positionals that
 * follow the `audit` command. Throws ConfigError on any invalid input.
 */
export function parseAuditConfig(input: { values: ParsedFlags; positionals: string[] }): AuditConfig {
  const { values, positionals } = input;

  if (positionals.length === 0) {
    throw new ConfigError("missing <url> argument");
  }
  if (positionals.length > 1) {
    throw new ConfigError(`expected a single <url>, got ${positionals.length} arguments`);
  }
  const rawUrl = positionals[0]!;
  const url = validateUrl(rawUrl);

  const failOn = resolveFailOn(values["fail-on"]);

  const json = values["no-json"] ? false : true;

  return {
    url,
    mode: values.site ? "site" : "page",
    failOn,
    output: {
      json,
      ...(values.html !== undefined ? { htmlPath: values.html } : {}),
      ...(values["html-lang"] !== undefined ? { htmlLanguage: resolveHtmlLanguage(values["html-lang"]) } : {}),
    },
    limits: DEFAULT_LIMITS,
  };
}

function validateUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`URL must use http or https, got: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function resolveFailOn(value: string | undefined): FailOn {
  if (value === undefined) return "blocker";
  if ((FAIL_ON_VALUES as readonly string[]).includes(value)) {
    return value as FailOn;
  }
  throw new ConfigError(`--fail-on must be one of ${FAIL_ON_VALUES.join(", ")}, got: ${value}`);
}

function resolveHtmlLanguage(value: string): HtmlLanguage {
  if ((HTML_LANGUAGES as readonly string[]).includes(value)) return value as HtmlLanguage;
  throw new ConfigError(`--html-lang must be one of ${HTML_LANGUAGES.join(", ")}, got: ${value}`);
}
