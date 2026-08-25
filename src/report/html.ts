import type {
  AuditResult,
  Blocker,
  CategoryScorecard,
  Finding,
} from "../schema/result.js";
import type { HtmlLanguage } from "../config.js";

const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/** Render a self-contained static report. Every dynamic value is HTML-escaped. */
export function renderHtmlReport(result: AuditResult, language: HtmlLanguage = "en"): string {
  const transportErrors = result.blockers.filter(
    (blocker) => blocker.kind === "transport_or_protocol",
  );
  const measurementLimitations = result.findings.filter(
    (finding) => finding.result === "not_tested" || finding.result === "error",
  );
  const notTested = result.findings.filter((finding) => finding.result === "not_tested");

  return `<!doctype html>
<html lang="${language === "zh-TW" ? "zh-Hant" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>${text(language, "GEO/AEO audit", "GEO/AEO 稽核報告")} — ${escapeHtml(result.target.normalized_url)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --page: #f5f7fa;
      --surface: #ffffff;
      --surface-muted: #f0f3f7;
      --text: #182230;
      --muted: #5d6978;
      --border: #ccd4df;
      --accent: #275dad;
      --focus: #1769d2;
      --pass: #087443;
      --pass-bg: #e8f7ef;
      --fail: #b42318;
      --fail-bg: #fff0ee;
      --warning: #8a5700;
      --warning-bg: #fff4d6;
      --neutral: #546274;
      --neutral-bg: #edf1f5;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page: #111820;
        --surface: #18212b;
        --surface-muted: #222d39;
        --text: #edf2f7;
        --muted: #b3bfcc;
        --border: #3b4958;
        --accent: #8bb9ff;
        --focus: #9bc3ff;
        --pass: #76d6a6;
        --pass-bg: #173a2a;
        --fail: #ff9b93;
        --fail-bg: #48231f;
        --warning: #f5c66b;
        --warning-bg: #443717;
        --neutral: #c5ced8;
        --neutral-bg: #303b47;
      }
    }
    * { box-sizing: border-box; }
    html { background: var(--page); }
    body {
      margin: 0 auto;
      max-width: 1200px;
      padding: clamp(1rem, 4vw, 3rem);
      color: var(--text);
      background: var(--surface);
      line-height: 1.6;
    }
    h1, h2, h3 { line-height: 1.25; }
    h1 { margin: 0; font-size: clamp(1.75rem, 4vw, 2.6rem); letter-spacing: -.025em; }
    h2 { margin-top: 2.75rem; border-bottom: 1px solid var(--border); padding-bottom: .5rem; }
    h3 { margin: 0 0 .75rem; }
    a { color: var(--accent); text-underline-offset: .15em; }
    a:hover { text-decoration-thickness: .15em; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; word-break: break-word; }
    pre { overflow-x: auto; padding: 1rem; background: var(--surface-muted); border-radius: .5rem; }
    ul { margin: .4rem 0; padding-left: 1.35rem; }
    p { margin: .55rem 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: .65rem .75rem; text-align: left; vertical-align: top; }
    th { background: var(--surface-muted); }
    .skip-link { position: absolute; left: 1rem; top: -5rem; padding: .6rem .8rem; background: var(--surface); z-index: 1; }
    .skip-link:focus { top: 1rem; }
    .report-header { padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
    .table-scroll { margin: 1rem 0; overflow-x: auto; }
    .wide-table { min-width: 42rem; }
    .disclosure { margin: 1rem 0; border: 1px solid var(--border); border-radius: .5rem; }
    .disclosure > summary { cursor: pointer; padding: .75rem 1rem; font-weight: 700; }
    .disclosure > :not(summary) { margin-right: 1rem; margin-left: 1rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1rem; }
    .card { border: 1px solid var(--border); border-radius: .65rem; padding: 1rem; background: var(--surface); }
    .metric { font-size: 1.55rem; font-weight: 750; }
    .muted { color: var(--muted); }
    .finding-list { display: grid; gap: .75rem; }
    .finding { border: 1px solid var(--border); border-inline-start: .3rem solid var(--neutral); border-radius: .65rem; background: var(--surface); }
    .finding.result-pass { border-inline-start-color: var(--pass); }
    .finding.result-fail, .finding.result-error { border-inline-start-color: var(--fail); }
    .finding.result-not-tested { border-inline-start-color: var(--warning); }
    .finding > summary { cursor: pointer; padding: .9rem 1rem; }
    .finding > summary:hover { background: var(--surface-muted); }
    .finding-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; min-width: 0; }
    .finding-title { display: grid; gap: .25rem; min-width: 0; }
    .finding-context { color: var(--muted); font-size: .875rem; }
    .status { flex: none; border-radius: 999px; padding: .18rem .6rem; font-size: .8rem; font-weight: 750; }
    .status.result-pass { color: var(--pass); background: var(--pass-bg); }
    .status.result-fail, .status.result-error { color: var(--fail); background: var(--fail-bg); }
    .status.result-not-tested { color: var(--warning); background: var(--warning-bg); }
    .status.result-not-applicable { color: var(--neutral); background: var(--neutral-bg); }
    .finding-content { padding: 0 1rem 1rem; border-top: 1px solid var(--border); }
    .finding-subject { margin: .8rem 0; color: var(--muted); }
    .finding-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 1fr); gap: 1.25rem; }
    .finding-panel { min-width: 0; padding-top: 1rem; }
    .finding-panel h3 { font-size: 1rem; }
    .finding-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .25rem .75rem; margin: .8rem 0; }
    .finding-facts dt { color: var(--muted); }
    .finding-facts dd { margin: 0; overflow-wrap: anywhere; }
    @media (max-width: 720px) {
      body { padding: 1rem .75rem; }
      h2 { margin-top: 2.25rem; }
      .finding-summary { display: grid; }
      .finding-grid { grid-template-columns: 1fr; gap: 0; }
      .status { justify-self: start; }
    }
    @media print {
      :root { color-scheme: light; --page: #fff; --surface: #fff; --surface-muted: #f3f4f6; --text: #111827; --muted: #4b5563; --border: #c7ccd3; }
      body { max-width: none; padding: 0; }
      .skip-link { display: none; }
      .finding { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#report-content">${text(language, "Skip to report", "跳到報告內容")}</a>
  <header class="report-header">
    <h1>${text(language, "GEO/AEO static readiness audit", "GEO/AEO 靜態準備度稽核")}</h1>
    <p><code>${escapeHtml(result.target.normalized_url)}</code></p>
    <p class="muted">${text(
      language,
      "Category scores summarize measured static rules. They are not a citation-probability estimate and are not combined into a total score.",
      "分類分數彙整已量測的靜態規則；它們不是引用機率的估計，也不會合併成單一總分。",
    )}</p>
  </header>
  <main id="report-content">
    ${renderVersions(result, language)}
    ${renderScorecards(result.scorecards, language)}
    ${renderBlockers(result.blockers, language)}
    ${renderTransportErrors(transportErrors, language)}
    ${renderLimitations(measurementLimitations, language)}
    ${renderNotTested(notTested, language)}
    ${renderFindings(result.findings, language)}
  </main>
</body>
</html>
`;
}

