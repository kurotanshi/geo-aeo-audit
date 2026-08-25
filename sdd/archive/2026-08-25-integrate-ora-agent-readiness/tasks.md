# integrate-ora-agent-readiness 任務

- [x] 實作每 origin 一次的 `technical.llms_txt`（依序探測 `/llms.txt` 與必要時的 `/.well-known/llms.txt`）與 `technical.not_found_status` 探測，接入 page 與 site 模式、遵守 robots 與 `allowedOrigin`、計入位元組預算，以 mock fetch 驗證 pass／fail／error／fallback、robots disallow／robots 無法取得／初始抓取失敗的 not_tested 與預算耗盡行為
- [x] 在 `SafeFetchOptions` 與 `DiscoveryFetch` options 新增選用 `accept` header 並實作 `technical.markdown_negotiation`（Accept: text/markdown 二次抓取主體頁、Vary 檢查、experimental），以 mock fetch 驗證 markdown 有／無 Vary、HTML、4xx 與 5xx 五種結果
- [x] 實作 `technical.redirect_hygiene`（meta refresh 與 JS-only redirect stub 偵測，含內容不可評估時的 not_tested），以 fixtures 驗證正常頁、meta refresh 頁、JS redirect stub、含 `location` 字樣但內容充足的頁面與非 2xx 頁
- [x] 實作 `technical.trust_pages`（從主體頁辨識 about／contact／privacy 同源連結、各抓一次、≥500 可見字元），以 mock fetch 驗證全有、缺連結、僅跨 origin 連結且不發出跨 origin 請求、頁面 404／5xx、內容不足與中文連結文字的情境，並更新 `tests/run-audit.test.ts` 受影響的 source_and_evidence 斷言
- [x] 實作 `content.open_graph`（og:type／og:image）、`content.document_landmarks`（main 與 nav 皆須存在，含 role 等價）與 `content.entity_same_as`，以 fixtures 驗證缺 og 標籤、缺 main、缺 nav、`role="main"`／`role="navigation"`、有實體無 sameAs、無實體 not_applicable 與非 https sameAs，並更新 `tests/content-rules.test.ts` 的 findings 數（11→14）與 `tests/run-audit.test.ts` 的 parseability 斷言
- [x] 建立 `src/registry/ora-checks.ts` 靜態 crosswalk（Ora id、名稱、essentials tier、`mapping` 為 equivalent／composite／partial／not_ported、本地規則 id、說明、contractVersion 與日期），並以測試確保表內每個本地規則 id 都出現在既有規則函式對 fixture 的輸出 finding id 中、Ora id 不重複、not_ported 列無規則且有說明
- [x] 將 `RULESET_VERSION` 升為 `0.3.0`，在 README（中英）新增新規則清單與各規則對 Ora check 的 mapping，確認全部測試與 HTML 報告在新規則下通過
- [x] 實作 `ora` 命令的設定解析、Ora client（GET 快取讀取、`--scan` POST、202 輪詢次數與 5 分鐘整體 deadline、404／429／5xx／缺 Location／Location userinfo fail closed、固定 host、hostname 編碼、timeout 與大小上限）與版本化 JSON envelope／schema，以 mock fetch 驗證各 HTTP 情境且不重送 POST
- [x] 實作 `ora` 安全單檔 HTML 報告（無 JavaScript、topFixes 原樣順序、essentials、各層分數、含 mapping 欄的 crosswalk、限制聲明），以 fixtures 驗證 HTML 注入防護與非 HTTP(S) URL 不建連結
- [x] 完成 `ora` CLI 接線、`--help`、schema-compat 與端到端測試、README（中英）與 AGENTS.md 文件，驗證缺 hostname、404 提示 `--scan`、429 Retry-After 訊息與測試不連外網

