# geo-aeo-audit

`geo-aeo-audit` is a read-only CLI for reproducible GEO/AEO static-readiness audits of public HTTP(S) pages. It checks bounded technical access, crawler policies, discovery signals, static content, entities, and evidence signals without calling a model API or modifying the audited site.

The report describes observable readiness and provider-specific eligibility controls. It does not predict citation probability and does not produce a single overall score.

## Requirements and build

- Node.js 20 or newer
- pnpm 11

```bash
pnpm install
pnpm run build
node dist/cli.js --help
```

For development without a separate build step:

```bash
pnpm dev audit https://example.com/
```

The package exposes the `geo-aeo` binary when installed or linked as a package.

## Usage

Audit one page and print JSON to stdout:

```bash
geo-aeo audit https://example.com/article
```

Audit a deterministic sample from same-origin sitemaps and also write a standalone HTML report:

```bash
geo-aeo audit https://example.com/ --site --html audit.html > audit.json
```

Write only HTML:

```bash
geo-aeo audit https://example.com/ --no-json --html audit.html
```

### Options

- `--site` — discover and audit a bounded, deterministic sample within the final URL's origin. Single-page mode is the default.
- `--fail-on <blocker|error|never>` — select the exit-code threshold. The default is `blocker`.
- `--json` / `--no-json` — enable or suppress JSON stdout. JSON is enabled by default.
- `--html <path>` — write a self-contained HTML report to the selected path.
- `-h`, `--help` — show CLI help.
- `-v`, `--version` — show the tool version.

## Reports

The JSON envelope follows [schemas/audit-result.schema.json](schemas/audit-result.schema.json). It includes:

- `schema_version`, `tool_version`, and `ruleset_version`;
- the requested and conservatively normalized URL;
- URL-normalization, deterministic-sampling, resource-limit, and PSL-use metadata;
- per-rule findings and product-scoped blockers;
- five category scorecards with measurement coverage;
- sampled URL, SHA-256 hash, and fetch/robots state in site mode.

Site scope is based on the exact final origin, so a Public Suffix List is not used. The JSON records this explicitly with `public_suffix_list.used: false` and null package/data versions.

The HTML report contains the same audit information, inline CSS, and a restrictive Content Security Policy. It contains no JavaScript, does not embed raw JSON, HTML-encodes untrusted values, and only creates links for validated HTTP(S) source URLs.

### Finding results

| Result | Meaning |
|---|---|
| `pass` | The bounded static observation satisfied the rule. |
| `fail` | The observation did not satisfy the rule. |
| `not_applicable` | The rule does not apply, such as article-only guidance on a non-article page. |
| `not_tested` | A robots, fetch, rendering, or other measurement limitation prevented the check. |
| `error` | The measurement itself failed; this is not converted into a rule failure. |

Every finding records an evidence kind and claim scope. `heuristic` findings are marked experimental, and informational/experimental findings do not enter category scores. `not_applicable`, `not_tested`, and `error` are excluded from score denominators; unmeasured rules remain visible in measurement coverage.

## Security and crawler behavior

- Only public global-unicast HTTP(S) targets are allowed.
- Every initial URL, DNS result, and redirect is validated before connection.
- Connections use a verified IP while HTTP Host, TLS SNI, and certificate checks retain the original hostname.
- Environment proxies and implicit transport-level hostname re-resolution are not used.
- Redirects, headers, compressed/decompressed responses, total bytes, sitemap traversal, page count, concurrency, and time are bounded.
- The CLI identifies itself with its own User-Agent and follows robots.txt as the generic `geo-aeo-audit` crawler. Provider crawler rules are reported separately according to each documented product scope.
- Site mode samples only the final origin. Out-of-scope discoveries and robots-blocked samples are not fetched.

## Measurement limitations

This is a static HTTP audit, not a browser renderer. When the initial HTML appears to require client-side rendering, the report emits `not_tested` with “需要瀏覽器渲染才能確認”; it does not claim the content is absent or unusable by every AI product.

Provider network-path reachability, WAF allowlists, live indexing state, ranking, retrieval, answer generation, and citation probability cannot be proven by this audit. Officially unconfirmed product surfaces are reported as risk signals or under `not_asserted_for`, not as definitive eligibility blockers.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Audit completed and the selected threshold was not met, or `--fail-on never` was used. |
| 1 | Audit completed but the selected `--fail-on` threshold was met. |
| 2 | CLI usage or configuration error. |
| 3 | The audit process or requested report output could not complete. |

`--fail-on blocker` returns 1 when any blocker is emitted. `--fail-on error` returns 1 for blockers or `error` findings. Ordinary non-blocking `fail` findings do not independently change the exit code. Transport failures that can be represented in a completed report are emitted as `transport_or_protocol` blockers and follow the selected threshold.

## Tests

```bash
pnpm run typecheck
pnpm test
```

The test suite builds the CLI and runs unit, local-fixture integration, JSON Schema compatibility, HTML-safety, and CLI end-to-end tests. Tests do not access real public sites, call model APIs, or modify audited sites.
