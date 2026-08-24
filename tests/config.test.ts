import { describe, it, expect } from "vitest";
import { parseAuditConfig, DEFAULT_LIMITS } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("parseAuditConfig", () => {
  it("parses a minimal valid audit invocation with defaults", () => {
    const cfg = parseAuditConfig({ values: {}, positionals: ["https://example.com/page"] });
    expect(cfg.url).toBe("https://example.com/page");
    expect(cfg.mode).toBe("page");
    expect(cfg.failOn).toBe("blocker");
    expect(cfg.output.json).toBe(true);
    expect(cfg.output.htmlPath).toBeUndefined();
    expect(cfg.limits).toEqual(DEFAULT_LIMITS);
  });

  it("honours --site, --fail-on, --no-json and --html", () => {
    const cfg = parseAuditConfig({
      values: { site: true, "fail-on": "error", "no-json": true, html: "out.html" },
      positionals: ["http://example.com"],
    });
    expect(cfg.mode).toBe("site");
    expect(cfg.failOn).toBe("error");
    expect(cfg.output.json).toBe(false);
    expect(cfg.output.htmlPath).toBe("out.html");
  });

  it("rejects a missing url", () => {
    expect(() => parseAuditConfig({ values: {}, positionals: [] })).toThrow(ConfigError);
  });

  it("rejects more than one url", () => {
    expect(() => parseAuditConfig({ values: {}, positionals: ["https://a.com", "https://b.com"] })).toThrow(
      ConfigError,
    );
  });

  it("rejects a non-http(s) url", () => {
    expect(() => parseAuditConfig({ values: {}, positionals: ["ftp://example.com"] })).toThrow(ConfigError);
    expect(() => parseAuditConfig({ values: {}, positionals: ["not a url"] })).toThrow(ConfigError);
  });

  it("rejects an invalid --fail-on value", () => {
    expect(() =>
      parseAuditConfig({ values: { "fail-on": "always" }, positionals: ["https://example.com"] }),
    ).toThrow(ConfigError);
  });
});
