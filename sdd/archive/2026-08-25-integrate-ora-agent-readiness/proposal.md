---
schema_version: 2
---
# integrate-ora-agent-readiness

## 狀態
completed

## 類型
新功能

## 為什麼做
Ora（ora.ai）是 Vercel 合作的 is-agentic.com 背後的引擎，提供免 key 的公開 agent-readiness 評分 API 與一份 `agent-ready-website` skill（audit → 修正 → 重新 audit 的修復 playbook）。本 repo 的靜態 `audit` 目前聚焦搜尋引擎／AI 搜尋的 GEO／AEO 準備度，缺少 Ora essentials 讀數所涵蓋、且對「被 AI agent 讀取與引用」同樣重要的幾個可靜態量測訊號：`llms.txt`、不存在路徑是否真的回 404、Markdown 內容協商、meta-refresh／JS-only redirect、about／contact／privacy 信任頁存在且有實質內容、Open Graph 的 `og:type`／`og:image`、`<main>`／`<nav>` landmark、JSON-LD `sameAs` 實體連結。

兩件事要一起做：（1）以 Ora 1.21.0 catalog 中「本工具用既有 fail-closed transport 就能量測、且不需要偽裝 crawler UA」的 check 為參考，設計對應的本地規則，讓 `audit` 不依賴外部服務也能覆蓋這些訊號；本地規則與 Ora check 的語意不會完全相同，差異一律在 crosswalk 的 `mapping` 欄位明示，不宣稱等價。（2）新增 `geo-aeo ora <url>` 命令，讀取 Ora 公開 API 的完整報告，依 skill 規範原樣呈現 `topFixes`／essentials，並用 crosswalk 把 Ora check id 對到本地規則 id，讓使用者能在同一套工具內對照「Ora 怎麼說」與「本工具實測到什麼」。

不做的事與原因：不對應 `bot-detection`／`agent-crawler-reachability`（需要以 ChatGPT-User、ClaudeBot 等 UA 發請求，違反本 repo「誠實自我識別、不偽裝 crawler」的原則）；不對應 API／OAuth／MCP／payments 層 check（超出公開內容頁的 GEO／AEO 範圍）；不重新實作 `content-no-js`（既有 `technical.initial_html_content` 以初始 HTML 可見文字長度觀察同一訊號，但只回 `pass`／`not_tested`、`score_impact` 為 informational，crosswalk 標 `mapping: partial`）。`npx @ora-ai/ax audit` 已能單獨取得 Ora 分數，本提案的價值在 crosswalk 與同一份報告的並列，不在重製 Ora CLI。

## 要改什麼
設計取向：沿用 `add-citation-probe` 的精神，`ora` 是獨立子命令、獨立版本化 envelope 與獨立 HTML 報告，不擴充 audit envelope；新規則走既有 `Finding`／`score_impact` 模型，沿用五類 scorecard，不新增總分。
設計取向：origin 探測接受由 `src/audit/run.ts` 依模式建立並注入的 budget-aware fetch callback；site discovery 保留內部並行 `ByteBudgetFetcher`。共用並行 budget abstraction 留待出現第三個需要跨階段並行 reservation 的 consumer 時另案處理（原因：目前 page／origin 請求為循序，只有 site discovery 需要並行 reservation）。
設計取向：第三個子命令仍在 `src/cli.ts` 內聯分派與處理，只在同檔抽取三個命令確實共用且由既有 E2E 驗收涵蓋的輸出 helper；command module 拆分留待 handler 需要獨立依賴注入或同檔結構已妨礙維護時另案處理（原因：三個命令的設定、錯誤與 exit semantics 不同，目前拆檔主要只會搬移程式碼並增加模組接線）。

### A. 靜態 audit 新規則（參考 Ora essentials，本地量測）

