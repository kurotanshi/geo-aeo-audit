import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// `pnpm test` runs `pnpm run build` first, so dist/cli.js exists here.
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const PROVIDER_LOADER = fileURLToPath(new URL("./fixtures/mock-provider-loader.mjs", import.meta.url));
const ORA_LOADER = fileURLToPath(new URL("./fixtures/mock-ora-loader.mjs", import.meta.url));

/** Run the built CLI; resolve with code+stdout+stderr regardless of exit code. */
async function run(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { OPENAI_API_KEY: _openAI, ANTHROPIC_API_KEY: _anthropic, NODE_OPTIONS: _nodeOptions, ...cleanEnv } = process.env;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      env: { ...cleanEnv, ...extraEnv },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("geo-aeo CLI", () => {
  it("--help exits 0 and prints usage", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("geo-aeo audit <url>");
    expect(stdout).toContain("geo-aeo ora <url>");
  });

  it("--version exits 0 and prints a semver", async () => {
    const { code, stdout } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("probe --help documents only the supported provider inputs", async () => {
    const { code, stdout } = await run(["probe", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--prompts <path>");
    expect(stdout).toContain("openai | anthropic");
    expect(stdout).not.toContain("gemini");
  });

  it("ora --help documents the opt-in scan without credentials", async () => {
    const { code, stdout } = await run(["ora", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--scan");
    expect(stdout).toContain("--html <path>");
    expect(stdout.toLowerCase()).not.toContain("api key");
  });

  it("no command exits 2 (usage)", async () => {
    const { code } = await run([]);
    expect(code).toBe(2);
  });

  it("unknown command exits 2 (usage)", async () => {
    const { code } = await run(["frobnicate", "https://example.com"]);
    expect(code).toBe(2);
  });

  it("unknown flag exits 2 (usage)", async () => {
    const { code } = await run(["audit", "https://example.com", "--bogus"]);
    expect(code).toBe(2);
  });

  it("missing url exits 2 (usage)", async () => {
    const { code } = await run(["audit"]);
    expect(code).toBe(2);
  });

  it("ora without a hostname exits 2 before making a request", async () => {
    const { code, stderr } = await run(["ora"]);
    expect(code).toBe(2);
    expect(stderr).toContain("missing <url> argument");
  });

  it("invalid --fail-on exits 2 (usage)", async () => {
    const { code } = await run(["audit", "https://example.com", "--fail-on", "always"]);
    expect(code).toBe(2);
  });

  it("audit emits a versioned JSON envelope without connecting to a rejected SSRF target", async () => {
    const { code, stdout } = await run(["audit", "http://127.0.0.1/", "--fail-on", "never"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schema_version).toBe("1.1.0");
    expect(parsed.tool_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.ruleset_version).toBeTruthy();
    expect(parsed.target.requested_url).toBe("http://127.0.0.1/");
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(Array.isArray(parsed.scorecards)).toBe(true);
    expect(Array.isArray(parsed.blockers)).toBe(true);
    expect(parsed).not.toHaveProperty("score");
    expect(parsed.findings).toContainEqual(expect.objectContaining({ id: "technical.transport", result: "error" }));
    expect(parsed.blockers).toContainEqual(expect.objectContaining({ kind: "transport_or_protocol" }));
  });

  it("uses exit 1 when the default blocker threshold is met", async () => {
    const { code, stdout } = await run(["audit", "http://127.0.0.1/"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).blockers).toContainEqual(
      expect.objectContaining({ kind: "transport_or_protocol" }),
    );
  });

  it("writes a standalone HTML report and can suppress JSON stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-report-"));
    const reportPath = join(directory, "audit.html");
    try {
      const { code, stdout, stderr } = await run([
        "audit",
        "http://127.0.0.1/",
        "--fail-on",
        "never",
        "--no-json",
        "--html",
        reportPath,
        "--html-lang",
        "zh-TW",
      ]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      const html = await readFile(reportPath, "utf8");
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain('<html lang="zh-Hant">');
      expect(html).toContain("GEO/AEO 靜態準備度稽核");
      expect(html).toContain("傳輸與協定錯誤");
      expect(html).toContain("稽核傳輸層無法取得回應，因此無法量測技術資格。");
      expect(html).not.toMatch(/<script\b/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses exit 3 when a requested HTML report cannot be written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-report-error-"));
    const reportPath = join(directory, "missing", "audit.html");
    try {
      const { code, stdout, stderr } = await run([
        "audit",
        "http://127.0.0.1/",
        "--fail-on",
        "never",
        "--no-json",
        "--html",
        reportPath,
      ]);
      expect(code).toBe(3);
      expect(stdout).toBe("");
      expect(stderr).toContain("could not write HTML report");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported providers and missing selected credentials before provider access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-probe-input-"));
    const prompts = join(directory, "prompts.json");
    await writeFile(prompts, '["test"]', "utf8");
    try {
      const unsupported = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "google", "--model", "test", "--repeats", "1",
      ]);
      expect(unsupported.code).toBe(2);
      expect(unsupported.stderr).toContain("unsupported provider: google");

      const missing = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "openai", "--model", "test", "--repeats", "1",
      ]);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain("missing OPENAI_API_KEY");
      expect(missing.stderr).not.toContain("ANTHROPIC_API_KEY");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces probe attempt limits before provider access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-probe-limit-"));
    const prompts = join(directory, "prompts.json");
    await writeFile(prompts, JSON.stringify(Array.from({ length: 11 }, (_, index) => `prompt ${index}`)), "utf8");
    try {
      const result = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "openai", "--model", "test", "--repeats", "10",
      ], { OPENAI_API_KEY: "unused" });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("must not exceed 100 attempts");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs repeated OpenAI and Anthropic probes through isolated synthetic endpoints only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-probe-provider-"));
    const prompts = join(directory, "prompts.json");
    await writeFile(prompts, '["first", "second"]', "utf8");
    const nodeOptions = `--import=${pathToFileURL(PROVIDER_LOADER).href}`;
    try {
      const openai = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "openai", "--model", "gpt-test", "--repeats", "2",
      ], { NODE_OPTIONS: nodeOptions, EXPECTED_PROVIDER: "openai", OPENAI_API_KEY: "openai-e2e-secret", ANTHROPIC_API_KEY: "wrong-provider-secret" });
      expect(openai.code).toBe(0);
      expect(JSON.parse(openai.stdout)).toMatchObject({
        schema_version: "1.0.0",
        experiment: { provider: "openai", requested_model: "gpt-test" },
      });
      expect(JSON.parse(openai.stdout).attempts).toHaveLength(4);
      expect(JSON.parse(openai.stdout).attempts[0].response.value).toMatchObject({
        api_version: { value: null, status: "not_exposed" },
        search_tool_version: { value: null, status: "not_exposed" },
        sdk_version: { value: null, status: "not_used" },
      });
      expect(`${openai.stdout}${openai.stderr}`).not.toContain("openai-e2e-secret");
      expect(`${openai.stdout}${openai.stderr}`).not.toContain("wrong-provider-secret");

      const anthropic = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "anthropic", "--model", "claude-test", "--repeats", "1",
      ], { NODE_OPTIONS: nodeOptions, EXPECTED_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "anthropic-e2e-secret", OPENAI_API_KEY: "wrong-provider-secret" });
      expect(anthropic.code).toBe(0);
      expect(JSON.parse(anthropic.stdout)).toMatchObject({ experiment: { provider: "anthropic" } });
      expect(JSON.parse(anthropic.stdout).attempts).toHaveLength(2);
      expect(`${anthropic.stdout}${anthropic.stderr}`).not.toContain("anthropic-e2e-secret");
      expect(`${anthropic.stdout}${anthropic.stderr}`).not.toContain("wrong-provider-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports all-provider-error zero denominators without leaking credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-probe-error-"));
    const prompts = join(directory, "prompts.json");
    await writeFile(prompts, '["test"]', "utf8");
    try {
      const result = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "openai", "--model", "gpt-test", "--repeats", "1",
      ], {
        NODE_OPTIONS: `--import=${pathToFileURL(PROVIDER_LOADER).href}`,
        EXPECTED_PROVIDER: "openai",
        MOCK_PROVIDER_MODE: "error",
        OPENAI_API_KEY: "error-e2e-secret",
      });
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.attempts[0]).toMatchObject({
        outcome: "provider_error",
        response: { value: null, status: "unavailable" },
      });
      expect(parsed.rates).toContainEqual(expect.objectContaining({
        metric: "search_use_rate",
        view: "completed",
        denominator: 0,
        value: null,
      }));
      expect(`${result.stdout}${result.stderr}`).not.toContain("error-e2e-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes an injection-safe probe HTML report without JSON stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-probe-html-"));
    const prompts = join(directory, "prompts.json");
    const report = join(directory, "probe.html");
    const payload = '</script><script>alert("owned")</script>';
    await writeFile(prompts, JSON.stringify([payload]), "utf8");
    try {
      const result = await run([
        "probe", "http://127.0.0.1/", "--prompts", prompts, "--provider", "openai", "--model", "gpt-test", "--repeats", "1", "--no-json", "--html", report,
      ], {
        NODE_OPTIONS: `--import=${pathToFileURL(PROVIDER_LOADER).href}`,
        EXPECTED_PROVIDER: "openai",
        OPENAI_API_KEY: "html-e2e-secret",
      });
      expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
      const html = await readFile(report, "utf8");
      expect(html).toContain("&lt;/script&gt;");
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toContain("html-e2e-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads an Ora cache through the fixed endpoint and emits its independent envelope", async () => {
    const result = await run(["ora", "https://example.com/path"], {
      NODE_OPTIONS: `--import=${pathToFileURL(ORA_LOADER).href}`,
    });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      schema_version: "1.0.0",
      request: {
        endpoint: "https://ora.ai/api/score/example.com?include=essentials&format=audit",
        mode: "cached",
        polls: 0,
        http_status: 200,
      },
      ora: { contractVersion: "1.21.0", score: 72, analysisStatus: "complete" },
    });
    expect(parsed.ora.topFixes.map((fix: { id: string }) => fix.id)).toEqual(["second", "first"]);
    expect(parsed.crosswalk).toContainEqual(expect.objectContaining({
      ora_id: "metadata-completeness",
      mapping: "composite",
    }));
  });

  it("writes an Ora scan HTML report without JSON stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "geo-aeo-ora-html-"));
    const report = join(directory, "ora.html");
    try {
      const result = await run([
        "ora", "https://example.com/path", "--scan", "--no-json", "--html", report,
      ], {
        NODE_OPTIONS: `--import=${pathToFileURL(ORA_LOADER).href}`,
        MOCK_ORA_EXPECT_MODE: "scan",
      });
      expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
      const html = await readFile(report, "utf8");
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain("Ora score 72/100");
      expect(html).not.toMatch(/<script\b/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { mode: "404", message: "--scan" },
    { mode: "429", message: "retry after 23 seconds" },
  ])("returns exit 3 for an Ora $mode response", async ({ mode, message }) => {
    const result = await run(["ora", "https://example.com/path"], {
      NODE_OPTIONS: `--import=${pathToFileURL(ORA_LOADER).href}`,
      MOCK_ORA_MODE: mode,
    });
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });
});
