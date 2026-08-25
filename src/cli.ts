#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runAudit } from "./audit/run.js";
import { parseAuditConfig } from "./config.js";
import { ConfigError, IncompleteAuditError } from "./errors.js";
import { ExitCode, resolveExitCode, type ExitCodeValue } from "./exit.js";
import { OraClientError } from "./ora/client.js";
import { parseOraConfig } from "./ora/config.js";
import { runOra } from "./ora/run.js";
import { parseProbeConfig, readProviderApiKey } from "./probe/config.js";
import { runProbe } from "./probe/run.js";
import { renderHtmlReport } from "./report/html.js";
import { renderOraHtmlReport } from "./report/ora-html.js";
import { renderProbeHtmlReport } from "./report/probe-html.js";
import { TOOL_VERSION } from "./version.js";

const USAGE = `geo-aeo — GEO/AEO audit, citation observation, and Ora readiness CLI

Usage:
  geo-aeo audit <url> [options]
  geo-aeo probe <url> [options]
  geo-aeo ora <url> [options]
  geo-aeo --help
  geo-aeo --version

Run "geo-aeo <command> --help" for command options.
`;

const AUDIT_USAGE = `Usage: geo-aeo audit <url> [options]

Options:
  --site             Audit sampled pages within the final origin (default: single page)
  --fail-on <mode>   Exit non-zero on: blocker | error | never (default: blocker)
  --json             Print JSON result to stdout (default on)
  --no-json          Suppress JSON output
  --html <path>      Write single-file HTML report to <path>
  -h, --help         Show this help
`;

const PROBE_USAGE = `Usage: geo-aeo probe <url> [options]

Required options:
  --prompts <path>   UTF-8 JSON array of prompt strings
  --provider <name>  openai | anthropic
  --model <id>       Provider model identifier
  --repeats <n>      Repetitions per prompt (1-10)

Search options:
  --locale <tag>     BCP 47 locale metadata, for example zh-TW
  --country <code>   ISO 3166-1 alpha-2 search country
  --timezone <id>    IANA search timezone
  --json             Print JSON result to stdout (default on)
  --no-json          Suppress JSON output
  --html <path>      Write single-file HTML report to <path>
  -h, --help         Show this help
`;

const ORA_USAGE = `Usage: geo-aeo ora <url> [options]

Options:
  --scan             Start an Ora scan instead of reading a cached report
  --json             Print JSON result to stdout (default on)
  --no-json          Suppress JSON output
  --html <path>      Write single-file HTML report to <path>
  -h, --help         Show this help
`;

const AUDIT_OPTIONS = {
  help: { type: "boolean", short: "h" },
  site: { type: "boolean" },
  "fail-on": { type: "string" },
  json: { type: "boolean" },
  "no-json": { type: "boolean" },
  html: { type: "string" },
} as const;

const PROBE_OPTIONS = {
  help: { type: "boolean", short: "h" },
  prompts: { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  repeats: { type: "string" },
  locale: { type: "string" },
  country: { type: "string" },
  timezone: { type: "string" },
  json: { type: "boolean" },
  "no-json": { type: "boolean" },
  html: { type: "string" },
} as const;

const ORA_OPTIONS = {
  help: { type: "boolean", short: "h" },
  scan: { type: "boolean" },
  json: { type: "boolean" },
  "no-json": { type: "boolean" },
  html: { type: "string" },
} as const;

async function main(): Promise<ExitCodeValue> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return ExitCode.SUCCESS;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return ExitCode.SUCCESS;
  }
  if (command === undefined) return usageError("no command given", USAGE);
  if (command === "audit") return runAuditCommand(args);
  if (command === "probe") return runProbeCommand(args);
  if (command === "ora") return runOraCommand(args);
  return usageError(`unknown command "${command}"`, USAGE);
}