新增 `src/rules/origin.ts`（預估）承載每個 origin 只做一次的有界探測，在 page 與 site 模式都執行一次並計入 `maxTotalBytes`；origin finding 的 `subject_url` 為目標 origin。以下「主體頁」在 page 模式為 redirect 後的正規化最終 URL，在 site 模式為第一個 `state: fetched` 且 2xx 的樣本頁；沒有這樣的頁時，需要主體頁的探測為 `not_tested`。所有探測請求都以目標 origin 作為 `safeFetch` 的 `allowedOrigin`（含 redirect），並在發出前以 `geo-aeo-audit` token 檢查 robots.txt。robots disallow、robots.txt 無法取得（5xx 或 transport 錯誤，與 site discovery 對 RFC 9309 的處理一致）、初始抓取失敗（`technical.transport` 為 `error`，最終 origin 無法確定）、沒有主體頁或剩餘位元組預算不足為 `not_tested`；探測本身遇到 transport 錯誤或 5xx 為 `error`；已取得可判讀回應但不符合規則為 `fail`。單一探測失敗不中止 audit 或其他規則：

- `technical.llms_txt`：依序 GET `/llms.txt` 與必要時的 `/.well-known/llms.txt`（與 Ora `llms-txt-exists` 接受的兩個位置一致）；第一處未達 pass 條件時仍嘗試第二處。任一位置 2xx、Content-Type 非 HTML、內容非 HTML 且 ≥100 字元為 `pass`；兩處皆無合格內容且沒有量測錯誤為 `fail`；沒有 pass 且任一候選為 5xx／transport 錯誤時為 `error`。`score_impact: experimental`（emerging 訊號，無官方搜尋引擎背書）、`evidence_kind: heuristic`、category `discoverability`。
- `technical.not_found_status`：GET 一條確定性、不可能存在的同源路徑（以 origin 的 SHA-256 前綴組成，例如 `/geo-aeo-audit-not-found-<hex>`）。最終回 404／410 為 `pass`；2xx（soft 404）、其他 4xx 或未帶可跟隨 Location 的 3xx 為 `fail`，severity `warning`；導向後最終 2xx 亦為 `fail`；5xx 或 transport 錯誤為 `error`。`score_impact: scored`、`evidence_kind: official_behavior`（Google Search Central 對 soft 404 的說明）、category `access_and_eligibility`。Ora `agent-friendly-404` 另對 404 回應附 markdown 導引給加分，本規則不檢查回應內文（`mapping: partial`）。
- `technical.markdown_negotiation`：以 `Accept: text/markdown` 再 GET 主體頁一次。Content-Type 為 `text/markdown` 且 `Vary` 含 `Accept` 為 `pass`；回 markdown 但缺 `Vary: Accept` 為 `fail` 並在 evidence 註明；回 HTML 或 4xx 為 `fail`；5xx 或 transport 錯誤為 `error`。`score_impact: experimental`、`evidence_kind: heuristic`、category `parseability`。需在 `SafeFetchOptions` 與 audit mock 使用的 `DiscoveryFetch` options 新增選用的 `accept` header，預設維持 `*/*`。只對應 Ora `markdown-negotiation-vary`；Ora `markdown-negotiation` 另接受靜態 `/llms.md`／`.md` 路徑，本規則不探測（`mapping: partial`）。
- `technical.trust_pages`：從主體頁（site 模式為第一個成功抓取的樣本頁）的同源連結中，以路徑片段或連結文字（中英文）辨識 about、contact、privacy 三類頁，各取第一個同源候選 URL 並各 GET 一次（最多 3 次請求）；只出現跨 origin 候選（例如集團共用的隱私權頁）時不抓取、該類視為缺少，evidence 記錄該跨 origin URL 供人工判讀。三類皆找到連結、皆回 2xx、且各頁抽取的可見文字 ≥500 字元為 `pass`；缺連結、4xx 或內容不足任一為 `fail`；5xx 或 transport 錯誤為 `error`；evidence 逐類列出連結 URL、HTTP 狀態與字元數。`score_impact: scored`、`evidence_kind: official_recommendation`（Google 搜尋品質評量指南對責任主體與聯絡資訊的要求）、category `source_and_evidence`。門檻與 Ora `trust-anchors` 的「三頁各 ≥500 字元」一致，但候選 URL 來自頁面連結而非固定路徑（`mapping: partial`）。

