import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { parseOraConfig } from "../src/ora/config.js";

describe("Ora command config", () => {
  it("normalizes one URL and derives only its hostname", () => {
    expect(parseOraConfig({ values: { scan: true, "no-json": true, html: "ora.html" }, positionals: ["https://Example.com/path#fragment"] })).toEqual({
      url: "https://example.com/path",
      hostname: "example.com",
      mode: "scan",
      output: { json: false, htmlPath: "ora.html" },
    });
  });

  it("rejects missing, extra, and non-HTTP URLs", () => {
    for (const positionals of [[], ["https://example.com", "https://example.org"], ["file:///tmp/report"]]) {
      expect(() => parseOraConfig({ values: {}, positionals })).toThrow(ConfigError);
    }
  });
});
