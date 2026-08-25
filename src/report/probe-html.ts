import type { ProbeRate, ProbeResult, ProbeRunAttempt } from "../schema/probe.js";
import { escapeHtml, safeHttpUrl } from "./html.js";

const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export function renderProbeHtmlReport(result: ProbeResult): string {
  const experiment = result.experiment;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>Citation probe — ${escapeHtml(result.target.requested_url)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 1180px; padding: 2rem; line-height: 1.5; }
    h1, h2 { line-height: 1.2; } h2 { margin-top: 2.5rem; border-bottom: 1px solid #8886; padding-bottom: .35rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #8886; padding: .55rem; text-align: left; vertical-align: top; }
    th { background: #8882; } code, pre { overflow-wrap: anywhere; white-space: pre-wrap; }
    .muted { color: #777; } .metric { font-variant-numeric: tabular-nums; font-weight: 700; }
    .outcome-provider_error, .outcome-timeout, .outcome-normalization_error, .outcome-completed_tool_error { color: #b42318; }
    @media (max-width: 760px) { body { padding: 1rem; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>Provider citation probe</h1>
    <p><code>${escapeHtml(result.target.requested_url)}</code></p>
    <p class="muted">This is an API observation, separate from the static readiness audit. It is not a quality score.</p>
  </header>
  <section>
    <h2>Experiment group</h2>
    <table><tbody>
      ${row("Provider", experiment.provider)}
      ${row("Requested model", experiment.requested_model)}
      ${row("Adapter / API surface", `${experiment.adapter_version} / ${experiment.api_surface}`)}
      ${row("Search settings", JSON.stringify(experiment.search_settings))}
      ${row("Prompts × repeats", `${experiment.prompts.length} × ${experiment.repeats}`)}
      ${row("Generated", result.generated_at)}
      ${row("Schema / tool", `${result.schema_version} / ${result.tool_version}`)}
    </tbody></table>
  </section>
  ${renderRates(result.rates)}
  ${renderAttempts(result.attempts)}
  ${renderOverlaps(result)}
  <section><h2>Limitations</h2>${list(result.limitations)}</section>
</body>
</html>
`;
}

function renderRates(rates: ProbeRate[]): string {
  return `<section>
    <h2>Rates and observable coverage</h2>
    <table>
      <thead><tr><th>Metric</th><th>View</th><th>Rate</th><th>Numerator / denominator</th><th>Unknown</th><th>Coverage</th><th>Definition</th></tr></thead>
      <tbody>${rates.map((rate) => `<tr>
        <td><code>${escapeHtml(rate.metric)}</code></td><td>${escapeHtml(rate.view)}</td>
        <td class="metric">${percentage(rate.value)}</td><td>${rate.numerator} / ${rate.denominator}</td>
        <td>${rate.unknown_count}</td><td>${rate.observable_coverage.measured} / ${rate.observable_coverage.total} (${percentage(rate.observable_coverage.value)})</td>
        <td>${escapeHtml(rate.denominator_definition)}</td>
      </tr>`).join("")}</tbody>
    </table>
  </section>`;
}

function renderAttempts(attempts: ProbeRunAttempt[]): string {
  return `<section>
    <h2>Attempts (${attempts.length})</h2>
    ${attempts.map((attempt) => `<article>
      <h3>#${attempt.ordinal}: <span class="outcome-${escapeHtml(attempt.outcome)}">${escapeHtml(attempt.outcome)}</span></h3>
      <table><tbody>
        ${row("Prompt / repeat", `${attempt.prompt_index} / ${attempt.repeat_index}`)}
        ${row("Prompt", attempt.prompt)}
        ${row("Requested / returned model", `${attempt.requested_model} / ${attempt.returned_model ?? "unavailable"}`)}
        ${row("Started / duration", `${attempt.started_at} / ${attempt.duration_ms} ms`)}
        ${row("Search status", attempt.search_status)}
        ${row("Error", attempt.error.value?.message ?? attempt.error.status)}
      </tbody></table>
      ${renderCitations(attempt)}
      <details><summary>Normalized provider response and final response</summary><pre>${escapeHtml(JSON.stringify(attempt.response, null, 2))}</pre></details>
    </article>`).join("")}
  </section>`;
}

function renderCitations(attempt: ProbeRunAttempt): string {
  if (attempt.citations.length === 0) return '<p class="muted">No inline citations exposed for this attempt.</p>';
  return `<h4>Source attribution</h4><table>
    <thead><tr><th>Source</th><th>Answer span</th><th>Source excerpt</th><th>Target match</th></tr></thead>
    <tbody>${attempt.citations.map((citation) => {
      const url = citation.url.value;
      const href = safeHttpUrl(url);
      const source = href === null
        ? `<code>${escapeHtml(url ?? citation.url.status)}</code>`
        : `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(citation.title.value ?? href)}</a><br><code>${escapeHtml(href)}</code>`;
      const span = citation.answer_span.value;
      return `<tr><td>${source}</td><td>${span === null ? escapeHtml(citation.answer_span.status) : `${span.start}–${span.end}`}</td><td>${escapeHtml(citation.source_excerpt.value ?? citation.source_excerpt.status)}</td><td>${escapeHtml(citation.target_match?.level ?? "no match")}</td></tr>`;
    }).join("")}</tbody>
  </table>`;
}

function renderOverlaps(result: ProbeResult): string {
  if (result.source_overlaps.length === 0) return `<section><h2>Source overlap</h2><p class="muted">No comparable completed attempt pairs.</p></section>`;
  return `<section><h2>Source overlap</h2><table>
    <thead><tr><th>Provider / model / settings</th><th>Attempt pair</th><th>URL Jaccard</th><th>Domain Jaccard</th></tr></thead>
    <tbody>${result.source_overlaps.map((pair) => `<tr><td>${escapeHtml(`${pair.provider} / ${pair.requested_model} / ${JSON.stringify(pair.search_settings)}`)}</td><td>${pair.left_ordinal} / ${pair.right_ordinal}</td><td>${decimal(pair.url_source_overlap)}</td><td>${decimal(pair.domain_source_overlap)}</td></tr>`).join("")}</tbody>
  </table></section>`;
}

function row(label: string, value: unknown): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function list(items: string[]): string {
  return items.length === 0 ? '<p class="muted">None</p>' : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function percentage(value: number | null): string {
  return value === null ? "not available" : `${(value * 100).toFixed(1)}%`;
}

function decimal(value: number | null): string {
  return value === null ? "not available" : value.toFixed(3);
}