在 `src/rules/technical.ts` 以既有回應觀察新增（不額外抓取）：

- `technical.redirect_hygiene`：初始 HTML 含 `<meta http-equiv="refresh">`，或可見文字極少且 inline script 含 `location.href`／`location.replace`／`window.location =` 指派，為 `fail`，severity `warning`；否則 `pass`；初始 HTML 未被評估（非 2xx 或 robots skip）時與 `technical.indexability` 等規則一致回 `not_tested`。`score_impact: scored`、`evidence_kind: empirical_observation`（不執行 JS 的 agent 看不到目標頁）、category `access_and_eligibility`。Ora `redirect-hygiene` 另計跨網域 HTTP 導向跳數，本規則不計（`mapping: partial`）。

在 `src/rules/content.ts` 或拆出的 `src/rules/content-trust.ts`（預估，避免單檔超過 800 行）新增：

- `content.open_graph`：`og:type` 與 `og:image` 皆存在且非空為 `pass`，否則 `fail` 並列出缺項。`score_impact: informational`、`evidence_kind: standard`、category `parseability`。Ora `metadata-completeness` 的四項訊號中，canonical 與 `<html lang>` 已分別由既有 `technical.canonical`、`content.language` 覆蓋，本規則只補剩下兩項；crosswalk 以三條規則組成 `mapping: composite`。
- `content.document_landmarks`：存在 `<main>` 或 `role="main"`，且存在 `<nav>` 或 `role="navigation"`，為 `pass`；缺任一為 `fail` 並列出缺項。`score_impact: scored`、`evidence_kind: standard`（HTML／ARIA landmark）、category `parseability`。Ora `ax-document-structure` 要求 main region、nav 與合理的 heading 順序；heading 順序由既有 `content.heading_structure` 覆蓋，crosswalk 以兩條規則組成 `mapping: composite`。
- `content.entity_same_as`：JSON-LD 中的 Person／Organization 至少一個帶有效 https `sameAs` URL 為 `pass`；有實體但無 `sameAs` 為 `fail`；無 Person／Organization 實體時 `not_applicable`。`score_impact: scored`、`evidence_kind: official_recommendation`（Google Organization 結構化資料文件）、category `freshness_and_entity`。對應 Ora `json-ld-entity-linking`（`mapping: equivalent`）。

每條新規則的 `recommendation` 以 skill 修復 playbook 的建議為基礎改寫，並在 `source_url` 標示依據。`RULESET_VERSION` 由 `0.2.0` 升至 `0.3.0`；audit envelope 結構不變，`SCHEMA_VERSION` 不動。

### B. Ora check crosswalk

新增 `src/registry/ora-checks.ts`（預估）：一張靜態表，每列包含 Ora check id、Ora 名稱、Ora essentials tier（照 Ora catalog 取值：`required`／`recommended`／`emerging`；不在 essentials 讀數內的 check 標 `excluded`）、`mapping`（`equivalent`：語意一致；`composite`：由多條本地規則合起來覆蓋；`partial`：本地規則只覆蓋一部分，說明欄寫明差異；`not_ported`：刻意不對應，說明欄寫明原因）、對應的本地規則 id 陣列（`not_ported` 時為空）、以及一句說明。第一版只列 Ora essentials 讀數會用到的 web surface check（約 30 條），並附上取得時的 `contractVersion`（目前 `1.21.0`）與日期。測試確保表內每個本地規則 id 都存在於 ruleset、Ora id 不重複、`mapping` 為 `not_ported` 時規則陣列為空且說明非空。

### C. `geo-aeo ora <url>` 命令

