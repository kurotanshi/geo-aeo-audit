import { createRequire } from "node:module";

// Same relative path resolves under both src/ (tsx) and dist/ (built) → repo root.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/** Version of the tool binary; sourced from package.json. */
export const TOOL_VERSION = pkg.version;

/** Version of the emitted result JSON envelope. Bump on breaking schema changes. */
export const SCHEMA_VERSION = "1.1.0";

/** Version of the audit ruleset (registry + rule semantics). Bump when rules change. */
export const RULESET_VERSION = "0.4.0";

/** Project URL advertised in the User-Agent. */
export const PROJECT_URL = "https://github.com/kurohsu/geo-aeo-audit";

/** User-Agent sent by every request. Honest self-identification; no crawler spoofing. */
export const USER_AGENT = `geo-aeo-audit/${TOOL_VERSION} (+${PROJECT_URL})`;
