#!/usr/bin/env node
import { parseArgs } from "node:util";
import { parseAuditConfig } from "./config.js";
import { ConfigError, IncompleteAuditError } from "./errors.js";
import { ExitCode, resolveExitCode, type ExitCodeValue } from "./exit.js";
import { runAudit } from "./audit/run.js";
import { TOOL_VERSION } from "./version.js";

const USAGE = `geo-aeo — GEO/AEO static readiness audit

Usage:
  geo-aeo audit <url> [options]
  geo-aeo --help
  geo-aeo --version

Options:
  --site             Audit sampled pages within the final origin (default: single page)
  --fail-on <mode>   Exit non-zero on: blocker | error | never (default: blocker)
  --json             Print JSON result to stdout (default on)
  --no-json          Suppress JSON output
  --html <path>      Write single-file HTML report to <path>
  -h, --help         Show this help
  -v, --version      Show version

Exit codes:
  0  success
  1  audit completed but --fail-on threshold met
  2  CLI usage or configuration error
  3  fetch/audit could not complete
`;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  site: { type: "boolean" },
  "fail-on": { type: "string" },
  json: { type: "boolean" },
  "no-json": { type: "boolean" },
  html: { type: "string" },
} as const;

async function main(): Promise<ExitCodeValue> {
  const args = process.argv.slice(2);

  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n\n${USAGE}`);
    return ExitCode.USAGE;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    return ExitCode.SUCCESS;
  }
  if (values.version) {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return ExitCode.SUCCESS;
  }

  const [command, ...rest] = positionals;
  if (command === undefined) {
    process.stderr.write(`Error: no command given\n\n${USAGE}`);
    return ExitCode.USAGE;
  }
  if (command !== "audit") {
    process.stderr.write(`Error: unknown command "${command}"\n\n${USAGE}`);
    return ExitCode.USAGE;
  }

  let config;
  try {
    config = parseAuditConfig({ values, positionals: rest });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return ExitCode.USAGE;
    }
    throw err;
  }

  let result;
  try {
    result = await runAudit(config);
  } catch (err) {
    if (err instanceof IncompleteAuditError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return ExitCode.INCOMPLETE;
    }
    throw err;
  }

  if (config.output.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (config.output.htmlPath) {
    process.stderr.write("Note: HTML report output is not yet implemented (task 7)\n");
  }

  return resolveExitCode(result, config.failOn);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Unexpected error: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(ExitCode.INCOMPLETE);
  });