- 用法：`geo-aeo ora <url> [--scan] [--json|--no-json] [--html <path>]`。`<url>` 先經 `normalizeHttpUrl`，快取讀取只取 hostname 並以 `encodeURIComponent` 編碼成單一路徑 segment；命令本身不抓取目標網站。
- 預設呼叫 `GET https://ora.ai/api/score/{hostname}?include=essentials&format=audit`：免 key、只讀 Ora 快取、不啟動掃描、不耗 Ora 配額。404 表示 Ora 尚無完成的報告，CLI 以可行動訊息提示加 `--scan`，exit `INCOMPLETE`。
- `--scan` 呼叫 `POST https://ora.ai/api/scan?include=essentials&format=audit`，body `{"url": "<normalized url>"}`。200 直接使用；202 依 `Location` 每 20 秒 GET 輪詢，上限 15 次且整體 deadline 為 5 分鐘，任一上限先到即保存 `analysisStatus: partial` 並以 `SUCCESS` 結束（結果已寫出），絕不重送 POST；202 缺 `Location`、Location URL 含 username／password，或 origin 不等於 `https://ora.ai` 時 fail closed。不提供 `force`、`ephemeral`、`competitors` 與 API key；需要時另提案。
- 429 讀取 `Retry-After` 寫入錯誤訊息並 exit `INCOMPLETE`，不重試；5xx 或非 JSON 回應同樣 fail closed。Ora host 固定為 `https://ora.ai`，不可由旗標改寫；用 Node 20 內建 `fetch` 搭配 `redirect: "error"`（不跟隨任何 HTTP redirect，避免請求被導離固定 host；202 的 `Location` 由 client 驗證後才自行 GET）、30 秒 timeout 與 2 MiB 回應上限，不需要 SSRF 防護的 `safeFetch`。請求只送 hostname／URL 與本工具的 User-Agent，不送任何憑證。
- 結果寫入獨立版本化 JSON（`src/schema/ora.ts`、`schemas/ora-result.schema.json`，預估）：`schema_version`、`tool_version`、`generated_at`、`request`（endpoint、mode `cached`／`scan`、輪詢次數、HTTP status、`Age`／`x-vercel-cache` 等快取 header）、`ora`（原樣保存 `contractVersion`、`score`、`grade`、`scannedAt`、`analysisStatus`、`pendingChecks`、`layers`、`topFixes`、`essentials`）、`crosswalk`（每個出現在 `essentials.checks` 的 Ora id 附上 `mapping`、本地規則 id 與說明；不在表內者標 `unmapped`）、`limitations`（固定聲明：分數屬 Ora 的方法論、`estScoreGain` 為估計、tier 不決定分數、報告為某一時間點的快照、crosswalk 非等價宣告）。不重新計算、不重排、不合併 Ora 分數與本地 scorecard。
- HTML 報告（`src/report/ora-html.ts`，預估）沿用 audit 報告的安全規則：無 JavaScript、inline CSS、嚴格 CSP、所有 Ora 回傳值視為不可信並編碼、只為驗證過的 HTTP(S) URL 建連結。版面依 skill Step 5 格式呈現：`Ora score N/100 (grade X)`、essentials 分數與 label、`topFixes` 依伺服器順序原樣列出並標示第一項為 next up、各層分數、crosswalk 表（含 `mapping` 欄）。

### D. 文件與測試

README（中英）新增 `ora` 命令說明、新規則清單與各規則對 Ora check 的 `mapping`、與 Ora／is-agentic 的關係及邊界（本工具不偽裝 UA、Ora 分數不是本工具的分數、本地規則不等於 Ora check）。AGENTS.md 補上 `ora/` 目錄。所有測試使用本地 fixtures 與 mock fetch，不連 ora.ai 或任何公開網站。

