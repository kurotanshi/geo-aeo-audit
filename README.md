# geo-aeo-audit

[繁體中文](#繁體中文) · [English](#english)

---

## 繁體中文

`geo-aeo-audit` 是一個唯讀 CLI，對公開 HTTP(S) 頁面做可重現的 GEO／AEO 觀測。

- `audit`：靜態檢查技術可存取性、爬蟲政策、探索訊號、內容與實體訊號，不呼叫任何模型 API。
- `probe`：呼叫你指定的 OpenAI 或 Anthropic API，觀測它是否真的搜尋並引用目標頁面（會產生 provider 費用）。
- `ora`：讀取 [Ora](https://ora.ai) 的快取 agent-readiness 報告；加 `--scan` 才會要求 Ora 掃描目標。

報告描述的是可觀測的準備度，不預測被引用的機率，也不產出單一總分。

### 安裝與執行

需要 Node.js 20 以上。

不安裝、直接執行（二選一）：

```bash
npx --yes geo-aeo-audit audit https://example.com/
pnpm dlx geo-aeo-audit audit https://example.com/
```

也可以使用 pnpm 安裝成全域 CLI：

```bash
pnpm add -g geo-aeo-audit
geo-aeo audit https://example.com/
```

若只想在特定專案使用，安裝成開發相依套件：

```bash
pnpm add --save-dev geo-aeo-audit
pnpm exec geo-aeo audit https://example.com/
```

一般使用者不需要 clone 本專案。以下原始碼安裝方式僅供貢獻者與維護者使用（pnpm 11）：

```bash
pnpm install
pnpm dev audit https://example.com/      # 直接跑 TypeScript
pnpm run build && node dist/cli.js --help
```

### 使用方式

每個命令各有自己的選項，用 `geo-aeo <command> --help` 查看。三個命令都支援 `--json`／`--no-json`（預設輸出 JSON 到 stdout）與 `--html <path>`（另寫一份自包含、無 JavaScript 的 HTML 報告）。

#### audit

```bash
geo-aeo audit https://example.com/article
geo-aeo audit https://example.com/ --site --html audit.html --html-lang zh-TW > audit.json
```

- `--site` — 在最終 URL 的 origin 內，從 sitemap 取一組有界、確定性的樣本一起稽核；預設只稽核單頁。
- `--html-lang <en|zh-TW>` — 選擇 HTML 報告語言；預設英文。JSON 與原始技術證據不會翻譯。
- `--fail-on <blocker|error|never>` — exit code 門檻，預設 `blocker`。

每條規則都會產生一個 finding，結果為：

| 結果 | 意義 |
|---|---|
| `pass` / `fail` | 靜態觀測符合／不符合規則。 |
| `not_applicable` | 規則不適用於這種頁面。 |
| `not_tested` | robots、抓取或渲染限制使檢查無法進行。 |
| `error` | 量測本身失敗，不視為規則失敗。 |

findings 依五個類別彙整成計分卡；`informational`／`experimental` 規則與非 `pass`／`fail` 的結果不計入分數。JSON 結構見 [schemas/audit-result.schema.json](schemas/audit-result.schema.json)。

#### probe

```bash
export OPENAI_API_KEY="..."   # 或 ANTHROPIC_API_KEY
geo-aeo probe https://example.com/article \
  --prompts prompts.json --provider openai --model gpt-5 --repeats 2 \
  --country TW --timezone Asia/Taipei --html probe.html > probe.json
```

- `--prompts <path>` — 必填，UTF-8 JSON 字串陣列（1–20 個）。
- `--provider <openai|anthropic>`、`--model <id>`、`--repeats <1-10>` — 必填。
- `--locale <tag>` — 只記錄在結果中供分組，不送給 provider。
- `--country <code>` / `--timezone <id>` — 作為 provider 的近似 `user_location` 送出。

每個 prompt × repeat 是一次 attempt，逐一執行、不重試、各 30 秒上限。結果記錄每次的 outcome、搜尋狀態、citations 與對目標 URL 的比對等級，並彙整成引用率與來源重疊度。目標 URL 只用於事後比對，不會注入 prompt 或 provider 設定。結構見 [schemas/probe-result.schema.json](schemas/probe-result.schema.json)。

觀測只代表指定的 API、模型與設定在當下的行為，不代表消費者版 ChatGPT／Claude，也不預測未來是否被引用。

#### ora

```bash
geo-aeo ora https://example.com/ --html ora.html > ora.json
geo-aeo ora https://example.com/ --scan
```

預設只以 hostname 向 `https://ora.ai` 讀取快取報告，不碰目標網站；沒有快取時 CLI 會提示加 `--scan`。`--scan` 會把正規化後的 URL 交給 Ora 並觸發第三方掃描，受 Ora 的配額限制；輪詢最多 15 次或 5 分鐘，超時仍輸出 `analysisStatus: partial`。不需要也不會傳送任何 API key。

結果原樣保留 Ora 的 score、grade、layers、essentials 與 top fixes，並附一張 crosswalk 把 Ora check 對到本地 `audit` 規則（`equivalent`／`composite`／`partial`／`not_ported`）。Ora 分數與本地計分卡各自獨立；需要偽裝其他 crawler UA 的 Ora check 刻意不移植。結構見 [schemas/ora-result.schema.json](schemas/ora-result.schema.json)。

### Exit codes

| 代碼 | 意義 |
|---|---|
| 0 | 完成；audit 未達 `--fail-on` 門檻。 |
| 1 | audit 達到 `--fail-on` 門檻（`blocker`：有任何 blocker；`error`：有 blocker 或 `error` finding）。 |
| 2 | 用法或設定錯誤。 |
| 3 | 無法完成，例如 HTML 報告寫不出來、Ora 無快取或被 rate limit。可完整回報的傳輸失敗會以 blocker 呈現，走 exit 0／1。 |

### 安全性與爬蟲行為

- 只連線公開的 global-unicast HTTP(S) 目標；每個 URL、DNS 結果與 redirect 都先驗證再連線，不走環境 proxy。
- redirect 數、header、回應大小、總 bytes、頁數、並行度與時間都有上限。
- 以自己的 User-Agent 表明身分，並以 `geo-aeo-audit` 身分遵守 robots.txt；不偽裝任何 crawler。
- 憑證只從 `OPENAI_API_KEY`／`ANTHROPIC_API_KEY` 讀取，不會出現在任何輸出中；Ora 命令不傳送憑證。
- HTML 報告不含 JavaScript，所有外部值都經過編碼。

### 限制

這是靜態 HTTP 稽核，不是瀏覽器。看起來需要 client-side rendering 的頁面會標為 `not_tested`，而非判定內容不存在。索引狀態、排名、檢索與被引用機率都無法由本工具證明。

### 測試

```bash
pnpm run typecheck
pnpm test
```

測試全部使用本機 fixture，不存取公開網站、不呼叫付費 API。

---

## English

`geo-aeo-audit` is a read-only CLI for reproducible GEO/AEO observations of public HTTP(S) pages.

- `audit`: static checks of technical access, crawler policy, discovery, content, and entity signals — no model API calls.
- `probe`: calls the OpenAI or Anthropic API you select and observes whether it actually searches and cites the target page (incurs provider charges).
- `ora`: reads the cached [Ora](https://ora.ai) agent-readiness report; only `--scan` asks Ora to scan the target.

Reports describe observable readiness. They do not predict citation probability or produce a single overall score.

### Install and run

Requires Node.js 20 or newer.

Run without installing (choose one):

```bash
npx --yes geo-aeo-audit audit https://example.com/
pnpm dlx geo-aeo-audit audit https://example.com/
```

Or install the CLI globally with pnpm:

```bash
pnpm add -g geo-aeo-audit
geo-aeo audit https://example.com/
```

To use it only within a specific project, install it as a development dependency:

```bash
pnpm add --save-dev geo-aeo-audit
pnpm exec geo-aeo audit https://example.com/
```

Regular users do not need to clone this repository. The source installation below is only for contributors and maintainers (pnpm 11):

```bash
pnpm install
pnpm dev audit https://example.com/      # run TypeScript directly
pnpm run build && node dist/cli.js --help
```

### Usage

Each command has its own options; see `geo-aeo <command> --help`. All three accept `--json` / `--no-json` (JSON to stdout by default) and `--html <path>` (a self-contained, script-free HTML report).

#### audit

```bash
geo-aeo audit https://example.com/article
geo-aeo audit https://example.com/ --site --html audit.html --html-lang zh-TW > audit.json
```

- `--site` — audit a bounded, deterministic sitemap sample within the final URL's origin; single-page mode is the default.
- `--html-lang <en|zh-TW>` — select the HTML report language; English is the default. JSON and raw technical evidence are not translated.
- `--fail-on <blocker|error|never>` — exit-code threshold, default `blocker`.

Every rule emits one finding:

| Result | Meaning |
|---|---|
| `pass` / `fail` | The static observation did / did not satisfy the rule. |
| `not_applicable` | The rule does not apply to this kind of page. |
| `not_tested` | A robots, fetch, or rendering limitation prevented the check. |
| `error` | The measurement itself failed; not treated as a rule failure. |

Findings roll up into five category scorecards; `informational` / `experimental` rules and results other than `pass` / `fail` are excluded from scores. Schema: [schemas/audit-result.schema.json](schemas/audit-result.schema.json).

#### probe

```bash
export OPENAI_API_KEY="..."   # or ANTHROPIC_API_KEY
geo-aeo probe https://example.com/article \
  --prompts prompts.json --provider openai --model gpt-5 --repeats 2 \
  --country TW --timezone Asia/Taipei --html probe.html > probe.json
```

- `--prompts <path>` — required; UTF-8 JSON array of 1–20 prompt strings.
- `--provider <openai|anthropic>`, `--model <id>`, `--repeats <1-10>` — required.
- `--locale <tag>` — recorded for grouping only; not sent to the provider.
- `--country <code>` / `--timezone <id>` — sent as the provider's approximate `user_location`.

Each prompt × repeat is one attempt, run sequentially with no retries and a 30-second deadline. Results record each attempt's outcome, search status, citations, and match level against the target URL, plus aggregated citation rates and source overlap. The target URL is used only for matching afterwards; it is never injected into prompts or provider settings. Schema: [schemas/probe-result.schema.json](schemas/probe-result.schema.json).

Observations reflect the named API, model, and settings at run time — not consumer ChatGPT/Claude, and not future citation behavior.

#### ora

```bash
geo-aeo ora https://example.com/ --html ora.html > ora.json
geo-aeo ora https://example.com/ --scan
```

By default the command sends only the hostname to `https://ora.ai` to read a cached report and never touches the target site; when no cache exists the CLI suggests `--scan`. `--scan` hands the normalized URL to Ora and triggers a third-party scan under Ora's quotas; polling stops after 15 attempts or 5 minutes and still emits `analysisStatus: partial`. No API key is needed or sent.

The result preserves Ora's score, grade, layers, essentials, and top fixes as returned, plus a crosswalk mapping Ora checks to local `audit` rules (`equivalent` / `composite` / `partial` / `not_ported`). Ora scores stay separate from local scorecards; Ora checks that require impersonating other crawler user agents are deliberately not ported. Schema: [schemas/ora-result.schema.json](schemas/ora-result.schema.json).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed; audit did not meet its `--fail-on` threshold. |
| 1 | Audit met its `--fail-on` threshold (`blocker`: any blocker; `error`: any blocker or `error` finding). |
| 2 | Usage or configuration error. |
| 3 | Could not complete — e.g. the HTML report could not be written, no Ora cache entry, or rate limited. Transport failures that can still be reported appear as blockers and follow exit 0/1. |

### Security and crawler behavior

- Connects only to public global-unicast HTTP(S) targets; every URL, DNS result, and redirect is validated before connecting, and environment proxies are ignored.
- Redirect count, headers, response size, total bytes, page count, concurrency, and time are all bounded.
- Identifies with its own User-Agent and obeys robots.txt as `geo-aeo-audit`; never impersonates another crawler.
- Credentials are read only from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` and never appear in any output; the Ora command sends none.
- HTML reports contain no JavaScript and encode every external value.

### Limitations

This is a static HTTP audit, not a browser. Pages that appear to require client-side rendering are marked `not_tested`, not judged empty. Indexing state, ranking, retrieval, and citation probability cannot be proven by this tool.

### Tests

```bash
pnpm run typecheck
pnpm test
```

All tests use local fixtures; nothing contacts public sites or paid APIs.