function renderVersions(result: AuditResult, language: HtmlLanguage): string {
  const metadata = result.metadata;
  const psl = metadata.public_suffix_list;
  return `<section>
    <h2>${text(language, "Report metadata", "報告中繼資料")}</h2>
    <div class="table-scroll"><table>
      <tbody>
        ${row(text(language, "Generated", "產生時間"), result.generated_at)}
        ${row(text(language, "Mode", "模式"), valueText(language, result.target.mode))}
        ${row(text(language, "Requested URL", "要求的 URL"), result.target.requested_url)}
        ${row(text(language, "Normalized URL", "正規化 URL"), result.target.normalized_url)}
        ${row(text(language, "Schema version", "Schema 版本"), result.schema_version)}
        ${row(text(language, "Tool version", "工具版本"), result.tool_version)}
        ${row(text(language, "Ruleset version", "規則集版本"), result.ruleset_version)}
        ${row(text(language, "URL normalization", "URL 正規化"), metadata.url_normalization.version)}
        ${row(
          text(language, "Sampling", "抽樣"),
          metadata.sampling.applied
            ? `${metadata.sampling.method} / ${metadata.sampling.hash_algorithm} / ${text(language, "seed", "種子")} ${metadata.sampling.seed}`
            : text(language, "not applied (single-page mode)", "未套用（單頁模式）"),
        )}
        ${row(
          text(language, "Public Suffix List", "Public Suffix List"),
          psl.used
            ? `${display(psl.package_name)} ${display(psl.package_version)} / data ${display(psl.data_version)}`
            : text(language, `not used; scope basis: ${psl.scope_basis}`, `未使用；範圍基準：${psl.scope_basis}`),
        )}
      </tbody>
    </table></div>
    ${renderSamples(metadata.sampling.selected, language)}
    <details class="disclosure">
      <summary>${text(language, "Resource limits", "資源限制")}</summary>
      <pre>${escapeHtml(JSON.stringify(metadata.limits, null, 2))}</pre>
    </details>
  </section>`;
}

