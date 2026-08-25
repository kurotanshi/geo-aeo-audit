export const REPORT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export const REPORT_STYLES = `
  :root {
    color-scheme: light dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --page: #f3f5f7;
    --surface: #ffffff;
    --surface-muted: #f5f7f9;
    --text: #172231;
    --muted: #586779;
    --border: #cbd4de;
    --border-strong: #96a5b5;
    --accent: #075ea8;
    --accent-muted: #e7f2fb;
    --focus: #006dcc;
    --pass: #087443;
    --pass-bg: #e7f6ee;
    --fail: #b42318;
    --fail-bg: #fff0ee;
    --warning: #825500;
    --warning-bg: #fff4d6;
    --neutral: #526174;
    --neutral-bg: #edf1f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #10171f;
      --surface: #18212b;
      --surface-muted: #222d39;
      --text: #edf2f7;
      --muted: #b4bfcb;
      --border: #3b4958;
      --border-strong: #68798a;
      --accent: #8cc0ff;
      --accent-muted: #1c3853;
      --focus: #9bc7ff;
      --pass: #78d6a7;
      --pass-bg: #173a2a;
      --fail: #ff9c94;
      --fail-bg: #48231f;
      --warning: #f5c66b;
      --warning-bg: #443717;
      --neutral: #c5ced8;
      --neutral-bg: #303b47;
    }
  }
  * { box-sizing: border-box; }
  html { background: var(--page); }
  body { margin: 0; color: var(--text); background: var(--page); line-height: 1.6; }
  .report-shell { width: min(calc(100% - 2rem), 72rem); margin-inline: auto; padding-block: clamp(1.5rem, 4vw, 3rem) 4rem; }
  h1, h2, h3, h4 { color: var(--text); line-height: 1.25; }
  h1 { max-width: 22ch; margin: 0; font-size: clamp(1.8rem, 5vw, 2.75rem); letter-spacing: -.025em; }
  h2 { margin: 0; font-size: clamp(1.3rem, 3vw, 1.65rem); }
  h3 { margin: 0 0 .5rem; font-size: 1.05rem; }
  h4 { margin: 1.25rem 0 .5rem; font-size: 1rem; }
  p { margin: .5rem 0; }
  ul, ol { margin: .5rem 0; padding-inline-start: 1.4rem; }
  li + li { margin-top: .35rem; }
  a { color: var(--accent); text-underline-offset: .18em; }
  a:hover { text-decoration-thickness: .14em; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  code { overflow-wrap: anywhere; word-break: break-word; }
  pre { max-height: 34rem; overflow: auto; padding: 1rem; background: var(--surface-muted); border: 1px solid var(--border); border-radius: .4rem; white-space: pre-wrap; }
  .skip-link { position: fixed; top: -5rem; left: 1rem; z-index: 2; padding: .65rem .85rem; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); }
  .skip-link:focus { top: 1rem; }
  .report-header { padding: clamp(1.25rem, 4vw, 2.25rem); background: var(--surface); border: 1px solid var(--border); border-top: .3rem solid var(--accent); }
  .report-header .metric { margin-top: 1rem; }
  .eyebrow { margin: 0 0 .4rem; color: var(--accent); font-size: .78rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .target { margin-top: 1rem; padding: .6rem .75rem; background: var(--surface-muted); border-inline-start: .2rem solid var(--border-strong); }
  .lede { max-width: 75ch; color: var(--muted); }
  .report-nav { display: flex; gap: .25rem 1.1rem; overflow-x: auto; margin: 1rem 0 0; padding: .75rem 0; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .report-nav a { color: var(--muted); font-size: .9rem; font-weight: 650; text-decoration: none; }
  .report-nav a:hover { color: var(--accent); text-decoration: underline; }
  .report-section { margin-top: clamp(2.25rem, 6vw, 3.5rem); scroll-margin-top: 1rem; }
  .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; padding-bottom: .55rem; border-bottom: 1px solid var(--border); }
  .section-heading p { margin: 0; color: var(--muted); font-size: .9rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: .75rem; }
  .card { padding: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: .45rem; }
  .metric { font-size: clamp(1.55rem, 4vw, 2rem); font-weight: 750; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .muted { color: var(--muted); }
  .table-scroll { margin: 1rem 0; overflow-x: auto; border: 1px solid var(--border); border-radius: .4rem; background: var(--surface); }
  table { width: 100%; border-collapse: collapse; }
  .wide-table { min-width: 44rem; }
  th, td { padding: .7rem .8rem; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
  th { background: var(--surface-muted); font-size: .85rem; font-weight: 700; }
  thead th { border-bottom-color: var(--border-strong); white-space: nowrap; }
  tbody tr:last-child > * { border-bottom: 0; }
  tbody tr:nth-child(even) > td { background: var(--surface-muted); }
  .key-value th { width: 14rem; }
  .disclosure, .record, .finding { margin: .75rem 0; background: var(--surface); border: 1px solid var(--border); border-radius: .45rem; }
  summary { cursor: pointer; }
  summary:hover { background: var(--surface-muted); }
  .disclosure > summary, .record > summary { padding: .8rem 1rem; font-weight: 700; }
  .disclosure[open] > summary, .record[open] > summary, .finding[open] > summary { border-bottom: 1px solid var(--border); }
  .disclosure > :not(summary), .record > :not(summary) { margin-right: 1rem; margin-left: 1rem; }
  .record-summary, .finding-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; min-width: 0; }
  .record-summary { padding: .8rem 1rem; }
  .record-summary > span:first-child, .finding-title { display: grid; gap: .2rem; min-width: 0; }
  .record-content { padding: .25rem 1rem 1rem; }
  .status { flex: none; display: inline-block; padding: .18rem .55rem; border-radius: 999px; font-size: .78rem; font-weight: 750; line-height: 1.5; }
  .status.result-pass, .status.outcome-completed-answer { color: var(--pass); background: var(--pass-bg); }
  .status.result-fail, .status.result-error, .status.outcome-provider-error, .status.outcome-timeout, .status.outcome-normalization-error, .status.outcome-completed-tool-error { color: var(--fail); background: var(--fail-bg); }
  .status.result-not-tested { color: var(--warning); background: var(--warning-bg); }
  .status.result-not-applicable, .status.outcome-completed-refusal, .status.outcome-completed-no-search { color: var(--neutral); background: var(--neutral-bg); }
  .finding { border-inline-start: .3rem solid var(--neutral); }
  .finding.result-pass { border-inline-start-color: var(--pass); }
  .finding.result-fail, .finding.result-error { border-inline-start-color: var(--fail); }
  .finding.result-not-tested { border-inline-start-color: var(--warning); }
  .finding > summary { padding: .9rem 1rem; }
  .finding-context { color: var(--muted); font-size: .85rem; }
  .finding-content { padding: 0 1rem 1rem; }
  .finding-subject { color: var(--muted); }
  .finding-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 1fr); gap: 1.25rem; }
  .finding-panel { min-width: 0; padding-top: 1rem; }
  .finding-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .25rem .75rem; margin: .8rem 0; }
  .finding-facts dt { color: var(--muted); }
  .finding-facts dd { margin: 0; overflow-wrap: anywhere; }
  .priority-list { display: grid; gap: .75rem; padding: 0; list-style: none; counter-reset: fixes; }
  .priority-list > li { counter-increment: fixes; padding: 1rem; background: var(--surface); border: 1px solid var(--border); border-inline-start: .25rem solid var(--border-strong); }
  .priority-list > li::before { content: "Priority " counter(fixes); display: block; margin-bottom: .3rem; color: var(--muted); font-size: .75rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .next { display: inline-block; margin-inline-end: .35rem; padding: .14rem .45rem; color: var(--pass); background: var(--pass-bg); border-radius: 999px; font-size: .75rem; font-weight: 700; }
  @media (max-width: 720px) {
    .report-shell { width: min(calc(100% - 1rem), 72rem); padding-top: .5rem; }
    .report-header { padding: 1rem; }
    .report-nav { margin-inline: .25rem; }
    .section-heading, .record-summary, .finding-summary { display: grid; }
    .finding-grid { grid-template-columns: 1fr; gap: 0; }
    .status { justify-self: start; }
    .key-value th { width: 10rem; }
  }
  @media print {
    :root { color-scheme: light; --page: #fff; --surface: #fff; --surface-muted: #f3f4f6; --text: #111827; --muted: #4b5563; --border: #c7ccd3; }
    .report-shell { width: 100%; padding: 0; }
    .report-header { padding: 0 0 1rem; border-width: 0 0 1px; }
    .skip-link, .report-nav { display: none; }
    details:not([open]) > :not(summary) { display: block; }
    .card, .finding, .record, .priority-list > li { break-inside: avoid; }
  }
`;
