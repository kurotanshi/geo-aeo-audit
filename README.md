# geo-aeo-audit

[繁體中文](#繁體中文) · [English](#english)

---

## 繁體中文

`geo-aeo-audit` 是一個唯讀的 CLI，用來對公開 HTTP(S) 頁面做可重現的 GEO／AEO 觀測。預設的 `audit` 命令檢查有界的技術可存取性、爬蟲政策、探索訊號、靜態內容、實體與佐證訊號，全程不呼叫任何模型 API。選用的 `probe` 命令會呼叫你指定的 provider API，觀測它是否真的搜尋並引用目標頁面；這可能產生 provider 費用。`ora` 命令則讀取 Ora 的快取報告，或在明確指定 `--scan` 時要求 Ora 掃描目標。

報告描述的是「可觀測的準備度」與各 provider 的資格控制條件。它不預測被引用的機率，也不產出單一總分。

### 環境需求與建置

- Node.js 20 以上
- pnpm 11

```bash
pnpm install
pnpm run build
node dist/cli.js --help
```

開發時不必另外建置：

```bash
pnpm dev audit https://example.com/
pnpm dev probe https://example.com/ --prompts prompts.json --provider openai --model gpt-5 --repeats 1
pnpm dev ora https://example.com/
```

套件已發佈到 npm，不用 clone 也能直接執行：

```bash
npx geo-aeo-audit audit https://example.com/
```

安裝或 link 為套件後會提供 `geo-aeo` 執行檔。`prepare` 腳本會在安裝時編譯 `dist/`，所以也可以直接從 GitHub 執行尚未發佈的版本：

```bash
npx github:kurotanshi/geo-aeo-audit audit https://example.com/
```

### 使用方式

```text
geo-aeo audit <url> [options]
geo-aeo probe <url> [options]
geo-aeo ora <url> [options]
geo-aeo --help
geo-aeo --version
```

三個命令各有自己的選項與 `--help`，一個命令的旗標不能用在另一個命令上。

#### 靜態 audit

稽核單一頁面並把 JSON 輸出到 stdout：

```bash
geo-aeo audit https://example.com/article
```

從同源 sitemap 取一組確定性的樣本進行稽核，同時輸出獨立的 HTML 報告：

```bash
geo-aeo audit https://example.com/ --site --html audit.html > audit.json
```

只輸出 HTML：

```bash
geo-aeo audit https://example.com/ --no-json --html audit.html
```

audit 選項：

- `--site` — 在最終 URL 的 origin 內探索並稽核一組有界、確定性的樣本。預設為單頁模式。
- `--fail-on <blocker|error|never>` — 選擇 exit code 的門檻，預設 `blocker`。
- `--json` / `--no-json` — 開啟或關閉 JSON stdout，預設開啟。
- `--html <path>` — 把自包含的 HTML 報告寫到指定路徑。

ruleset `0.3.0` 新增八條規則。下表的 mapping 是對 Ora `1.21.0` check 語意的靜態對照，不代表兩套工具會得到相同結果：

| 本地規則 | Ora check | Mapping | 邊界 |
|---|---|---|---|
| `technical.llms_txt` | `llms-txt-exists` | `partial` | 探測兩個標準位置，另要求至少 100 字元的非 HTML 內容。 |
| `technical.not_found_status` | `agent-friendly-404` | `partial` | 驗證 404／410，不評分錯誤頁內的 Markdown 導引。 |
| `technical.markdown_negotiation` | `markdown-negotiation-vary`、`markdown-negotiation` | `partial` | 驗證 `Accept: text/markdown` 與 `Vary: Accept`，不探測靜態 `.md` 路徑。 |
| `technical.trust_pages` | `trust-anchors` | `partial` | 從主體頁連結選擇同源 about／contact／privacy，而非固定路徑。 |
| `technical.redirect_hygiene` | `redirect-hygiene` | `partial` | 偵測 client-side redirect stub，不計跨網域 HTTP redirect 深度。 |
| `content.open_graph` | `metadata-completeness` | `composite` | 與 `technical.canonical`、`content.language` 合併覆蓋四項 metadata。 |
| `content.document_landmarks` | `ax-document-structure` | `composite` | 與 `content.heading_structure` 合併覆蓋 landmarks 與 headings。 |
| `content.entity_same_as` | `json-ld-entity-linking` | `equivalent` | Person／Organization 必須至少有一個有效 HTTPS `sameAs`。 |

前四條 origin 探測在 page 與 site 模式都只執行一次，使用本工具的 User-Agent、遵守 robots.txt、限制同源 redirect，並計入既有總位元組預算。完整 Ora crosswalk 另包含刻意未移植的 check；本工具不會為了量測而偽裝其他 crawler User-Agent。

#### Citation probe

先建立 UTF-8 JSON 的 prompt 檔：

```json
["Which sources explain this topic?", "What changed recently?"]
```

只設定所選 provider 的憑證，然後執行 probe：

```bash
export OPENAI_API_KEY="..."
geo-aeo probe https://example.com/article \
  --prompts prompts.json --provider openai --model gpt-5 \
  --repeats 2 --locale zh-TW --country TW --timezone Asia/Taipei \
  --html probe.html > probe.json
```

Anthropic 使用 `ANTHROPIC_API_KEY` 與 `--provider anthropic`。目前只支援 `openai` 與 `anthropic` 兩個 provider；Google Gemini 是刻意不支援。prompt 檔可含 1–20 個非空字串，每個最多 8 KiB、整檔最多 256 KiB。repeats 必須介於 1–10，總 attempts 不得超過 100。

attempts 依 prompt 順序、再依 repeat 順序逐一執行，不做隱含重試，每個 attempt 有固定 30 秒的期限。Anthropic 的 `pause_turn` 續呼叫屬於協定處理，上限三次。目標 URL 與本地觀測到的 redirect／canonical alias 只用於 citation 比對；CLI 不會把它們注入 prompt、domain filter、URL context 或 provider 的工具設定。

probe 選項：

- `--prompts <path>` — 必填。UTF-8 JSON 字串陣列。
- `--provider <openai|anthropic>` — 必填。決定 adapter 與讀取的憑證變數。
- `--model <id>` — 必填。原樣傳給 provider；回傳的模型另外記錄。
- `--repeats <n>` — 必填。每個 prompt 的重複次數，1–10。
- `--locale <tag>` — BCP 47 tag，只記錄為實驗 metadata 並用於分組，不會送給 provider。
- `--country <code>` / `--timezone <id>` — ISO 3166-1 alpha-2 國碼與 IANA 時區，作為 provider 的近似 `user_location` 送出。
- `--json` / `--no-json`、`--html <path>` — 行為與 audit 命令相同。

provider adapter 使用的介面如下。adapter 版本與 API surface 會寫進每份結果，讓不同執行可以比較。

| Provider | API surface | 搜尋工具 | 備註 |
|---|---|---|---|
| `openai` | Responses API（`responses.web_search`） | `web_search`，帶 `include: web_search_call.action.sources`、`store: false` | retrieved sources 來自 search call；cited sources 來自 `url_citation` annotation。 |
| `anthropic` | Messages API（`messages.web_search`） | `web_search_20250305`，`max_uses: 5` | retrieved sources 來自 `web_search_tool_result`；cited sources 來自帶 `cited_text` 的文字 citation。 |

#### Ora readiness

預設只從固定的 Ora endpoint 讀取 hostname 的快取報告，不抓取目標網站：

```bash
geo-aeo ora https://example.com/ --html ora.html > ora.json
```

如果 Ora 沒有快取，CLI 會提示使用 `--scan`。這個旗標會把正規化後的目標 URL 傳給第三方 Ora，並要求 Ora 掃描該網站；可能受 Ora 的掃描與 rate limit 約束：

```bash
geo-aeo ora https://example.com/ --scan
```

Ora 命令不讀取或傳送 API key、cookie 或其他憑證。`--json`／`--no-json` 與 `--html <path>` 的行為和其他命令相同。Ora 分數與本地 audit scorecards 各自獨立，crosswalk 只描述檢查語意的重疊。

### 報告

JSON envelope 遵循 [schemas/audit-result.schema.json](schemas/audit-result.schema.json)，內容包括：

- `schema_version`、`tool_version`、`ruleset_version`；
- 請求的 URL 與保守正規化後的 URL；
- URL 正規化、確定性抽樣、資源限制與 PSL 使用的 metadata；
- 逐規則的 findings 與依產品範圍區分的 blockers；
- 五個類別的計分卡與量測涵蓋率；
- site 模式下的抽樣 URL、SHA-256 雜湊、抓取／robots 狀態。

site 範圍以精確的最終 origin 為準，因此不使用 Public Suffix List。JSON 會明確記錄 `public_suffix_list.used: false` 以及 null 的套件／資料版本。

HTML 報告包含相同的稽核資訊、inline CSS 與嚴格的 Content Security Policy。它不含 JavaScript、不內嵌原始 JSON、對不可信的值做 HTML 編碼，且只為驗證過的 HTTP(S) 來源 URL 建立連結。

#### Probe 結果

probe JSON 遵循 [schemas/probe-result.schema.json](schemas/probe-result.schema.json)，與 audit envelope 各自獨立，內容包括：

- `experiment` — provider、要求的模型、adapter 版本、API surface、prompts、repeats、搜尋設定與 timeout；
- `target` — 請求的 URL、最終 URL、宣告的 canonical、robots 狀態、帶 provenance 的 alias、PSL 套件／資料版本與觀測限制；
- `attempts` — 每個 prompt × repeat 一筆，含時間、outcome、搜尋狀態、帶本地 target 比對結果的 citations、正規化後的 provider 回應與錯誤；
- `rates`、`source_overlaps`、`limitations`。

每個 attempt 只有一個 outcome，依以下優先序決定：`timeout`、`provider_error`、`normalization_error`、`completed_tool_error`、`completed_refusal`、`completed_no_search`、`completed_answer`。四個 `completed_*` 構成 completed set。搜尋狀態另外記為 `used`、`not_used`、`tool_error`、`not_exposed` 或 `unavailable`；provider 未揭露的欄位保留 `null` 值並附上 `present`／`not_used`／`not_exposed`／`unavailable` 狀態，不做猜測。

rate 有六項：`search_use_rate`、`any_citation_rate`、`target_page_citation_rate`、`target_host_citation_rate`、`target_domain_citation_rate`、`provider_error_rate`。每項都記錄 `numerator`、`denominator`、`value`、`unknown_count`、`denominator_definition` 與可觀測涵蓋率。citation 與搜尋類的 rate 會輸出兩個 view：`all_attempts`（含 provider 失敗的端到端產率）與 `completed`（只算 completed set）。分母為零時 `value` 為 `null`。target 比對分為 `exact_input_url`、`exact_final_url`、`target_declared_canonical`、`same_hostname`、`same_registrable_domain` 五級，保留最精確的一級。source overlap 是同一 provider／模型／API surface／搜尋設定組內、兩兩 completed attempts 之間 cited URL 與 cited registrable domain 的 Jaccard；兩邊皆為空集合時為 `null`。

probe 的 HTML 報告會安全編碼 provider 輸出並保留來源 attribution。probe 的觀測只代表所指定的 API、模型、搜尋設定、locale 與執行時間，不代表消費者版 ChatGPT 或 Claude 的行為，也不預測未來是否被引用。

#### Ora 結果

Ora JSON 遵循 [schemas/ora-result.schema.json](schemas/ora-result.schema.json)，與 audit、probe envelope 各自獨立。它保留 Ora 回應的 score、grade、layers、essentials 與 top fixes 原始順序，並加入請求模式、快取 metadata、本地規則 crosswalk 與限制說明。scan 在五分鐘或十五次 polling 的上限到達時仍會輸出 `analysisStatus: partial` 的結果並回傳 exit code 0。HTML 報告不含 JavaScript，並安全編碼 Ora 回應內容。

#### Finding 結果

| 結果 | 意義 |
|---|---|
| `pass` | 有界的靜態觀測符合規則。 |
| `fail` | 觀測不符合規則。 |
| `not_applicable` | 規則不適用，例如對非文章頁面套用僅限文章的指引。 |
| `not_tested` | robots、抓取、渲染或其他量測限制使檢查無法進行。 |
| `error` | 量測本身失敗；不會被轉成規則失敗。 |

每個 finding 都記錄 evidence 類型與 claim 範圍。`heuristic` findings 標記為實驗性，資訊性／實驗性 findings 不計入類別分數。`not_applicable`、`not_tested`、`error` 排除於分數分母之外；未量測的規則仍會顯示在量測涵蓋率中。

### 安全性與爬蟲行為

- 只允許公開的 global-unicast HTTP(S) 目標。
- 每個初始 URL、DNS 結果與 redirect 都在連線前驗證。
- 連線使用已驗證的 IP，同時 HTTP Host、TLS SNI 與憑證檢查保留原始 hostname。
- 不使用環境變數 proxy，也不做隱含的 transport 層 hostname 重新解析。
- redirect、header、壓縮／解壓後的回應、總 bytes、sitemap 走訪、頁數、並行度與時間都有上限。
- CLI 以自己的 User-Agent 表明身分，並以通用的 `geo-aeo-audit` 爬蟲身分遵守 robots.txt。各 provider 的爬蟲規則依其文件所述的產品範圍分開回報。
- site 模式只抽樣最終 origin；範圍外的探索結果與被 robots 阻擋的樣本不會抓取。
- probe 憑證只從所選 provider 的 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY` 讀取。認證 header 與等價機密不會出現在 JSON、HTML、metadata、fixture 或錯誤訊息中。
- probe 不抓取被引用的 URL。比對只使用輸入 URL、觀測到的最終 redirect URL，以及 robots 允許下取得的 canonical URL，並以 PSL 做 domain 比較。
- Ora 整合只連線到固定的 `https://ora.ai` origin、拒絕 HTTP redirect，且不傳送憑證。只有 `--scan` 會把正規化後的目標 URL 交給 Ora 並觸發第三方掃描。

### 量測限制

這是靜態 HTTP 稽核，不是瀏覽器渲染器。當初始 HTML 看起來需要 client-side rendering 時，報告會輸出 `not_tested` 並附上「需要瀏覽器渲染才能確認」；它不會宣稱內容不存在或所有 AI 產品都無法使用。

provider 網路路徑的可達性、WAF 白名單、即時索引狀態、排名、檢索、答案生成與被引用機率，都無法由本稽核證明。官方未確認的產品介面會以風險訊號或 `not_asserted_for` 呈現，不會當成確定的資格 blocker。

### Exit codes

| 代碼 | 意義 |
|---|---|
| 0 | audit 完成且未達門檻；probe 完成並產出可回報的 attempt；或 Ora 產出完整／partial 結果。 |
| 1 | audit 完成但達到 `--fail-on` 門檻。probe 與 Ora 不會回傳 1。 |
| 2 | CLI 用法或設定錯誤。 |
| 3 | 命令或要求的報告輸出無法完成；例如 Ora 無快取、rate limited 或回應無效。 |

`--fail-on blocker` 在出現任何 blocker 時回傳 1；`--fail-on error` 在出現 blocker 或 `error` finding 時回傳 1。一般非阻斷的 `fail` finding 不會單獨改變 exit code。能以完整報告呈現的傳輸失敗會以 `transport_or_protocol` blocker 輸出，並遵循所選門檻。

### 測試

```bash
pnpm run typecheck
pnpm test
```

測試套件會先建置 CLI，然後執行單元測試、合成 provider／Ora fixture 整合測試、本機 HTTP fixture、JSON Schema 相容性、HTML 安全性與 CLI 端到端測試。測試不會存取真實公開網站、不呼叫付費模型 API、也不修改被稽核的網站。

---

## English

`geo-aeo-audit` is a read-only CLI for reproducible GEO/AEO observations of public HTTP(S) pages. The default `audit` command checks bounded technical access, crawler policies, discovery signals, static content, entities, and evidence signals without calling a model API. The opt-in `probe` command calls a selected provider API to observe web search and citations; it may incur provider charges. The `ora` command reads an Ora cache entry or explicitly requests an Ora scan with `--scan`.

The report describes observable readiness and provider-specific eligibility controls. It does not predict citation probability and does not produce a single overall score.

### Requirements and build

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
pnpm dev probe https://example.com/ --prompts prompts.json --provider openai --model gpt-5 --repeats 1
pnpm dev ora https://example.com/
```

The package is published to npm and runs without a clone:

```bash
npx geo-aeo-audit audit https://example.com/
```

The package exposes the `geo-aeo` binary when installed or linked as a package. A `prepare` script compiles `dist/` on install, so unreleased versions can also run straight from GitHub:

```bash
npx github:kurotanshi/geo-aeo-audit audit https://example.com/
```

### Usage

```text
geo-aeo audit <url> [options]
geo-aeo probe <url> [options]
geo-aeo ora <url> [options]
geo-aeo --help
geo-aeo --version
```

Each command has its own option set and `--help`; flags from one command are rejected by the other.

#### Static audit

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

Audit options:

- `--site` — discover and audit a bounded, deterministic sample within the final URL's origin. Single-page mode is the default.
- `--fail-on <blocker|error|never>` — select the exit-code threshold. The default is `blocker`.
- `--json` / `--no-json` — enable or suppress JSON stdout. JSON is enabled by default.
- `--html <path>` — write a self-contained HTML report to the selected path.

Ruleset `0.3.0` adds eight rules. These mappings are a static semantic crosswalk to Ora `1.21.0` checks; they do not imply that both tools produce identical results:

| Local rule | Ora check | Mapping | Boundary |
|---|---|---|---|
| `technical.llms_txt` | `llms-txt-exists` | `partial` | Probes both standard locations and additionally requires at least 100 characters of non-HTML content. |
| `technical.not_found_status` | `agent-friendly-404` | `partial` | Verifies 404/410 status but does not grade Markdown guidance in the error body. |
| `technical.markdown_negotiation` | `markdown-negotiation-vary`, `markdown-negotiation` | `partial` | Verifies `Accept: text/markdown` and `Vary: Accept`; static `.md` paths are not probed. |
| `technical.trust_pages` | `trust-anchors` | `partial` | Selects same-origin about/contact/privacy links from the primary page rather than fixed paths. |
| `technical.redirect_hygiene` | `redirect-hygiene` | `partial` | Detects client-side redirect stubs but does not measure cross-domain HTTP redirect depth. |
| `content.open_graph` | `metadata-completeness` | `composite` | Combines with `technical.canonical` and `content.language` to cover the four metadata fields. |
| `content.document_landmarks` | `ax-document-structure` | `composite` | Combines with `content.heading_structure` to cover landmarks and headings. |
| `content.entity_same_as` | `json-ld-entity-linking` | `equivalent` | A Person or Organization must expose at least one valid HTTPS `sameAs` URL. |

The first four origin probes run once in both page and site mode, identify with this tool's User-Agent, obey robots.txt, restrict redirects to the origin, and count against the existing total-byte budget. The full Ora crosswalk also records deliberately unported checks; this tool never impersonates another crawler User-Agent for measurement.

#### Citation probe

Create a UTF-8 JSON prompt file:

```json
["Which sources explain this topic?", "What changed recently?"]
```

Set only the selected provider's credential, then run the probe:

```bash
export OPENAI_API_KEY="..."
geo-aeo probe https://example.com/article \
  --prompts prompts.json --provider openai --model gpt-5 \
  --repeats 2 --locale zh-TW --country TW --timezone Asia/Taipei \
  --html probe.html > probe.json
```

Anthropic uses `ANTHROPIC_API_KEY` and `--provider anthropic`. Supported providers are only `openai` and `anthropic`; Google Gemini is intentionally unsupported. Prompt files may contain 1–20 non-empty strings, each up to 8 KiB and 256 KiB total. Repeats must be 1–10, with at most 100 total attempts.

Attempts run sequentially in prompt order, then repeat order, with no implicit retries and a fixed 30-second deadline per attempt. Anthropic `pause_turn` continuation is protocol handling, bounded to three continuations. The target URL and locally observed redirect/canonical aliases are used only for citation matching; the CLI does not inject them into prompts, domain filters, URL context, or provider tool settings.

Probe options:

- `--prompts <path>` — required. UTF-8 JSON array of prompt strings.
- `--provider <openai|anthropic>` — required. Selects the adapter and the credential variable.
- `--model <id>` — required. Passed to the provider verbatim; the returned model is recorded separately.
- `--repeats <n>` — required. Repetitions per prompt, 1–10.
- `--locale <tag>` — BCP 47 tag recorded as experiment metadata and used for grouping. It is not sent to the provider.
- `--country <code>` / `--timezone <id>` — ISO 3166-1 alpha-2 country and IANA timezone, sent as the provider's approximate `user_location`.
- `--json` / `--no-json`, `--html <path>` — behave like the audit command.

Provider adapters use the surfaces below. The adapter version and API surface are written into every result so runs remain comparable.

| Provider | API surface | Search tool | Notes |
|---|---|---|---|
| `openai` | Responses API (`responses.web_search`) | `web_search` with `include: web_search_call.action.sources`, `store: false` | Retrieved sources come from the search call; cited sources come from `url_citation` annotations. |
| `anthropic` | Messages API (`messages.web_search`) | `web_search_20250305`, `max_uses: 5` | Retrieved sources come from `web_search_tool_result`; cited sources come from text citations with `cited_text`. |

#### Ora readiness

By default, the command reads the hostname's cached report from a fixed Ora endpoint and does not fetch the target site:

```bash
geo-aeo ora https://example.com/ --html ora.html > ora.json
```

When no cache entry exists, the CLI suggests `--scan`. This sends the normalized target URL to third-party Ora and asks Ora to scan the site, subject to Ora scan and rate limits:

```bash
geo-aeo ora https://example.com/ --scan
```

The Ora command reads and sends no API key, cookie, or other credential. `--json` / `--no-json` and `--html <path>` behave like the other commands. Ora scores remain independent from local audit scorecards; the crosswalk describes semantic overlap only.

### Reports

The JSON envelope follows [schemas/audit-result.schema.json](schemas/audit-result.schema.json). It includes:

- `schema_version`, `tool_version`, and `ruleset_version`;
- the requested and conservatively normalized URL;
- URL-normalization, deterministic-sampling, resource-limit, and PSL-use metadata;
- per-rule findings and product-scoped blockers;
- five category scorecards with measurement coverage;
- sampled URL, SHA-256 hash, and fetch/robots state in site mode.

Site scope is based on the exact final origin, so a Public Suffix List is not used. The JSON records this explicitly with `public_suffix_list.used: false` and null package/data versions.

The HTML report contains the same audit information, inline CSS, and a restrictive Content Security Policy. It contains no JavaScript, does not embed raw JSON, HTML-encodes untrusted values, and only creates links for validated HTTP(S) source URLs.

#### Probe results

Probe JSON follows [schemas/probe-result.schema.json](schemas/probe-result.schema.json) and is independent of the audit envelope. It contains:

- `experiment` — provider, requested model, adapter version, API surface, prompts, repeats, search settings, and timeout;
- `target` — requested URL, final URL, declared canonical, robots state, provenance-tagged aliases, PSL package/data version, and observation limitations;
- `attempts` — one entry per prompt × repeat with timing, outcome, search status, citations with local target match, the normalized provider response, and any error;
- `rates`, `source_overlaps`, and `limitations`.

Each attempt has exactly one outcome, chosen in this priority order: `timeout`, `provider_error`, `normalization_error`, `completed_tool_error`, `completed_refusal`, `completed_no_search`, `completed_answer`. The four `completed_*` outcomes form the completed set. Search status is recorded separately as `used`, `not_used`, `tool_error`, `not_exposed`, or `unavailable`; fields a provider does not expose carry a `null` value with a `present` / `not_used` / `not_exposed` / `unavailable` status rather than a guess.

Rates are `search_use_rate`, `any_citation_rate`, `target_page_citation_rate`, `target_host_citation_rate`, `target_domain_citation_rate`, and `provider_error_rate`. Each records `numerator`, `denominator`, `value`, `unknown_count`, `denominator_definition`, and observable coverage. Citation and search rates are emitted in two views: `all_attempts` (end-to-end yield including provider failures) and `completed` (completed set only). A zero denominator yields `null`. Target matches are graded `exact_input_url`, `exact_final_url`, `target_declared_canonical`, `same_hostname`, or `same_registrable_domain`; the most precise level is kept. Source overlap is the pairwise Jaccard of cited URLs and cited registrable domains between completed attempts in the same provider/model/API-surface/search-settings group, `null` when both sets are empty.

The probe HTML report safely encodes provider output and retains source attribution. Probe observations apply only to the named API, model, search settings, locale, and execution time. They do not represent consumer ChatGPT or Claude behavior and do not predict future citations.

#### Ora results

Ora JSON follows [schemas/ora-result.schema.json](schemas/ora-result.schema.json) and is independent of the audit and probe envelopes. It preserves Ora's score, grade, layers, essentials, and top-fix order, then adds request mode, cache metadata, a local-rule crosswalk, and limitations. A scan that reaches the five-minute or fifteen-poll limit still emits an `analysisStatus: partial` result and exits 0. The HTML report contains no JavaScript and safely encodes Ora response content.

#### Finding results

| Result | Meaning |
|---|---|
| `pass` | The bounded static observation satisfied the rule. |
| `fail` | The observation did not satisfy the rule. |
| `not_applicable` | The rule does not apply, such as article-only guidance on a non-article page. |
| `not_tested` | A robots, fetch, rendering, or other measurement limitation prevented the check. |
| `error` | The measurement itself failed; this is not converted into a rule failure. |

Every finding records an evidence kind and claim scope. `heuristic` findings are marked experimental, and informational/experimental findings do not enter category scores. `not_applicable`, `not_tested`, and `error` are excluded from score denominators; unmeasured rules remain visible in measurement coverage.

### Security and crawler behavior

- Only public global-unicast HTTP(S) targets are allowed.
- Every initial URL, DNS result, and redirect is validated before connection.
- Connections use a verified IP while HTTP Host, TLS SNI, and certificate checks retain the original hostname.
- Environment proxies and implicit transport-level hostname re-resolution are not used.
- Redirects, headers, compressed/decompressed responses, total bytes, sitemap traversal, page count, concurrency, and time are bounded.
- The CLI identifies itself with its own User-Agent and follows robots.txt as the generic `geo-aeo-audit` crawler. Provider crawler rules are reported separately according to each documented product scope.
- Site mode samples only the final origin. Out-of-scope discoveries and robots-blocked samples are not fetched.
- Probe credentials are read only from `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for the selected provider. Authentication headers and equivalent secrets are excluded from JSON, HTML, metadata, fixtures, and errors.
- Probe citations are not fetched. Matching uses only the input URL, observed final redirect URL, and a robots-permitted canonical URL with PSL-backed domain comparison.
- The Ora integration connects only to the fixed `https://ora.ai` origin, rejects HTTP redirects, and sends no credentials. Only `--scan` sends the normalized target URL to Ora and triggers a third-party scan.

### Measurement limitations

This is a static HTTP audit, not a browser renderer. When the initial HTML appears to require client-side rendering, the report emits `not_tested` with “需要瀏覽器渲染才能確認”; it does not claim the content is absent or unusable by every AI product.

Provider network-path reachability, WAF allowlists, live indexing state, ranking, retrieval, answer generation, and citation probability cannot be proven by this audit. Officially unconfirmed product surfaces are reported as risk signals or under `not_asserted_for`, not as definitive eligibility blockers.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Audit completed without meeting its threshold, a probe produced reportable attempts, or Ora produced a complete/partial result. |
| 1 | Audit completed but the selected `--fail-on` threshold was met. Probe and Ora never return 1. |
| 2 | CLI usage or configuration error. |
| 3 | The command or requested report output could not complete, including a missing Ora cache entry, rate limit, or invalid response. |

`--fail-on blocker` returns 1 when any blocker is emitted. `--fail-on error` returns 1 for blockers or `error` findings. Ordinary non-blocking `fail` findings do not independently change the exit code. Transport failures that can be represented in a completed report are emitted as `transport_or_protocol` blockers and follow the selected threshold.

### Tests

```bash
pnpm run typecheck
pnpm test
```

The test suite builds the CLI and runs unit, synthetic provider/Ora fixture integration, local HTTP fixtures, JSON Schema compatibility, HTML-safety, and CLI end-to-end tests. Tests do not access real public sites, call paid model APIs, or modify audited sites.