function renderSamples(samples: AuditResult["metadata"]["sampling"]["selected"], language: HtmlLanguage): string {
  if (samples.length === 0) return "";
  return `<details class="disclosure">
    <summary>${text(language, "Deterministic sample", "確定性樣本")} (${samples.length})</summary>
    <div class="table-scroll"><table class="wide-table">
      <thead><tr><th>URL</th><th>SHA-256 hash</th><th>${text(language, "State", "狀態")}</th></tr></thead>
      <tbody>${samples
        .map(
          (sample) =>
            `<tr><td><code>${escapeHtml(sample.url)}</code></td><td><code>${escapeHtml(sample.hash)}</code></td><td>${escapeHtml(valueText(language, sample.state))}</td></tr>`,
        )
        .join("")}</tbody>
    </table></div>
  </details>`;
}

function renderScorecards(scorecards: readonly CategoryScorecard[], language: HtmlLanguage): string {
  return `<section>
    <h2>${text(language, "Category scorecards", "分類計分卡")}</h2>
    <div class="cards">${scorecards
      .map(
        (card) => `<article class="card">
          <h3>${escapeHtml(valueText(language, card.category))}</h3>
          <div class="metric">${percentage(card.score.value, language)}</div>
          <p>${card.score.passed} ${text(language, "passed", "通過")} / ${card.score.failed} ${text(language, "failed", "未通過")} / ${card.score.denominator} ${text(language, "scored", "已計分")}</p>
          <p>${text(language, "Measurement coverage", "量測涵蓋率")}：<strong>${percentage(card.measurement_coverage.value, language)}</strong></p>
          <p>${card.measurement_coverage.measured} ${text(language, "measured", "已量測")} / ${card.measurement_coverage.applicable} ${text(language, "applicable", "適用")}；${card.measurement_coverage.not_tested} ${text(language, "NOT_TESTED", "未測試")}；${card.measurement_coverage.errors} ${text(language, "errors", "錯誤")}</p>
          <p class="muted">${text(language, "Excluded", "排除於計分之外")}：${card.excluded_from_score.informational} ${text(language, "informational", "資訊性")}、${card.excluded_from_score.experimental} ${text(language, "experimental", "實驗性")}、${card.excluded_from_score.unclassified} ${text(language, "unclassified", "未分類")}、${card.excluded_from_score.unmeasured} ${text(language, "unmeasured", "未量測")}。</p>
        </article>`,
      )
      .join("")}</div>
  </section>`;
}

