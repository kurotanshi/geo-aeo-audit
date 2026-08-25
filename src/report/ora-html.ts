import type { OraResult } from "../schema/ora.js";
import { escapeHtml, safeHttpUrl } from "./html.js";

const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export function renderOraHtmlReport(result: OraResult): string {
  const score = scalar(result.ora.score);
  const grade = scalar(result.ora.grade);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>Ora readiness — ${escapeHtml(score)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 1120px; padding: 2rem; line-height: 1.5; }
    h1, h2 { line-height: 1.2; } h2 { margin-top: 2.5rem; border-bottom: 1px solid #8886; padding-bottom: .35rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #8886; padding: .55rem; text-align: left; vertical-align: top; }
    th { background: #8882; } code { overflow-wrap: anywhere; }
    .metric { font-size: 1.8rem; font-weight: 700; } .muted { color: #777; }
    .next { display: inline-block; border: 1px solid #18794e; border-radius: 1rem; padding: .1rem .5rem; color: #18794e; }
    @media (max-width: 720px) { body { padding: 1rem; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>Ora agent readiness</h1>
    <p class="metric">Ora score ${escapeHtml(score)}/100 (grade ${escapeHtml(grade)})</p>
    <p class="muted">This is Ora's score and methodology, kept separate from geo-aeo-audit scorecards.</p>
  </header>
  ${renderMetadata(result)}
  ${renderEssentials(result.ora.essentials)}
  ${renderTopFixes(result.ora.topFixes)}
  ${renderLayers(result.ora.layers)}
  ${renderCrosswalk(result)}
  <section><h2>Limitations</h2>${list(result.limitations)}</section>
</body>
</html>
`;
}

function renderMetadata(result: OraResult): string {
  return `<section><h2>Snapshot metadata</h2><table><tbody>
    ${row("Generated", result.generated_at)}
    ${row("Ora scanned at", result.ora.scannedAt)}
    ${row("Analysis status", result.ora.analysisStatus)}
    ${row("Contract / schema / tool", `${scalar(result.ora.contractVersion)} / ${result.schema_version} / ${result.tool_version}`)}
    ${row("Request mode / polls", `${result.request.mode} / ${result.request.polls}`)}
    ${row("Ora endpoint", result.request.endpoint)}
  </tbody></table></section>`;
}

function renderEssentials(value: unknown): string {
  const essentials = object(value);
  if (essentials === null) return '<section><h2>Essentials</h2><p class="muted">Essentials data unavailable.</p></section>';
  return `<section><h2>Essentials</h2><table><tbody>
    ${row("Score", essentials.score)}
    ${row("Label", essentials.label ?? essentials.scoreLabel)}
    ${row("Required", essentials.required)}
    ${row("Recommended", essentials.recommended)}
  </tbody></table></section>`;
}

function renderTopFixes(value: unknown): string {
  const fixes = arrayOfObjects(value);
  return `<section><h2>Top fixes (${fixes.length})</h2>${
    fixes.length === 0
      ? '<p class="muted">No top fixes were returned.</p>'
      : `<ol>${fixes.map((fix, index) => `<li>
        <p>${index === 0 ? '<span class="next">Next up</span> ' : ""}<strong>${escapeHtml(fix.name ?? fix.id)}</strong></p>
        <p>${escapeHtml(fix.recommendation ?? fix.details)}</p>
        <p>Estimated score gain: <strong>${escapeHtml(fix.estScoreGain)}</strong> (estimate)</p>
        ${safeLink(fix.specUrl ?? fix.url, "Reference")}
      </li>`).join("")}</ol>`
  }</section>`;
}

function renderLayers(value: unknown): string {
  const layers = arrayOfObjects(value);
  return `<section><h2>Layer scores</h2>${
    layers.length === 0
      ? '<p class="muted">No layer scores were returned.</p>'
      : `<table><thead><tr><th>Layer</th><th>Score</th><th>Maximum</th></tr></thead><tbody>${layers
          .map((layer) => `<tr><td>${escapeHtml(layer.name ?? layer.id)}</td><td>${escapeHtml(layer.score)}</td><td>${escapeHtml(layer.maxScore)}</td></tr>`)
          .join("")}</tbody></table>`
  }</section>`;
}

function renderCrosswalk(result: OraResult): string {
  return `<section><h2>Ora-to-local crosswalk</h2>
    <p class="muted">Mappings describe overlap; only rows explicitly marked equivalent claim matching semantics.</p>
    <table><thead><tr><th>Ora check</th><th>Mapping</th><th>Local rules</th><th>Explanation</th></tr></thead>
    <tbody>${result.crosswalk.map((item) => `<tr>
      <td><code>${escapeHtml(item.ora_id)}</code></td><td>${escapeHtml(item.mapping)}</td>
      <td>${item.local_rule_ids.length === 0 ? "—" : item.local_rule_ids.map((id) => `<code>${escapeHtml(id)}</code>`).join("<br>")}</td>
      <td>${escapeHtml(item.explanation)}</td>
    </tr>`).join("")}</tbody></table></section>`;
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
