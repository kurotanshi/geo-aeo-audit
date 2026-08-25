import type { ProbeRate, ProbeResult, ProbeRunAttempt } from "../schema/probe.js";
import { escapeHtml, safeHttpUrl } from "./html.js";
import { REPORT_CSP, REPORT_STYLES } from "./styles.js";

export function renderProbeHtmlReport(result: ProbeResult): string {
  const experiment = result.experiment;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">
  <title>Citation probe — ${escapeHtml(result.target.requested_url)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#report-content">Skip to report</a>
  <div class="report-shell">
  <header class="report-header">
    <p class="eyebrow">Citation observation</p>
    <h1>Provider citation probe</h1>
    <p class="target"><code>${escapeHtml(result.target.requested_url)}</code></p>
    <p class="lede">This is an API observation, separate from the static readiness audit. It is not a quality score.</p>
  </header>
  <nav class="report-nav" aria-label="Report sections">
    <a href="#rates">Rates</a><a href="#attempts">Attempts</a><a href="#overlap">Source overlap</a><a href="#experiment">Experiment</a><a href="#limitations">Limitations</a>
  </nav>
  <main id="report-content">
  ${renderRates(result.rates)}
  ${renderAttempts(result.attempts)}
  ${renderOverlaps(result)}
  <section class="report-section" id="experiment">
    <div class="section-heading"><h2>Experiment group</h2></div>
    <div class="table-scroll"><table class="key-value"><tbody>
      ${row("Provider", experiment.provider)}
      ${row("Requested model", experiment.requested_model)}
      ${row("Adapter / API surface", `${experiment.adapter_version} / ${experiment.api_surface}`)}
      ${row("Search settings", JSON.stringify(experiment.search_settings))}
      ${row("Prompts × repeats", `${experiment.prompts.length} × ${experiment.repeats}`)}
      ${row("Generated", result.generated_at)}
      ${row("Schema / tool", `${result.schema_version} / ${result.tool_version}`)}
    </tbody></table></div>
  </section>
  <section class="report-section" id="limitations"><div class="section-heading"><h2>Limitations</h2></div>${list(result.limitations)}</section>
  </main>
  </div>
</body>
</html>
`;
}

function renderRates(rates: ProbeRate[]): string {
  return `<section class="report-section" id="rates">
    <div class="section-heading"><h2>Rates and observable coverage</h2><p>${rates.length} metrics</p></div>
    <div class="table-scroll"><table class="wide-table">
      <thead><tr><th>Metric</th><th>View</th><th>Rate</th><th>Numerator / denominator</th><th>Unknown</th><th>Coverage</th><th>Definition</th></tr></thead>
      <tbody>${rates.map((rate) => `<tr>
        <td><code>${escapeHtml(rate.metric)}</code></td><td>${escapeHtml(rate.view)}</td>
        <td class="metric">${percentage(rate.value)}</td><td>${rate.numerator} / ${rate.denominator}</td>
        <td>${rate.unknown_count}</td><td>${rate.observable_coverage.measured} / ${rate.observable_coverage.total} (${percentage(rate.observable_coverage.value)})</td>
        <td>${escapeHtml(rate.denominator_definition)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

function renderAttempts(attempts: ProbeRunAttempt[]): string {
  return `<section class="report-section" id="attempts">
    <div class="section-heading"><h2>Attempts</h2><p>${attempts.length} runs</p></div>
    ${attempts.map((attempt) => `<details class="record">
      <summary class="record-summary"><span><strong>Attempt #${attempt.ordinal}</strong><span class="finding-context">Prompt ${attempt.prompt_index} · repeat ${attempt.repeat_index} · ${attempt.duration_ms} ms</span></span><span class="status ${outcomeClass(attempt.outcome)}">${escapeHtml(attempt.outcome)}</span></summary>
      <div class="record-content"><div class="table-scroll"><table class="key-value"><tbody>
        ${row("Prompt / repeat", `${attempt.prompt_index} / ${attempt.repeat_index}`)}
        ${row("Prompt", attempt.prompt)}
        ${row("Requested / returned model", `${attempt.requested_model} / ${attempt.returned_model ?? "unavailable"}`)}
        ${row("Started / duration", `${attempt.started_at} / ${attempt.duration_ms} ms`)}
        ${row("Search status", attempt.search_status)}
        ${row("Error", attempt.error.value?.message ?? attempt.error.status)}
      </tbody></table></div>
      ${renderCitations(attempt)}
      <details class="disclosure"><summary>Normalized provider response and final response</summary><pre>${escapeHtml(JSON.stringify(attempt.response, null, 2))}</pre></details></div>
    </details>`).join("")}
  </section>`;
}

function renderCitations(attempt: ProbeRunAttempt): string {
  if (attempt.citations.length === 0) return '<p class="muted">No inline citations exposed for this attempt.</p>';
  return `<h3>Source attribution</h3><div class="table-scroll"><table class="wide-table">
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
  </table></div>`;
}

function renderOverlaps(result: ProbeResult): string {
  if (result.source_overlaps.length === 0) return `<section class="report-section" id="overlap"><div class="section-heading"><h2>Source overlap</h2></div><p class="muted">No comparable completed attempt pairs.</p></section>`;
  return `<section class="report-section" id="overlap"><div class="section-heading"><h2>Source overlap</h2></div><div class="table-scroll"><table class="wide-table">
    <thead><tr><th>Provider / model / settings</th><th>Attempt pair</th><th>URL Jaccard</th><th>Domain Jaccard</th></tr></thead>
    <tbody>${result.source_overlaps.map((pair) => `<tr><td>${escapeHtml(`${pair.provider} / ${pair.requested_model} / ${JSON.stringify(pair.search_settings)}`)}</td><td>${pair.left_ordinal} / ${pair.right_ordinal}</td><td>${decimal(pair.url_source_overlap)}</td><td>${decimal(pair.domain_source_overlap)}</td></tr>`).join("")}</tbody>
  </table></div></section>`;
}

function outcomeClass(outcome: ProbeRunAttempt["outcome"]): string {
  return `outcome-${outcome.replaceAll("_", "-")}`;
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
