# geo-aeo-audit

CLI for reproducible GEO/AEO static readiness audits of public web pages.

> Early skeleton. The secure transport, discovery/sampling, rule engine, and
> HTML report land in subsequent tasks; today `runAudit` returns an empty,
> versioned result envelope.

## Install / build

```bash
pnpm install
pnpm build      # tsc → dist/
```

## Run

```bash
pnpm dev audit https://example.com/          # via tsx (no build needed)
node dist/cli.js audit https://example.com/  # after build
geo-aeo --help                               # once installed/linked
```

## Options

- `--site` — audit sampled pages within the final origin (default: single page)
- `--fail-on <blocker|error|never>` — exit-code threshold (default: `blocker`)
- `--json` / `--no-json` — JSON to stdout (default on)
- `--html <path>` — single-file HTML report (not yet implemented)

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | audit completed but `--fail-on` threshold met |
| 2 | CLI usage or configuration error |
| 3 | fetch/audit could not complete |

## Test

```bash
pnpm test       # builds, then runs vitest (unit + CLI e2e)
```