## 驗收條件
- 情境：對一個提供 `/llms.txt` 純文字、對不存在路徑回 404、about／contact／privacy 三頁可從主體頁連到且各 ≥500 字元、頁面含 `<main>` 與 `<nav>`、og:type／og:image 與帶 `sameAs` 的 Organization JSON-LD 的 mock 站執行 `audit`，八條新規則皆為 `pass`，且 `ruleset_version` 為 `0.3.0`。
- 情境：mock 站 `/llms.txt` 回 404 或回 200 HTML app shell，但 `/.well-known/llms.txt` 回純文字 ≥100 字元，`technical.llms_txt` 為 `pass` 且 evidence 記錄實際命中的路徑；兩處皆無合格內容為 `fail`；沒有 pass 且任一候選為 5xx／transport 錯誤時為 `error`。
- 情境：mock 站對不存在路徑回 200 app shell，`technical.not_found_status` 為 `fail`、severity `warning`、evidence 含探測路徑與 HTTP 狀態，且探測路徑含 `geo-aeo-audit` 字樣；5xx 或 transport 錯誤時為 `error`。
- 情境：主體頁有 about／contact／privacy 連結但其中一頁回 404 或可見文字 <500 字元，`technical.trust_pages` 為 `fail`；5xx 或 transport 錯誤為 `error`；evidence 逐類列出 URL、狀態與字元數。缺任一類連結、或該類只有跨 origin 連結時亦為 `fail`，evidence 指出缺少的類別並記錄跨 origin URL，且 mock fetch 未收到任何跨 origin 請求。
- 情境：robots.txt 對本工具 UA disallow 探測路徑、robots.txt 無法取得、初始抓取失敗、剩餘預算不足或 site 模式沒有成功主體頁時，受影響的 origin 探測規則為 `not_tested`；5xx 或 transport 錯誤時僅受影響規則為 `error`；其他規則不受影響，audit 正常結束。
- 情境：site 模式抽樣多頁時，origin 探測各只發出一次（信任頁最多 3 次），主體頁為第一個成功抓取的樣本，並計入 `maxTotalBytes`；預算耗盡時探測為 `not_tested` 而非拋錯；沒有任何成功樣本時需要主體頁的探測為 `not_tested`。
- 情境：`technical.markdown_negotiation` 在回 `text/markdown` 但無 `Vary: Accept` 時為 `fail` 且 evidence 說明缺 Vary；回 HTML 或 4xx 時為 `fail`；5xx 時為 `error`；`score_impact` 皆為 `experimental`，不影響 scorecard 分數。
- 情境：`content.document_landmarks` 在有 `<main>` 但無 `<nav>`／`role="navigation"` 時為 `fail` 並指出缺 nav；`content.open_graph` 只因缺 og:title 或 og:description 不會 `fail`。
- 情境：`content.entity_same_as` 在頁面無 Person／Organization JSON-LD 時為 `not_applicable`，不計入分母。
- 情境：crosswalk 中 `metadata-completeness` 對應 `technical.canonical`、`content.language`、`content.open_graph` 且 `mapping` 為 `composite`；`ax-document-structure` 對應 `content.document_landmarks`、`content.heading_structure` 且為 `composite`；`trust-anchors`、`agent-friendly-404`、`redirect-hygiene`、`markdown-negotiation-vary`、`content-no-js` 為 `partial` 並在說明欄寫出差異；`bot-detection` 與 `agent-crawler-reachability` 為 `not_ported` 且說明註明因不偽裝 UA。
- 情境：`geo-aeo ora https://example.com/path` 只以 `example.com` 呼叫 `GET /api/score/example.com?include=essentials&format=audit`，不對 example.com 發出任何請求，JSON 原樣保存 `score`、`grade`、`layers`、`topFixes`、`essentials`，`topFixes` 順序與 Ora 回應完全一致。
- 情境：Ora 回 404 時 CLI 輸出提示使用 `--scan` 並以 `INCOMPLETE` 結束；回 429 時錯誤訊息包含 `Retry-After` 秒數且不重試；回 5xx、非 JSON、HTTP redirect、或 202 缺 `Location`／Location 含 userinfo／origin 不等於 `https://ora.ai` 時 fail closed。
- 情境：`--scan` 收到 202 時依 `Location` 輪詢，mock 於第 3 次回 200 則結果為 `complete` 且 POST 只發出一次；15 次或 5 分鐘整體 deadline 先到時保存 `partial` 結果、照實標示並以 `SUCCESS` 結束。
- 情境：`ora` JSON 的 `crosswalk` 為每個 `essentials.checks` 中的 Ora id 提供 `mapping`、本地規則 id 與說明，不在表內者標 `unmapped`。
- 情境：`ora` HTML 報告不含 `<script>`，Ora 回傳的名稱與建議中的 `<script>`／引號被編碼，非 HTTP(S) 的 URL 不產生 `<a href>`，並顯示 `estScoreGain` 為估計、tier 不決定分數、快照時間、crosswalk 非等價的限制聲明。
- 情境：`ora` 請求不含任何 Authorization、API key 或 cookie header；CLI help、schema 與文件不提供 API key 選項。
- 情境：所有單元、fixture 與 CLI 端到端測試通過，且不連接 ora.ai 或任何公開網站。
