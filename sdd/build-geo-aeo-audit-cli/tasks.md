# build-geo-aeo-audit-cli 任務

- [x] 建立可安裝與執行的 Node.js／TypeScript CLI 骨架、設定解析、版本化結果 schema 與測試環境，讓 `geo-aeo --help`、錯誤輸入、語意化 exit code 與 `--fail-on` 行為可自動驗證
- [x] 實作 fail-closed 安全 transport：逐次 URL／DNS 驗證、固定已驗證 IP、保留 Host／TLS SNI／憑證 hostname 驗證、禁用 proxy 與隱含 DNS 重解析、限制 redirect／headers／壓縮前後 bytes／逾時，並以 fixture 驗證 DNS rebinding 與非 public 位址無法連線
- [x] 實作 origin-scoped discovery 與 deterministic sampling：robots.txt、sitemap index 遞迴、語法驗證、去重、stable-hash 取樣，以及頁數／sitemap 數／總 bytes／併發上限，讓 out-of-scope 與 robots 阻擋樣本以明確狀態保留且不被抓取
- [x] 實作技術資格與 crawler 規則稽核：以具官方來源、查核日期及 ruleset version 的 registry 建模 agent_kind、robots 適用性與 product scope，檢查 HTTP、indexability、canonical、robots、sitemap 和 JavaScript-only 測量限制
- [x] 實作頁面內容、實體與證據規則：檢查 metadata、語言、heading、適用的 JSON-LD、作者、日期、來源連結與更新訊號，並以五級證據種類與 claim_scope 標注每條規則
- [x] 實作分類 scorecard 與 scoped blockers：各類別附測量覆蓋率，實驗性／資訊性項目不計分，provider eligibility blocker 帶 applies_to／not_asserted_for，且不產生宣稱代表 citation probability 的單一總分
- [x] 實作版本化 JSON 與無 JavaScript 的單檔 HTML 報告，呈現 findings、分類分數、覆蓋率、blockers、transport errors、測量限制與 NOT_TESTED 項目，並驗證所有不可信輸入均安全編碼
- [x] 完成 CLI 使用文件與端到端驗證，涵蓋單頁稽核、sitemap 取樣、robots 阻擋、SSRF、無法擷取、JavaScript-only、exit code、JSON schema 相容性及 HTML 報告可開啟性

## 驗收條件
- 情境：使用者對任意公開 HTTP(S) URL 執行 `geo-aeo audit <url>`，CLI 在設定的逾時與抓取上限內完成，產生含 schema_version、tool_version、ruleset_version 及 URL 正規化／取樣雜湊／PSL 套件與資料版本的可驗證 JSON 與可直接開啟的單檔 HTML 報告。
- 情境：初始 URL、DNS 結果或任一 redirect 指向非 public global-unicast 位址時，transport 在連線前拒絕；連線只能使用已驗證 IP，HTTP Host、TLS SNI 與憑證驗證仍使用原 hostname，且不讀取環境 proxy 或在底層重新解析 hostname。
- 情境：DNS rebinding、IPv4-mapped IPv6、混合 public／non-public DNS 結果、非 HTTP(S) redirect、redirect loop、oversized headers、壓縮前／解壓縮後 body 超限及逾時 fixture 都 fail closed，且不會向被拒絕的目標送出連線。
- 情境：HTTP 錯誤、DNS 或 TLS 失敗、redirect loop 列為 transport_or_protocol finding；`noindex` 或 crawler 規則類的 provider eligibility blocker 必須帶 product scope 的 applies_to，只宣稱有 official_behavior 支撐的 scope，其餘列入 not_asserted_for。
- 情境：robots 適用性依每個 agent 的官方文件個別判定且 agent_kind 不推導適用性；registry 保存官方來源、查核日期與 ruleset version，官方未確認的 surface 只列風險訊號或 not_asserted_for。
- 情境：主要內容未出現在初始 HTML 時，報告顯示「需要瀏覽器渲染才能確認」的限制，不把它直接判定成內容不存在或無法被任何 AI 使用。
- 情境：使用 `--site` 時取樣管線為 discovered → scope 內 → 語法有效 → 去重 → deterministic sample → 評估 robots；被 robots 阻擋的樣本記為 skipped_by_robots，out-of-scope URL 記錄為 discovered_but_out_of_scope，兩者皆不抓取。
- 情境：CLI 以自己的 User-Agent 並以通用 agent 身分遵守 robots.txt；robots 允許官方 crawler 但阻擋通用 agent 時，finding 記錄官方 crawler 規則，CLI 自身則將內容稽核標為 skipped_due_to_robots 的測量限制。
- 情境：每項 finding 都有規則 ID、結果、嚴重度、證據、判定依據、修正建議、五級證據種類與 claim_scope；實驗性／資訊性項目不進入任何數值分數。
- 情境：not_applicable 與 not_tested 不計入類別分數分母，not_tested 反映於測量覆蓋率，error 顯示為測量錯誤而非 fail，非 article 頁面不因 article 規則不適用而扣分。
- 情境：受測頁面內容含 `</script>`、HTML、attribute 或惡意 URL payload 時，產出的 HTML 報告不執行注入內容、不產生非 HTTP(S) 外部連結，且報告本身不含 JavaScript。
- 情境：所有單元、fixture integration 與 CLI end-to-end 測試通過，測試不存取真實公開網站、不呼叫模型 API，也不修改受測網站。
