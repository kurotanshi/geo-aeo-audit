import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseProbeConfig,
  PROBE_LIMITS,
  providerRequest,
  readProviderApiKey,
  sanitizeRequestMetadata,
} from "../src/probe/config.js";
import { ConfigError } from "../src/errors.js";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function prompts(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "geo-aeo-prompts-"));
  directories.push(directory);
  const path = join(directory, "prompts.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

describe("probe configuration boundary", () => {
  it("parses bounded prompts and creates a target-free provider request", async () => {
    const config = await parseProbeConfig({
      url: "HTTPS://Example.COM/page#fragment",
      provider: "openai",
      model: "gpt-test",
      promptsPath: await prompts(["Who is Example?"]),
      repeats: "2",
      locale: "zh-hant-tw",
      country: "tw",
      timezone: "Asia/Taipei",
    });

    expect(config).toMatchObject({
      url: "https://example.com/page",
      provider: "openai",
      repeats: 2,
      search: { locale: "zh-Hant-TW", country: "TW", timezone: "Asia/Taipei" },
    });
    expect(providerRequest(config, config.prompts[0]!)).toEqual({
      prompt: "Who is Example?",
      model: "gpt-test",
      search: config.search,
    });
  });

  it("rejects unsupported providers, invalid repeats and empty prompts", async () => {
    const path = await prompts([]);
    await expect(
      parseProbeConfig({ url: "https://example.com", provider: "google", model: "x", promptsPath: path, repeats: 1 }),
    ).rejects.toThrow("unsupported provider");
    await expect(
      parseProbeConfig({ url: "https://example.com", provider: "openai", model: "x", promptsPath: path, repeats: 0 }),
    ).rejects.toThrow("repeats must be an integer");
    await expect(
      parseProbeConfig({ url: "https://example.com", provider: "openai", model: "x", promptsPath: path, repeats: 1 }),
    ).rejects.toThrow("prompts must contain");
  });

  it("enforces file, prompt-count, prompt-byte, and UTF-8 limits", async () => {
    const input = (promptsPath: string) => ({
      url: "https://example.com",
      provider: "openai",
      model: "test",
      promptsPath,
      repeats: 1,
    });
    await expect(parseProbeConfig(input(await prompts(Array.from({ length: 21 }, () => "test")))))
      .rejects.toThrow("1 to 20 strings");
    await expect(parseProbeConfig(input(await prompts(["x".repeat(PROBE_LIMITS.maxPromptBytes + 1)]))))
      .rejects.toThrow("each prompt must not exceed");

    const largeDirectory = await mkdtemp(join(tmpdir(), "geo-aeo-prompts-large-"));
    directories.push(largeDirectory);
    const largePath = join(largeDirectory, "prompts.json");
    await writeFile(largePath, Buffer.alloc(PROBE_LIMITS.maxPromptFileBytes + 1, 0x20));
    await expect(parseProbeConfig(input(largePath))).rejects.toThrow("prompts file exceeds");

    const invalidDirectory = await mkdtemp(join(tmpdir(), "geo-aeo-prompts-invalid-"));
    directories.push(invalidDirectory);
    const invalidPath = join(invalidDirectory, "prompts.json");
    await writeFile(invalidPath, Buffer.from([0x5b, 0x22, 0x80, 0x22, 0x5d]));
    await expect(parseProbeConfig(input(invalidPath))).rejects.toThrow("valid UTF-8 JSON");
  });

  it("reads only the selected credential and removes auth metadata recursively", () => {
    const accessed: string[] = [];
    const env = new Proxy(
      { OPENAI_API_KEY: "secret-openai", ANTHROPIC_API_KEY: "secret-anthropic" },
      { get: (target, key: string) => (accessed.push(key), target[key as keyof typeof target]) },
    );

    expect(readProviderApiKey("openai", env)).toBe("secret-openai");
    expect(accessed).toEqual(["OPENAI_API_KEY"]);
    expect(
      sanitizeRequestMetadata({
        request_id: "req_1",
        headers: { Authorization: "Bearer secret-openai", "x-api-key": "secret-openai", trace: "ok" },
        nested: [{ access_token: "secret", value: 1 }],
      }),
    ).toEqual({ request_id: "req_1", headers: { trace: "ok" }, nested: [{ value: 1 }] });
    expect(() => readProviderApiKey("anthropic", {})).toThrow(ConfigError);
  });
});
