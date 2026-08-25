import type { OraResult } from "../schema/ora.js";
import { escapeHtml, safeHttpUrl } from "./html.js";
import { REPORT_CSP, REPORT_STYLES } from "./styles.js";

export function renderOraHtmlReport(result: OraResult): string {
  const score = scalar(result.ora.score);
  const grade = scalar(result.ora.grade);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">
  <title>Ora readiness — ${escapeHtml(score)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#report-content">Skip to report</a>
  <div class="report-shell">
  <header class="report-header">
    <p class="eyebrow">External readiness snapshot</p>
    <h1>Ora agent readiness</h1>
    <p class="metric">Ora score ${escapeHtml(score)}/100 (grade ${escapeHtml(grade)})</p>
    <p class="lede">This is Ora's score and methodology, kept separate from geo-aeo-audit scorecards.</p>
  </header>
  <nav class="report-nav" aria-label="Report sections">
    <a href="#fixes">Top fixes</a><a href="#essentials">Essentials</a><a href="#layers">Layers</a><a href="#crosswalk">Crosswalk</a><a href="#metadata">Metadata</a><a href="#limitations">Limitations</a>
  </nav>
  <main id="report-content">
    ${renderTopFixes(result.ora.topFixes)}
    ${renderEssentials(result.ora.essentials)}
    ${renderLayers(result.ora.layers)}
    ${renderCrosswalk(result)}
    ${renderMetadata(result)}
    <section class="report-section" id="limitations"><div class="section-heading"><h2>Limitations</h2></div>${list(result.limitations)}</section>
  </main>
  </div>
</body>
</html>
`;
}

function renderMetadata(result: OraResult): string {
  return `<section class="report-section" id="metadata"><div class="section-heading"><h2>Snapshot metadata</h2></div><div class="table-scroll"><table class="key-value"><tbody>
    ${row("Generated", result.generated_at)}
    ${row("Ora scanned at", result.ora.scannedAt)}
    ${row("Analysis status", result.ora.analysisStatus)}
    ${row("Contract / schema / tool", `${scalar(result.ora.contractVersion)} / ${result.schema_version} / ${result.tool_version}`)}
    ${row("Request mode / polls", `${result.request.mode} / ${result.request.polls}`)}
    ${row("Ora endpoint", result.request.endpoint)}
  </tbody></table></div></section>`;
}

function renderEssentials(value: unknown): string {
  const essentials = object(value);
  if (essentials === null) return '<section class="report-section" id="essentials"><div class="section-heading"><h2>Essentials</h2></div><p class="muted">Essentials data unavailable.</p></section>';
  return `<section class="report-section" id="essentials"><div class="section-heading"><h2>Essentials</h2></div><div class="table-scroll"><table class="key-value"><tbody>
    ${row("Score", essentials.score)}
    ${row("Label", essentials.label ?? essentials.scoreLabel)}
    ${row("Required", essentials.required)}
    ${row("Recommended", essentials.recommended)}
  </tbody></table></div></section>`;
}

function renderTopFixes(value: unknown): string {
  const fixes = arrayOfObjects(value);
  return `<section class="report-section" id="fixes"><div class="section-heading"><h2>Top fixes (${fixes.length})</h2><p>Prioritized recommendations</p></div>${
    fixes.length === 0
      ? '<p class="muted">No top fixes were returned.</p>'
      : `<ol class="priority-list">${fixes.map((fix, index) => `<li>
        <p>${index === 0 ? '<span class="next">Next up</span> ' : ""}<strong>${escapeHtml(fix.name ?? fix.id)}</strong></p>
        <p>${escapeHtml(fix.recommendation ?? fix.details)}</p>
        <p>Estimated score gain: <strong>${escapeHtml(fix.estScoreGain)}</strong> (estimate)</p>
        ${safeLink(fix.specUrl ?? fix.url, "Reference")}
      </li>`).join("")}</ol>`
  }</section>`;
}

function renderLayers(value: unknown): string {
  const layers = arrayOfObjects(value);
  return `<section class="report-section" id="layers"><div class="section-heading"><h2>Layer scores</h2></div>${
    layers.length === 0
      ? '<p class="muted">No layer scores were returned.</p>'
      : `<div class="table-scroll"><table><thead><tr><th>Layer</th><th>Score</th><th>Maximum</th></tr></thead><tbody>${layers
          .map((layer) => `<tr><td>${escapeHtml(layer.name ?? layer.id)}</td><td>${escapeHtml(layer.score)}</td><td>${escapeHtml(layer.maxScore)}</td></tr>`)
          .join("")}</tbody></table></div>`
  }</section>`;
}

function renderCrosswalk(result: OraResult): string {
  return `<section class="report-section" id="crosswalk"><div class="section-heading"><h2>Ora-to-local crosswalk</h2></div>
    <p class="muted">Mappings describe overlap; only rows explicitly marked equivalent claim matching semantics.</p>
    <div class="table-scroll"><table class="wide-table"><thead><tr><th>Ora check</th><th>Mapping</th><th>Local rules</th><th>Explanation</th></tr></thead>
    <tbody>${result.crosswalk.map((item) => `<tr>
      <td><code>${escapeHtml(item.ora_id)}</code></td><td>${escapeHtml(item.mapping)}</td>
      <td>${item.local_rule_ids.length === 0 ? "—" : item.local_rule_ids.map((id) => `<code>${escapeHtml(id)}</code>`).join("<br>")}</td>
      <td>${escapeHtml(item.explanation)}</td>
    </tr>`).join("")}</tbody></table></div></section>`;
}

function row(label: string, value: unknown): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function list(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function safeLink(value: unknown, label: string): string {
  const href = safeHttpUrl(value);
  return href === null ? "" : `<p><a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(label)}</a></p>`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "unavailable";
}
