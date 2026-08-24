---
schema_version: 2
---
# build-geo-aeo-audit-cli

## 狀態
approved

## 類型
新功能

## 為什麼做
內容網站目前很難用一致、可重現的方式檢查 GEO（Generative Engine Optimization）與 AEO（Answer Engine Optimization）準備度。市面上的建議經常混合官方規則、觀察性研究與未驗證的最佳實務，也容易把「可被檢索」誤寫成「一定會被 AI 引用」。

需要一套與特定網站、CMS 和部署平台無關的 CLI，輸入公開 URL 後，根據公開 HTTP 回應、robots 規則、metadata 與初始 HTML 內容評估靜態檢索準備度。工具必須保存證據、標示推論強度與測量限制，不能宣稱分數等於 citation probability 或跨平台排名。AI 搜尋 API 的實際引用探測不屬於本提案，改由獨立提案處理。

## 要改什麼
建立獨立的 Node.js／TypeScript CLI 專案 `geo-aeo-audit`，以 `pnpm` 管理套件。第一版提供 `geo-aeo audit <url>`，不需要模型 API key，抓取公開網頁、`robots.txt` 與 sitemap，執行可重現的技術與頁面內容稽核。

預設只評測指定頁面。`--site` 模式從 site scope 內的 sitemap 取樣；site scope 定義為跟隨 redirect 後最終 URL 的 origin（scheme + hostname + effective port），預設不跨 origin。sitemap 發現的 out-of-scope URL 記錄為 `discovered_but_out_of_scope` 且不抓取。取樣管線依序為：discovered → scope 內 → 語法有效 → 去重 → stable-hash deterministic sample（URL 正規化後以穩定雜湊排序取前 N，可選固定 seed）→ 評估 robots → 本 CLI 被允許才抓取。被 robots 阻擋的 URL 保留在樣本內，記為 `skipped_by_robots` 並產生 finding，不從取樣資格中預先排除。報告保存 sampling method、seed 與 discovered／scope 內／sampled 數量。資源上限包含頁數、redirect 次數、sitemap index 遞迴深度、sitemap 數量、response headers、單一資源壓縮前與解壓縮後 bytes、總下載 bytes、逾時與併發，全部作為一級設定並寫入報告 metadata。

所有 HTTP(S) 擷取共用單一安全 transport。每次初始請求與 redirect 都重新驗證 URL、hostname、port 與 DNS 結果，只允許所有解析結果皆為 public global-unicast 的目標。transport 將連線固定到已驗證的 IP，同時保留原始 hostname作為 HTTP Host、TLS SNI 與憑證 hostname 驗證依據，禁止底層在連線時重新解析 hostname。第一版不支援 proxy，且不讀取環境中的 proxy 設定；若底層 runtime 或套件無法證明未使用 proxy 或無法固定已驗證 IP，請求必須 fail closed。每次 redirect 都消耗上限並重跑同一流程；DNS rebinding、解析結果變動、IPv4／IPv6 表示轉換及非 HTTP(S) redirect 不得繞過檢查。

靜態稽核將檢查 HTTP 狀態、redirect、canonical、indexability、robots 規則、sitemap discovery、主要內容是否出現在初始 HTML、標題與 description、語言、heading 結構、Article／Person／Organization 等適用的結構化資料、作者與日期訊號、來源連結、內容更新訊號及重複 URL 線索。

AI 存取控制檢查將 agent 建模為四種 `agent_kind`：搜尋 crawler、訓練 crawler、使用者觸發 fetcher，以及沒有自己 HTTP user agent 的 product control token（如 Google-Extended）。robots 適用性等級（applies／may_apply／generally_ignored／control_token）依各 agent 的官方文件個別判定並記錄於 agent registry；`agent_kind` 不推導 robots 適用性。第一版至少辨識 Googlebot、Google-Extended、Bingbot、OAI-SearchBot、GPTBot、ChatGPT-User、Claude-SearchBot、Claude-User、ClaudeBot、PerplexityBot 與 Perplexity-User。registry 每筆資料保存 product scope、官方來源 URL、查核日期及 ruleset version；官方文件沒有明列的 surface 不自行推論。官方確認遵守 robots 的 agent 其 robots 結果可支撐對應 scope 的 blocker；官方語意為 may_apply、generally_ignored 或未確認者，robots 結果只列為風險訊號。非標準或實驗性指令只列為資訊，不當成跨平台官方規則。

