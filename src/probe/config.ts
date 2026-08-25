import { open } from "node:fs/promises";
import { ConfigError } from "../errors.js";
import { normalizeHttpUrl } from "../discovery/url.js";
import type { ProviderName, ProviderRequest, SearchSettings } from "../schema/probe.js";

export const PROBE_LIMITS = {
  maxPromptFileBytes: 256 * 1024,
  maxPrompts: 20,
  maxPromptBytes: 8 * 1024,
  maxRepeats: 10,
  maxAttempts: 100,
} as const;

const KEY_ENV: Record<ProviderName, "OPENAI_API_KEY" | "ANTHROPIC_API_KEY"> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export interface ProbeConfigInput {
  url: string;
  provider: string;
  model: string;
  promptsPath: string;
  repeats: string | number;
  locale?: string;
  country?: string;
  timezone?: string;
}

export interface ProbeConfig {
  url: string;
  provider: ProviderName;
  model: string;
  prompts: string[];
  repeats: number;
  search: SearchSettings;
}

export async function parseProbeConfig(input: ProbeConfigInput): Promise<ProbeConfig> {
  const provider = parseProvider(input.provider);
  const model = required(input.model, "model", 200);
  const repeats = parseRepeats(input.repeats);
  const prompts = await readPrompts(required(input.promptsPath, "prompts path", 4_096));
  if (prompts.length * repeats > PROBE_LIMITS.maxAttempts) {
    throw new ConfigError(`prompts × repeats must not exceed ${PROBE_LIMITS.maxAttempts} attempts`);
  }

  return {
    url: normalizeHttpUrl(input.url),
    provider,
    model,
    prompts,
    repeats,
    search: parseSearchSettings(input),
  };
}

export function providerRequest(config: ProbeConfig, prompt: string): ProviderRequest {
  return { prompt, model: config.model, search: { ...config.search } };
}

export function readProviderApiKey(
  provider: ProviderName,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = KEY_ENV[provider];
  const value = env[variable]?.trim();
  if (!value) throw new ConfigError(`missing ${variable} for provider ${provider}`);
  return value;
}

export function sanitizeRequestMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRequestMetadata);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, nested]) => [key, sanitizeRequestMetadata(nested)]),
  );
}

async function readPrompts(path: string): Promise<string[]> {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    if (size > PROBE_LIMITS.maxPromptFileBytes) {
      throw new ConfigError(`prompts file exceeds ${PROBE_LIMITS.maxPromptFileBytes} bytes`);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile());
    } catch {
      throw new ConfigError("prompts file must be valid UTF-8 JSON");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new ConfigError("prompts file must be valid UTF-8 JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > PROBE_LIMITS.maxPrompts) {
      throw new ConfigError(`prompts must contain 1 to ${PROBE_LIMITS.maxPrompts} strings`);
    }
    for (const prompt of parsed) {
      if (typeof prompt !== "string" || prompt.trim() === "") {
        throw new ConfigError("every prompt must be a non-empty string");
      }
      if (Buffer.byteLength(prompt, "utf8") > PROBE_LIMITS.maxPromptBytes) {
        throw new ConfigError(`each prompt must not exceed ${PROBE_LIMITS.maxPromptBytes} bytes`);
      }
    }
    return parsed as string[];
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`could not read prompts file: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close();
  }
}

function parseProvider(value: string): ProviderName {
  if (value === "openai" || value === "anthropic") return value;
  throw new ConfigError(`unsupported provider: ${value}`);
}

function parseRepeats(value: string | number): number {
  const repeats = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > PROBE_LIMITS.maxRepeats) {
    throw new ConfigError(`repeats must be an integer from 1 to ${PROBE_LIMITS.maxRepeats}`);
  }
  return repeats;
}

function parseSearchSettings(input: ProbeConfigInput): SearchSettings {
  const search: SearchSettings = {};
  if (input.locale !== undefined) {
    try {
      search.locale = Intl.getCanonicalLocales(input.locale)[0]!;
    } catch {
      throw new ConfigError(`invalid locale: ${input.locale}`);
    }
  }
  if (input.country !== undefined) {
    const country = input.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new ConfigError(`invalid country: ${input.country}`);
    search.country = country;
  }
  if (input.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
      search.timezone = input.timezone;
    } catch {
      throw new ConfigError(`invalid timezone: ${input.timezone}`);
    }
  }
  return search;
}

function required(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ConfigError(`${name} is required`);
  if (trimmed.length > maxLength) throw new ConfigError(`${name} is too long`);
  return trimmed;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "authorization",
    "proxyauthorization",
    "apikey",
    "xapikey",
    "cookie",
    "setcookie",
    "accesstoken",
    "authtoken",
    "clientsecret",
  ].includes(normalized);
}