function renderBlockers(blockers: readonly Blocker[], language: HtmlLanguage): string {
  return `<section>
    <h2>${text(language, "Blockers", "阻擋問題")} (${blockers.length})</h2>
    ${
      blockers.length === 0
        ? empty(text(language, "No blockers were emitted.", "未發現阻擋問題。"))
        : `<div class="table-scroll"><table class="wide-table">
      <thead><tr><th>${text(language, "Kind / rule", "類型／規則")}</th><th>${text(language, "Subject and evidence", "對象與證據")}</th><th>${text(language, "Scope", "範圍")}</th></tr></thead>
      <tbody>${blockers
        .map(
          (blocker) => `<tr>
          <td><strong>${escapeHtml(blocker.kind)}</strong><br><code>${escapeHtml(blocker.rule_id)}</code></td>
          <td>${optionalCode(blocker.subject_url)}${renderList(blocker.evidence, language)}</td>
          <td><strong>${text(language, "Applies to", "適用於")}</strong>${renderList(blocker.applies_to, language)}<strong>${text(language, "Not asserted for", "未宣稱適用於")}</strong>${renderList(blocker.not_asserted_for, language)}</td>
        </tr>`,
        )
        .join("")}</tbody>
    </table></div>`
    }
  </section>`;
}

function renderTransportErrors(blockers: readonly Blocker[], language: HtmlLanguage): string {
  return `<section>
    <h2>${text(language, "Transport and protocol errors", "傳輸與協定錯誤")} (${blockers.length})</h2>
    ${
      blockers.length === 0
        ? empty(text(language, "No transport or protocol blocker was emitted.", "未發現傳輸或協定阻擋問題。"))
        : blockers
            .map(
              (blocker) => `<article class="card">
        <h3><code>${escapeHtml(blocker.rule_id)}</code></h3>
        ${optionalCode(blocker.subject_url)}${renderList(blocker.evidence, language)}
      </article>`,
            )
            .join("")
    }
  </section>`;
}

function renderLimitations(findings: readonly Finding[], language: HtmlLanguage): string {
  return `<section>
    <h2>${text(language, "Measurement limitations", "量測限制")} (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty(text(language, "No measurement limitation or measurement error was emitted.", "未發現量測限制或量測錯誤。"))
        : `<ul>${findings
            .map(
              (finding) =>
                `<li><code>${escapeHtml(finding.id)}</code> — ${escapeHtml(valueText(language, finding.result))}：${escapeHtml(findingText(finding, language).rationale)}</li>`,
            )
            .join("")}</ul>`
    }
  </section>`;
}

function renderNotTested(findings: readonly Finding[], language: HtmlLanguage): string {
  return `<section>
    <h2>${text(language, "NOT_TESTED items", "未測試項目")} (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty(text(language, "Every applicable rule was tested or reported as an error.", "所有適用規則皆已測試或已回報為錯誤。"))
        : `<ul>${findings
            .map(
              (finding) =>
                `<li><code>${escapeHtml(finding.id)}</code>${optionalCode(finding.subject_url)} — ${escapeHtml(findingText(finding, language).rationale)}</li>`,
            )
            .join("")}</ul>`
    }
  </section>`;
}

function renderFindings(findings: readonly Finding[], language: HtmlLanguage): string {
  return `<section id="findings">
    <h2>${text(language, "Findings", "檢查結果")} (${findings.length})</h2>
    ${
      findings.length === 0
        ? empty(text(language, "No findings were emitted.", "未產生檢查結果。"))
        : `<div class="finding-list">${findings.map((finding) => renderFinding(finding, language)).join("")}</div>`
    }
  </section>`;
}

