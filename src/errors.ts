/** CLI usage or configuration error → exit code USAGE. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** The fetch/audit could not be completed at all → exit code INCOMPLETE. */
export class IncompleteAuditError extends Error {
  override name = "IncompleteAuditError";
}