規則分為「存取與資格」「可發現性」「可解析性與內容結構」「來源與證據訊號」「新鮮度與實體」及「實驗性／資訊性」。每項 finding 包含穩定 ID、結果、嚴重度、證據、來源 URL、判定依據、修正建議、證據種類與 claim_scope。證據種類分五級：official_behavior、official_recommendation、standard、empirical_observation、heuristic。blocker 分兩類：transport_or_protocol（HTTP 錯誤、DNS／TLS 失敗、redirect loop 等）與 provider_eligibility（必須有對該 product scope 適用的 official_behavior 才可宣稱）。provider_eligibility blocker 以 product_scope registry 的 applies_to／not_asserted_for 標注；官方文件未明列的 surface 一律列入 not_asserted_for。每條規則結果為 pass／fail／not_applicable／not_tested／error；類別分數 = 通過的適用且已測規則權重和 ÷ 適用且已測規則權重和。not_applicable 與 not_tested 排除於分母；not_tested 計入該類別的測量覆蓋率；error 顯示為測量錯誤而非 fail；實驗性／資訊性項目永不進分母，只列件數與建議。不輸出聲稱可預測 AI 引用機率的單一總分。

CLI 同時輸出版本化 JSON 與單檔 HTML 報告。JSON 至少保存 schema_version、tool_version、ruleset_version，以及 URL 正規化規則版本、取樣雜湊演算法、Public Suffix List 套件與資料版本等測量 metadata。URL 正規化採保守規則：小寫 scheme 與 hostname、正規化預設 port、移除 fragment、正規化空 path；不預設移除 query 參數。HTML 報告為不含 JavaScript 的 static HTML 並附 CSP。exit code 依語意分類：成功、CLI 使用／設定錯誤、稽核完成但達到失敗門檻、擷取／稽核無法完成，各為不同 exit code，並提供 `--fail-on`（blocker／error／never）。報告以 `NOT_TESTED` 明示本工具無法驗證 provider crawler 的 network-path 可達性（例如 IP allowlist 或 WAF）。測試以本機 fixture server 及固定 HTML／robots／sitemap 樣本驗證，不修改受測網站。

可能檔案（預估）：`package.json`、`tsconfig.json`、`src/cli.ts`、`src/transport/`、`src/audit/`、`src/rules/`、`src/report/`、`src/schema/`、`tests/fixtures/`、`tests/`、`README.md`。

## 影響範圍
- 新專案位於 `/Users/kurohsu/dev/geo-aeo-audit`，不修改 `/Users/kurohsu/dev/blog/blog.kurohsu.dev` 或任何被評測網站。
- 僅讀取公開 HTTP(S) 資源；不登入、不提交表單、不繞過 CAPTCHA、付費牆、robots 或其他存取控制；不偽裝官方 crawler User-Agent。
- CLI 以自己的 User-Agent（`geo-aeo-audit/<版本>` 加專案 URL）發出請求，並以通用 agent 身分遵守 robots.txt。robots 對通用 agent 擋住目標頁時，頁面內容稽核記為 `skipped_due_to_robots` 的測量限制而非失敗，crawler 規則 finding 照常記錄。
- 擷取拒絕任何非 public global-unicast 解析結果，包括 loopback、私有網段、link-local、雲端 metadata、IPv4-mapped IPv6、IPv6 ULA、unspecified、shared address space、multicast、保留／文件用途位址、URL 內嵌憑證與非 HTTP(S) redirect。拒絕會記錄為 transport error。
- 回應 headers、壓縮前與解壓縮後 body、sitemap 數量與巢狀深度皆有硬上限，防止 oversized response、decompression bomb 與巨型 sitemap index 造成資源耗盡。
- HTML 報告中所有取自受測網站的資料一律視為不可信，依嵌入位置做 context-aware encoding；外部連結僅允許 `http:`／`https:`，報告不含可執行 JavaScript。
- 第一版以初始 HTML 為準，不內建完整瀏覽器渲染；主要內容只能在 JavaScript 執行後出現時，標示測量限制而不判定內容不存在。
- `--site` 僅限最終 origin 且有硬性資源上限，不做跨 origin 或全網域無界 crawler。
- agent registry、官方文件語意與套件行為在正式實作前按當時官方資料重新確認；變動以 ruleset version 隔離。
- 不建立 citation probe、Google／OpenAI／Anthropic API adapter、SaaS、Web Dashboard、帳號系統、資料庫、排程服務或跨使用者歷史比較。
- 不把結構化資料、`llms.txt`、特定段落格式或任何第三方 GEO 建議視為通用排名因素。