function renderFinding(finding: Finding, language: HtmlLanguage): string {
  const translated = findingText(finding, language);
  const expanded = finding.result !== "pass" && finding.result !== "not_applicable";
  const result = resultClass(finding.result);
  return `<details class="finding ${result}"${expanded ? " open" : ""}>
    <summary><span class="finding-summary">
      <span class="finding-title"><code>${escapeHtml(finding.id)}</code><span class="finding-context">${escapeHtml(valueText(language, finding.category))} · ${escapeHtml(valueText(language, finding.score_impact))}</span></span>
      <strong class="status ${result}">${escapeHtml(valueText(language, finding.result))}</strong>
    </span></summary>
    <div class="finding-content">
      ${finding.subject_url === undefined ? "" : `<p class="finding-subject"><strong>${text(language, "Subject", "對象")}：</strong> <code>${escapeHtml(finding.subject_url)}</code></p>`}
      <div class="finding-grid">
        <section class="finding-panel">
          <h3>${text(language, "Evidence and rationale", "證據與原因")}</h3>
          ${renderList(finding.evidence, language)}
          <p><strong>${text(language, "Rationale", "原因")}：</strong> ${escapeHtml(translated.rationale)}</p>
        </section>
        <section class="finding-panel">
          <h3>${text(language, "Recommendation and scope", "建議與範圍")}</h3>
          <p>${escapeHtml(translated.recommendation)}</p>
          <dl class="finding-facts">
            <dt>${text(language, "Evidence kind", "證據類型")}</dt><dd>${escapeHtml(valueText(language, finding.evidence_kind))}</dd>
            <dt>${text(language, "Claim scope", "主張範圍")}</dt><dd>${display(finding.claim_scope) === "" ? text(language, "None", "無") : escapeHtml(finding.claim_scope)}</dd>
          </dl>
          ${sourceLink(finding.source_url, language)}
        </section>
      </div>
    </div>
  </details>`;
}