可能檔案（預估）：`src/transport/safe-fetch.ts`、`src/discovery/discover.ts`、`src/rules/origin.ts`、`src/rules/technical.ts`、`src/rules/content.ts`、`src/rules/content-trust.ts`、`src/audit/run.ts`、`src/registry/ora-checks.ts`、`src/ora/config.ts`、`src/ora/client.ts`、`src/ora/run.ts`、`src/schema/ora.ts`、`src/report/ora-html.ts`、`src/cli.ts`、`src/version.ts`、`schemas/ora-result.schema.json`、`tests/origin-rules.test.ts`、`tests/technical-rules.test.ts`、`tests/content-rules.test.ts`、`tests/ora-checks-registry.test.ts`、`tests/ora-client.test.ts`、`tests/ora-html.test.ts`、`tests/schema-compat.test.ts`、`tests/cli.e2e.test.ts`、`tests/fixtures/ora/`、`README.md`、`AGENTS.md`。

## 影響範圍
- `audit` 每次執行對目標 origin 最多多 7 次有界請求（`/llms.txt` 與必要時的 `/.well-known/llms.txt`、不存在路徑、Accept: text/markdown 的主體頁、最多 3 個信任頁），計入既有 `maxTotalBytes`；site 模式仍只做一次，不隨樣本數放大。探測失敗不影響其他規則。
- 不存在路徑的探測會在目標站 log 留下一筆 404；路徑名含 `geo-aeo-audit` 字樣以利識別。所有 origin 探測仍受目標 robots.txt 對本工具 UA 的規則約束（被 disallow 時 `not_tested`）。
- 新規則使 `ruleset_version` 升到 `0.3.0`，既有規則 id、語意與 scorecard 類別不變；`AGENT_REGISTRY` 的 `rulesetVersion` 引用同一常數，自動跟隨。HTML 報告為通用渲染，新規則自動出現。既有測試中 `tests/content-rules.test.ts` 兩處斷言 content findings 為 11 條，需改為 14；`tests/run-audit.test.ts` 對 parseability 100 分與 source_and_evidence 空分母的斷言也會受新增 scored rules 影響，應更新 fixture 使其代表完整通過頁，或改成符合該測試目的的明確斷言。`tests/run-audit.test.ts` 與 `tests/cli.e2e.test.ts` 的 fixture server 對未知路徑回 404，新探測在其上有確定性結果，不需為 404 探測另加 fallback fixture。`src/rules/technical.ts` 的 `addUnavailableContentFindings` 與 `src/rules/content.ts` 的 `CONTENT_RULES` 需納入對應新規則，使內容不可評估時新規則同樣回 `not_tested`；`tests/content-rules.test.ts:150` 的 not_tested 計數即據此由 11 變 14。
- `technical.trust_pages` 抓取的 URL 來自不可信的頁面內容，一律經 `safeFetch` 並帶 `allowedOrigin`，redirect 跨出 origin 即 `out_of_scope` 錯誤，不會抓取第三方站台。
- 本地規則參考 Ora check 設計但不等價；每條規則與 Ora check 的差異只以 crosswalk `mapping` 與說明欄記錄，README 與 `ora` 報告都不得把兩者描述成同一檢查。
- `ora` 命令會把目標 hostname（`--scan` 時為完整 URL）送到第三方服務 ora.ai；`--scan` 會讓 Ora 以其自身 crawler 與政策掃描目標站並保存公開報告，屬使用者明確選擇的外部副作用。本地權威紀錄是 CLI 寫出的 JSON；Ora 端狀態不由本工具管理。
- Ora API 免 key 但有配額（掃描 30 次／24 小時、burst 10／分鐘），預設的快取讀取不耗掃描配額，但仍受每 IP 每分鐘 10 次讀取的 rate limit，429 同樣以 `Retry-After` 回報；CLI 不自動重試 POST，避免重複扣配額。
- Ora 的 `contractVersion` 或欄位可能變動；client 以 `format=audit` 的版本化契約為準，未知欄位原樣保存不解析，缺少必要欄位時報 `INCOMPLETE` 而非猜測。
- crosswalk 是人工維護的靜態對照，附取得日期與 `contractVersion`；Ora 新增或移除 check 時需另行更新，報告中未在表內的 Ora id 標示為 `unmapped`。
- 不新增 npm 依賴。
