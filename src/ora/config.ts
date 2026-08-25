import { normalizeHttpUrl } from "../discovery/url.js";
import { ConfigError } from "../errors.js";

export interface OraFlags {
  scan?: boolean;
  json?: boolean;
  "no-json"?: boolean;
  html?: string;
}

export interface OraConfig {
  url: string;
  hostname: string;
  mode: "cached" | "scan";
  output: {
    json: boolean;
    htmlPath?: string;
  };
}

export function parseOraConfig(input: { values: OraFlags; positionals: string[] }): OraConfig {
  if (input.positionals.length === 0) throw new ConfigError("missing <url> argument");
  if (input.positionals.length > 1) {
    throw new ConfigError(`expected a single <url>, got ${input.positionals.length} arguments`);
  }
  let url: string;
  try {
    url = normalizeHttpUrl(input.positionals[0]!);
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
  return {
    url,
    hostname: new URL(url).hostname,
    mode: input.values.scan ? "scan" : "cached",
    output: {
      json: !input.values["no-json"],
      ...(input.values.html === undefined ? {} : { htmlPath: input.values.html }),
    },
  };
}