function sourceLink(value: unknown, language: HtmlLanguage): string {
  const href = safeHttpUrl(value);
  if (href === null) return "";
  return `<p><a href="${escapeHtml(href)}" rel="noreferrer noopener">${text(language, "Official or standards source", "官方或標準來源")}</a></p>`;
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

function renderList(value: unknown, language: HtmlLanguage): string {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (items.length === 0) return `<p class="muted">${text(language, "None", "無")}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function optionalCode(value: unknown): string {
  return value === undefined ? "" : `<br><code>${escapeHtml(value)}</code>`;
}

function resultClass(result: Finding["result"]): string {
  return `result-${result.replaceAll("_", "-")}`;
}

function percentage(value: number | null, language: HtmlLanguage): string {
  return value === null ? text(language, "Not scored", "未計分") : `${value}%`;
}

function text(language: HtmlLanguage, english: string, traditionalChinese: string): string {
  return language === "zh-TW" ? traditionalChinese : english;
}

const ZH_TW_VALUES: Record<string, string> = {
  page: "單頁",
  site: "全站",
  fetched: "已抓取",
  skipped_by_robots: "依 robots.txt 略過",
  skipped_due_to_robots_unavailable: "因 robots.txt 無法取得而略過",
  fetch_error: "抓取錯誤",
  pass: "通過",
  fail: "未通過",
  not_applicable: "不適用",
  not_tested: "未測試",
  error: "錯誤",
  access_and_eligibility: "存取與資格",
  discoverability: "可探索性",
  parseability: "可解析性",
  freshness_and_entity: "時效性與實體",
  source_and_evidence: "來源與證據",
  scored: "計分",
  informational: "資訊性",
  experimental: "實驗性",
  official_behavior: "官方行為",
  official_recommendation: "官方建議",
  standard: "標準",
  empirical_observation: "實證觀察",
  heuristic: "啟發式",
  transport_or_protocol: "傳輸或協定",
  provider_eligibility: "服務供應商資格",
};

function valueText(language: HtmlLanguage, value: unknown): string {
  const raw = display(value);
  return language === "zh-TW" ? ZH_TW_VALUES[raw] ?? raw : raw;
}

type FindingMessages = {
  rationale: Partial<Record<Finding["result"], string>>;
  recommendation: Partial<Record<Finding["result"], string>>;
};

const ZH_TW_FINDINGS: Record<string, FindingMessages> = {
  "technical.transport": messages(
    { error: "稽核傳輸層無法取得回應，因此無法量測技術資格。" },
    { error: "請排除 DNS、TLS、重新導向、HTTP 或網路問題後重新執行稽核。" },
  ),
  "technical.http_status": messages(
    {
      pass: "最終回應使用成功的 HTTP 狀態碼。",
      fail: "最終回應不是成功的 HTTP 狀態碼。",
      not_tested: "因量測限制而未取得頁面，無法檢查 HTTP 狀態。",
    },
    {
      fail: "請讓受稽核 URL 的最終回應使用成功的 HTTP 狀態碼。",
      not_tested: "請排除量測限制，待頁面可抓取後重新執行稽核。",
    },
  ),
  "technical.indexability": messages(
    {
      pass: "初始回應標頭與 HTML 中未發現 noindex 指示。",
      fail: "noindex 指示會阻止頁面進入 Google Search 官方文件所述的搜尋範圍。",
      not_tested: "初始頁面內容未接受檢查，因此無法判定索引資格。",
    },
    {
      fail: "僅在此頁面應可被索引時移除 noindex。",
      not_tested: "請檢查 robots 存取設定，適合時重新執行內容稽核。",
    },
  ),
  "technical.canonical": messages(
    {
      pass: "初始 HTML 包含一個語法有效的 canonical URL。",
      fail: "canonical 宣告缺漏、多重或不是有效的 HTTP(S) URL，無法明確指出偏好網址。",
      not_tested: "初始頁面內容未接受檢查，因此無法判定 canonical URL。",
    },
    {
      fail: "請在初始 HTML 中提供且僅提供一個有效的 canonical 連結。",
      not_tested: "請檢查 robots 存取設定，適合時重新執行內容稽核。",
    },
  ),
  "technical.sitemap_membership": messages(
    {
      pass: "已在成功解析的 sitemap 中明確找到受稽核頁面。",
      fail: "這次有界稽核觀察到的 sitemap URL 中沒有受稽核頁面。",
      not_tested: "沒有可用且成功解析的 sitemap URL 集合，因此無法量測 sitemap 收錄狀態。",
    },
    { fail: "若此 canonical 頁面應被探索，請將它加入適當的 sitemap。" },
  ),
  "technical.initial_html_content": messages(
    {
      pass: "初始 HTML 含有可直接觀察的文字，因此可以進行靜態內容檢查。",
      not_tested: "需要瀏覽器渲染或解除量測限制後才能確認主要內容；這不代表任何 AI 都無法使用該內容。",
    },
    { not_tested: "可行時請在初始 HTML 中輸出有意義的主要內容，或另以瀏覽器型稽核確認。" },
  ),
  "technical.redirect_hygiene": messages(
    {
      pass: "未發現 meta refresh 或低內容量的純 JavaScript 重新導向殼層。",
      fail: "初始 HTML 依賴不執行渲染的代理可能不會跟隨的客戶端重新導向。",
      not_tested: "初始頁面內容未接受檢查，因此無法判定重新導向方式。",
    },
    {
      fail: "請使用適當的 HTTP 重新導向，並直接向不執行渲染的客戶端提供目的 URL。",
      not_tested: "請檢查 robots 存取設定，適合時重新執行內容稽核。",
    },
  ),
  "technical.llms_txt": messages(
    {
      pass: "網站提供內容充實且非 HTML 的 llms.txt 文件。",
      fail: "兩個標準 llms.txt 位置都沒有回傳內容充實且非 HTML 的文件。",
      error: "至少一個 llms.txt 位置量測失敗，且沒有任何位置通過。",
      not_tested: "無法量測此 origin 的 llms.txt。",
    },
    {
      pass: "請持續更新文件，並讓內容與公開網站一致。",
      fail: "請在 /llms.txt 或 /.well-known/llms.txt 發布至少 100 個字元的純文字或 Markdown。",
      error: "請確保 llms.txt 位置可穩定抓取後重新執行稽核。",
      not_tested: "請允許稽核爬蟲抓取 llms.txt 後重新執行稽核。",
    },
  ),
  "technical.not_found_status": messages(
    {
      pass: "合成的不存在路徑明確回傳找不到資源的狀態碼。",
      fail: "合成的不存在路徑沒有回傳 404 或 410。",
      error: "合成的不存在路徑無法量測，或回傳伺服器錯誤。",
      not_tested: "無法量測此 origin 對不存在路徑的回應。",
    },
    {
      fail: "請讓不存在的資源回傳 HTTP 404 或 410，而不是 soft 404 頁面。",
      error: "請讓不存在路徑穩定回傳 404 或 410 後重新執行稽核。",
      not_tested: "請允許稽核爬蟲抓取合成的不存在路徑後重新執行稽核。",
    },
  ),
  "technical.markdown_negotiation": messages(
    {
      pass: "頁面可提供 Markdown，且快取會依 Accept 標頭變化。",
      fail: "頁面沒有為指定的 Accept 標頭回傳完整有效的 Markdown 協商回應。",
      error: "Markdown 內容協商請求在量測時失敗。",
      not_tested: "主要頁面無法用於 Markdown 內容協商。",
    },
    {
      fail: "請在 Accept: text/markdown 時提供 text/markdown，並加入 Vary: Accept。",
      error: "請確保協商後的內容可穩定抓取，再重新執行稽核。",
      not_tested: "請讓主要頁面可抓取後重新執行稽核。",
    },
  ),
  "technical.trust_pages": messages(
    {
      pass: "主要頁面連結到內容充實且同 origin 的關於、聯絡與隱私權頁面。",
      fail: "一個以上的信任頁面連結缺漏、回應不成功或可見文字不足。",
      error: "至少一個信任頁面在量測時失敗。",
      not_tested: "至少一個信任頁面無法量測。",
    },
    {
      fail: "請從主要頁面連結同 origin 的關於、聯絡與隱私權頁面，並讓每頁至少有 500 個可見字元。",
      error: "請確保信任頁面可穩定抓取後重新執行稽核。",
      not_tested: "請讓主要頁面及其信任頁面連結可供稽核爬蟲抓取。",
    },
  ),
  "content.title": contentMessages(
    "頁面提供一個可供使用者辨識內容的描述性標題。",
    "頁面缺少唯一且非空白的 title 元素，或有多個 title 造成偏好標題不明。",
    "請提供且僅提供一個簡潔、具描述性的 title 元素。",
  ),
  "content.meta_description": contentMessages(
    "頁面提供一個 Google 可在更適合時採用的摘要。",
    "頁面沒有提供單一且明確的 meta description。",
    "請提供一個針對此頁且有用的 meta description。",
  ),
  "content.language": contentMessages(
    "文件宣告了語法合理的語言標籤。",
    "文件語言缺漏或格式不正確。",
    "請使用有效的語言標籤，將 html lang 設為內容的主要語言。",
  ),
  "content.open_graph": contentMessages(
    "頁面提供此規則量測的 Open Graph 類型與圖片資訊。",
    "頁面缺少一個以上的 Open Graph 欄位。",
    "請提供非空白的 og:type 與 og:image metadata。",
  ),
  "content.document_landmarks": contentMessages(
    "靜態文件同時提供主要內容與導覽 landmark。",
    "靜態文件缺少一個以上的必要 landmark。",
    "請在靜態 HTML 中使用 main 與 navigation landmark。",
  ),
  "content.heading_structure": contentMessages(
    "靜態 HTML 提供主要標題，且沒有跳過標題層級。",
    "靜態標題大綱缺少主要 h1，或跳過了標題層級。",
    "請提供清楚的 h1，並使用連貫的標題層級。",
  ),
  "content.jsonld_validity": messages(
    {
      pass: "觀察到的 JSON-LD 是語法有效的 JSON。",
      error: "至少一個 JSON-LD 區塊無法解析；這是量測錯誤，不是內容主張未通過。",
      not_applicable: "頁面沒有提供 JSON-LD，因此不適用 JSON-LD 語法檢查。",
      not_tested: "此規則無法取得靜態頁面內容。",
    },
    { error: "請修正無效的 JSON-LD 語法後重新執行稽核。", not_tested: "請排除量測限制後重新執行稽核。" },
  ),
  "content.article_structured_data": articleMessages(
    "頁面提供 Article 系列的 JSON-LD 實體。",
    "類似文章的頁面沒有提供 Article 系列的 JSON-LD 實體。",
    "請在頁面屬於文章時加入正確的 Article JSON-LD。",
    "無效的 JSON-LD 使 Article 實體無法可靠判定。",
  ),
  "content.author": articleMessages(
    "文章在靜態 HTML 或 JSON-LD 中提供至少一個作者訊號。",
    "文章沒有可觀察的作者訊號。",
    "請標明文章作者，並讓可見與結構化的作者資料保持一致。",
  ),
  "content.publication_date": articleMessages(
    "文章提供語法有效的發布日期。",
    "文章缺少有效的 ISO 8601 發布日期訊號。",
    "請提供正確的可見日期與 datePublished 結構化值。",
  ),
  "content.entity_identity": articleMessages(
    "JSON-LD 識別出具名的 Person 或 Organization 實體。",
    "適用的文章或個人資料頁面未在 JSON-LD 中提供具名的 Person 或 Organization 實體。",
    "請為適用的作者與發布者使用正確的 Person 或 Organization 實體。",
  ),
  "content.entity_same_as": articleMessages(
    "至少一個 Person 或 Organization 實體透過 sameAs 連結到外部身分。",
    "觀察到的 Person 或 Organization 實體缺少有效的 HTTPS sameAs 連結。",
    "請為相關的 Person 或 Organization 實體加入正確的 HTTPS sameAs URL。",
  ),
  "content.update_signal": articleMessages(
    "文章提供有效的最後修改訊號。",
    "未觀察到有效的最後修改訊號；這不代表內容一定過時。",
    "文章有實質變更時，請提供正確的可見日期與 dateModified 值。",
  ),
  "content.source_links": articleMessages(
    "文章提供至少一個可從外部解析的來源連結。",
    "未觀察到外部來源連結；這是透明度訊號，不是普遍的排名要求。",
    "當主張依賴外部證據且連結有助於讀者時，請連結主要來源。",
  ),
};

function messages(
  rationale: FindingMessages["rationale"],
  recommendation: FindingMessages["recommendation"],
): FindingMessages {
  return { rationale, recommendation };
}

function contentMessages(pass: string, fail: string, recommendation: string): FindingMessages {
  return messages(
    { pass, fail, not_tested: "此規則無法取得靜態頁面內容。" },
    { fail: recommendation, not_tested: "請排除量測限制後重新執行稽核。" },
  );
}

function articleMessages(pass: string, fail: string, recommendation: string, error?: string): FindingMessages {
  return messages(
    {
      pass,
      fail,
      error,
      not_applicable: "此頁面的分類不適用這項指引。",
      not_tested: "此規則無法取得靜態頁面內容。",
    },
    {
      fail: recommendation,
      error: error === undefined ? undefined : "請修正無效的 JSON-LD 後重新執行稽核。",
      not_tested: "請排除量測限制後重新執行稽核。",
    },
  );
}

function findingText(finding: Finding, language: HtmlLanguage): { rationale: string; recommendation: string } {
  if (language === "en") {
    return { rationale: display(finding.rationale), recommendation: display(finding.recommendation) };
  }
  if (finding.id.startsWith("technical.robots.")) {
    const pass = finding.result === "pass";
    return {
      rationale: finding.result === "not_tested"
        ? "無法量測此爬蟲的 robots.txt 存取政策。"
        : `官方文件所述的 robots.txt 政策顯示此爬蟲${pass ? "可存取" : "不可存取"}受稽核頁面。`,
      recommendation: pass
        ? "無需變更。"
        : finding.result === "not_tested"
          ? "請確保 robots.txt 可穩定取得後重新執行稽核。"
          : "僅在官方文件所述的產品範圍應存取此頁面時，調整對應的 robots.txt 規則。",
    };
  }
  const translation = ZH_TW_FINDINGS[finding.id];
  return {
    rationale: translation?.rationale[finding.result] ?? display(finding.rationale),
    recommendation:
      translation?.recommendation[finding.result] ??
      (finding.result === "pass" || finding.result === "not_applicable"
        ? "無需變更。"
        : display(finding.recommendation)),
  };
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