async function runAuditCommand(args: string[]): Promise<ExitCodeValue> {
  let parsed;
  try {
    parsed = parseArgs({ args, options: AUDIT_OPTIONS, allowPositionals: true });
  } catch (error) {
    return usageError(message(error), AUDIT_USAGE);
  }
  if (parsed.values.help) {
    process.stdout.write(AUDIT_USAGE);
    return ExitCode.SUCCESS;
  }

  let config;
  try {
    config = parseAuditConfig({ values: parsed.values, positionals: parsed.positionals });
  } catch (error) {
    return configError(error);
  }

  let result;
  try {
    result = await runAudit(config);
  } catch (error) {
    if (error instanceof IncompleteAuditError) {
      process.stderr.write(`Error: ${error.message}\n`);
      return ExitCode.INCOMPLETE;
    }
    throw error;
  }

  if (config.output.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (config.output.htmlPath) {
    try {
      await writeFile(config.output.htmlPath, renderHtmlReport(result), "utf8");
    } catch (error) {
      process.stderr.write(`Error: could not write HTML report: ${message(error)}\n`);
      return ExitCode.INCOMPLETE;
    }
  }
  return resolveExitCode(result, config.failOn);
}

async function runProbeCommand(args: string[]): Promise<ExitCodeValue> {
  let parsed;
  try {
    parsed = parseArgs({ args, options: PROBE_OPTIONS, allowPositionals: true });
  } catch (error) {
    return usageError(message(error), PROBE_USAGE);
  }
  if (parsed.values.help) {
    process.stdout.write(PROBE_USAGE);
    return ExitCode.SUCCESS;
  }

  let config;
  let apiKey: string;
  try {
    if (parsed.positionals.length === 0) throw new ConfigError("missing <url> argument");
    if (parsed.positionals.length > 1) {
      throw new ConfigError(`expected a single <url>, got ${parsed.positionals.length} arguments`);
    }
    config = await parseProbeConfig({
      url: parsed.positionals[0]!,
      provider: parsed.values.provider ?? "",
      model: parsed.values.model ?? "",
      promptsPath: parsed.values.prompts ?? "",
      repeats: parsed.values.repeats ?? "",
      ...(parsed.values.locale === undefined ? {} : { locale: parsed.values.locale }),
      ...(parsed.values.country === undefined ? {} : { country: parsed.values.country }),
      ...(parsed.values.timezone === undefined ? {} : { timezone: parsed.values.timezone }),
    });
    apiKey = readProviderApiKey(config.provider);
  } catch (error) {
    return configError(error);
  }

  const result = await runProbe(config, apiKey);
  if (!parsed.values["no-json"]) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (parsed.values.html !== undefined) {
    try {
      await writeFile(parsed.values.html, renderProbeHtmlReport(result), "utf8");
    } catch (error) {
      process.stderr.write(`Error: could not write HTML report: ${message(error)}\n`);
      return ExitCode.INCOMPLETE;
    }
  }
  return ExitCode.SUCCESS;
}

async function runOraCommand(args: string[]): Promise<ExitCodeValue> {
  let parsed;
  try {
    parsed = parseArgs({ args, options: ORA_OPTIONS, allowPositionals: true });
  } catch (error) {
    return usageError(message(error), ORA_USAGE);
  }
  if (parsed.values.help) {
    process.stdout.write(ORA_USAGE);
    return ExitCode.SUCCESS;
  }

  let config;
  try {
    config = parseOraConfig({ values: parsed.values, positionals: parsed.positionals });
  } catch (error) {
    return configError(error);
  }

  let result;
  try {
    result = await runOra(config);
  } catch (error) {
    if (error instanceof OraClientError) {
      process.stderr.write(`Error: ${error.message}\n`);
      return ExitCode.INCOMPLETE;
    }
    throw error;
  }

  if (config.output.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (config.output.htmlPath) {
    try {
      await writeFile(config.output.htmlPath, renderOraHtmlReport(result), "utf8");
    } catch (error) {
      process.stderr.write(`Error: could not write HTML report: ${message(error)}\n`);
      return ExitCode.INCOMPLETE;
    }
  }
  return ExitCode.SUCCESS;
}

function configError(error: unknown): ExitCodeValue {
  if (error instanceof ConfigError) {
    process.stderr.write(`Error: ${error.message}\n`);
    return ExitCode.USAGE;
  }
  throw error;
}

function usageError(message: string, usage: string): ExitCodeValue {
  process.stderr.write(`Error: ${message}\n\n${usage}`);
  return ExitCode.USAGE;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`Unexpected error: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(ExitCode.INCOMPLETE);
  });
