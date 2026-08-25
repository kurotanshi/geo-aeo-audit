import type {
  AuditResult,
  Blocker,
  CategoryScorecard,
  Finding,
} from "../schema/result.js";

const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/** Render a self-contained static report. Every dynamic value is HTML-escaped. */
export function renderHtmlReport(result: AuditResult): string {
  const transportErrors = result.blockers.filter(
    (blocker) => blocker.kind === "transport_or_protocol",
  );
  const measurementLimitations = result.findings.filter(
    (finding) => finding.result === "not_tested" || finding.result === "error",
  );
  const notTested = result.findings.filter((finding) => finding.result === "not_tested");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>GEO/AEO audit — ${escapeHtml(result.target.normalized_url)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 1120px; padding: 2rem; line-height: 1.5; }
    h1, h2 { line-height: 1.2; }
    h2 { margin-top: 2.5rem; border-bottom: 1px solid #8886; padding-bottom: .35rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #8886; padding: .55rem; text-align: left; vertical-align: top; }
    th { background: #8882; }
    code { overflow-wrap: anywhere; }
    ul { margin: .25rem 0; padding-left: 1.25rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; }
    .card { border: 1px solid #8886; border-radius: .5rem; padding: 1rem; }
    .metric { font-size: 1.55rem; font-weight: 700; }
    .muted { color: #777; }
    .result-pass { color: #18794e; }
    .result-fail, .result-error { color: #b42318; }
    .result-not-tested { color: #9a6700; }
    .result-not-applicable { color: #667085; }
    @media (max-width: 720px) { body { padding: 1rem; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>GEO/AEO static readiness audit</h1>
    <p><code>${escapeHtml(result.target.normalized_url)}</code></p>
    <p class="muted">Category scores summarize measured static rules. They are not a citation-probability estimate and are not combined into a total score.</p>
  </header>
  ${renderVersions(result)}
  ${renderScorecards(result.scorecards)}
  ${renderBlockers(result.blockers)}
  ${renderTransportErrors(transportErrors)}
  ${renderLimitations(measurementLimitations)}
  ${renderNotTested(notTested)}
  ${renderFindings(result.findings)}
</body>
</html>
`;
}

function renderVersions(result: AuditResult): string {
  const metadata = result.metadata;
  const psl = metadata.public_suffix_list;
  return `<section>
    <h2>Report metadata</h2>
    <table>
      <tbody>
        ${row("Generated", result.generated_at)}
        ${row("Mode", result.target.mode)}
        ${row("Requested URL", result.target.requested_url)}
        ${row("Normalized URL", result.target.normalized_url)}
        ${row("Schema version", result.schema_version)}
        ${row("Tool version", result.tool_version)}
        ${row("Ruleset version", result.ruleset_version)}
        ${row("URL normalization", metadata.url_normalization.version)}
        ${row(
          "Sampling",
          metadata.sampling.applied
            ? `${metadata.sampling.method} / ${metadata.sampling.hash_algorithm} / seed ${metadata.sampling.seed}`
            : "not applied (single-page mode)",
        )}
        ${row(
          "Public Suffix List",
          psl.used
            ? `${display(psl.package_name)} ${display(psl.package_version)} / data ${display(psl.data_version)}`
            : `not used; scope basis: ${psl.scope_basis}`,
        )}
      </tbody>
    </table>
    ${renderSamples(metadata.sampling.selected)}
    <details>
      <summary>Resource limits</summary>
      <pre>${escapeHtml(JSON.stringify(metadata.limits, null, 2))}</pre>
    </details>
  </section>`;
}

function renderSamples(samples: AuditResult["metadata"]["sampling"]["selected"]): string {
  if (samples.length === 0) return "";
  return `<h3>Deterministic sample</h3>
    <table>
      <thead><tr><th>URL</th><th>SHA-256 hash</th><th>State</th></tr></thead>
      <tbody>${samples
        .map(
          (sample) =>
            `<tr><td><code>${escapeHtml(sample.url)}</code></td><td><code>${escapeHtml(sample.hash)}</code></td><td>${escapeHtml(sample.state)}</td></tr>`,
        )
        .join("")}</tbody>
    </table>`;
}

function renderScorecards(scorecards: readonly CategoryScorecard[]): string {
  return `<section>
    <h2>Category scorecards</h2>
    <div class="cards">${scorecards
      .map(
        (card) => `<article class="card">
          <h3>${escapeHtml(card.category)}</h3>
          <div class="metric">${percentage(card.score.value)}</div>
          <p>${card.score.passed} passed / ${card.score.failed} failed / ${card.score.denominator} scored</p>
          <p>Measurement coverage: <strong>${percentage(card.measurement_coverage.value)}</strong></p>
          <p>${card.measurement_coverage.measured} measured / ${card.measurement_coverage.applicable} applicable; ${card.measurement_coverage.not_tested} NOT_TESTED; ${card.measurement_coverage.errors} errors</p>
          <p class="muted">Excluded: ${card.excluded_from_score.informational} informational, ${card.excluded_from_score.experimental} experimental, ${card.excluded_from_score.unclassified} unclassified, ${card.excluded_from_score.unmeasured} unmeasured.</p>
        </article>`,
      )
      .join("")}</div>
  </section>`;
}

function renderBlockers(blockers: readonly Blocker[]): string {
  return `<section>
    <h2>Blockers (${blockers.length})</h2>
    ${
      blockers.length === 0
        ? empty("No blockers were emitted.")
        : `<table>
      <thead><tr><th>Kind / rule</th><th>Subject and evidence</th><th>Scope</th></tr></thead>
      <tbody>${blockers
        .map(
          (blocker) => `<tr>
          <td><strong>${escapeHtml(blocker.kind)}</strong><br><code>${escapeHtml(blocker.rule_id)}</code></td>
          <td>${optionalCode(blocker.subject_url)}${renderList(blocker.evidence)}</td>
          <td><strong>Applies to</strong>${renderList(blocker.applies_to)}<strong>Not asserted for</strong>${renderList(blocker.not_asserted_for)}</td>
        </tr>`,
        )
        .join("")}</tbody>
    </table>`
    }
  </section>`;
}

function renderTransportErrors(blockers: readonly Blocker[]): string {
  return `<section>
    <h2>Transport and protocol errors (${blockers.length})</h2>
    ${
      blockers.length === 0
        ? empty("No transport or protocol blocker was emitted.")
        : blockers
            .map(
              (blocker) => `<article class="card">
        <h3><code>${escapeHtml(blocker.rule_id)}</code></h3>
        ${optionalCode(blocker.subject_url)}${renderList(blocker.evidence)}
      </article>`,
            )
            .join("")
    }
  </section>`;
}

function renderLimitations(findings: readonly Finding[]): string {
  return `<section>
    <h2>Measurement limitations (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty("No measurement limitation or measurement error was emitted.")
        : `<ul>${findings
            .map(
              (finding) =>
                `<li><code>${escapeHtml(finding.id)}</code> — ${escapeHtml(finding.result)}: ${escapeHtml(finding.rationale)}</li>`,
            )
            .join("")}</ul>`
    }
  </section>`;
}

function renderNotTested(findings: readonly Finding[]): string {
  return `<section>
    <h2>NOT_TESTED items (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty("Every applicable rule was tested or reported as an error.")
        : `<ul>${findings
            .map(
              (finding) =>
                `<li><code>${escapeHtml(finding.id)}</code>${optionalCode(finding.subject_url)} — ${escapeHtml(finding.rationale)}</li>`,
            )
            .join("")}</ul>`
    }
  </section>`;
}

function renderFindings(findings: readonly Finding[]): string {
  return `<section>
    <h2>Findings (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty("No findings were emitted.")
        : `<table>
      <thead><tr><th>Rule / result</th><th>Evidence and rationale</th><th>Recommendation and scope</th></tr></thead>
      <tbody>${findings.map(renderFinding).join("")}</tbody>
    </table>`
    }
  </section>`;
}

function renderFinding(finding: Finding): string {
  return `<tr>
    <td><code>${escapeHtml(finding.id)}</code><br><strong class="${resultClass(finding.result)}">${escapeHtml(finding.result)}</strong><br>${escapeHtml(finding.category)} / ${escapeHtml(finding.score_impact)}${optionalCode(finding.subject_url)}</td>
    <td>${renderList(finding.evidence)}<p>${escapeHtml(finding.rationale)}</p></td>
    <td><p>${escapeHtml(finding.recommendation)}</p><p>Evidence kind: ${escapeHtml(finding.evidence_kind)}</p><p>Claim scope: ${escapeHtml(finding.claim_scope)}</p>${sourceLink(finding.source_url)}</td>
  </tr>`;
}

function sourceLink(value: unknown): string {
  const href = safeHttpUrl(value);
  if (href === null) return "";
  return `<p><a href="${escapeHtml(href)}" rel="noreferrer noopener">Official or standards source</a></p>`;
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function row(label: string, value: unknown): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function renderList(value: unknown): string {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (items.length === 0) return '<p class="muted">None</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function optionalCode(value: unknown): string {
  return value === undefined ? "" : `<br><code>${escapeHtml(value)}</code>`;
}

function resultClass(result: Finding["result"]): string {
  return `result-${result.replaceAll("_", "-")}`;
}

function percentage(value: number | null): string {
  return value === null ? "Not scored" : `${value}%`;
}

function empty(message: string): string {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

export function escapeHtml(value: unknown): string {
  return display(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(display).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
