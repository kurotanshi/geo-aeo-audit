import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// `pnpm test` runs `pnpm run build` first, so dist/cli.js exists here.
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** Run the built CLI; resolve with code+stdout+stderr regardless of exit code. */
async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args]);
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
  });

  it("--version exits 0 and prints a semver", async () => {
    const { code, stdout } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
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
      ]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      const html = await readFile(reportPath, "utf8");
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain("GEO/AEO static readiness audit");
      expect(html).toContain("Transport and protocol errors");
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
});
