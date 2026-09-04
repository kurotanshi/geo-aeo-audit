---
schema_version: 2
---
# ruleset-0-4-article-snippet-registry

## 狀態
completed

## 類型
修 bug

## 為什麼做
2026-09-03 以 Google 官方文件、各家 AI crawler 官方文件與本地 audit.json 比對後，發現三個會讓稽核結果失真的問題：

1. **列表頁被當成文章。** `src/rules/content.ts` 的 `articleLike` 把 `<article>` 元素本身當成文章訊號。驗收時對 repo 根目錄 `audit.json` 中原本失敗的 14 個列表頁重跑後，含 2 個以上 `<article>` 的 5 頁已不再誤判，但恰好 1 個 `<article>` 的 9 頁仍讓六條文章限定規則 fail。這些單卡片列表頁的 h1 在 `<article>` 外，卡片內只有 h2 與連結，且沒有 `og:type=article` 或 Article JSON-LD；因此 `<article>` 數量本身不是可靠的文章訊號。
2. **snippet 控制項沒有被檢查。** Google「AI features and your website」（更新 2025-12-10）明說限制內容進入 AI Overviews 與 AI Mode 的頁面層控制是 `nosnippet`、`data-nosnippet`、`max-snippet` 與 `noindex`。Apple 的 Applebot 文件同樣支援 `nosnippet` 排除 AI 回答；Bing 2023 年公告以 `noarchive`／`nocache` 控制內容在 Copilot 的使用。`technical.indexability` 目前把所有 directive 收進 evidence，卻只判 `noindex` 與 `none`，設了 `nosnippet` 的頁面會靜靜 pass。
3. **agent registry 過時且有缺漏。** `src/registry/agents.ts` 的 Anthropic 三筆 `officialSourceUrl` 已 301 到 support.claude.com（curl 證實）；bingbot 來源是 2012 年部落格。官方有文件的 Applebot、Applebot-Extended、Meta-ExternalAgent、Meta-ExternalFetcher、meta-webindexer、Amazonbot、Amzn-SearchBot、Amzn-User、CCBot、MistralAI-Training、MistralAI-Index、MistralAI-User、DuckAssistBot、Google-Agent、Google-GeminiNotebook 都不在 registry；FacebookBot 已從 Meta 官方清單移除，不應加入。

## 要改什麼

**A. 文章分類**
`articleLike` 改為：只有 `og:type=article` 或 Article 家族 JSON-LD 成立才視為文章；`<article>` 元素數量不再單獨構成文章訊號。沒有這兩種明確訊號的頁面，包含單一 `<article>` 卡片列表頁，文章限定規則回 `not_applicable`。代價是沒有 metadata 的純 HTML 文章頁會得到 `not_applicable`，不再得到作者與日期缺漏回饋。JSON-LD 無法解析且沒有 `og:type=article` 的頁面同樣視為非文章：`content.jsonld_validity` 仍回 `error`，六條文章限定規則回 `not_applicable` 而不是 `error`。

**B. 新規則 `technical.snippet_directives`**
- 類別 `access_and_eligibility`、`score_impact: scored`、`evidence_kind: official_behavior`。
- 來源：`<meta name="robots">`、`<meta name="googlebot">` 的 content 與 `X-Robots-Tag` header，與 `technical.indexability` 共用同一組 directive 擷取；Bing 的 `noarchive`／`nocache` 證據引用 2023 年 Bing Webmaster Blog 公告 `https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat`，該頁靜態抓取可見兩個 directive 的說明。
- 解析依 Google robots meta 規範：directive 大小寫不敏感；`max-snippet` 的冒號後允許空白（規範寫法為 `max-snippet: [number]`），因此擷取要先以逗號切分、再去除空白，而不是以空白與逗號一起切分。`X-Robots-Tag` 帶 UA 前綴的值（如 `googlebot: nosnippet`）視為適用所有 UA，與 `technical.indexability` 現行處理相同，不做 UA 區分。
- `nosnippet` 或 `max-snippet:0`（大小寫不敏感）→ `fail`，severity `blocker`，並產生 `provider_eligibility` blocker，`applies_to` 為 Google 與 Apple 官方文件所述的 AI 產品範圍（`google_ai_overviews`、`google_ai_mode`，以及 Applebot 文件對應的範圍），`not_asserted_for` 為其餘範圍。此設計與 `technical.indexability` 對 `noindex` 的處理一致；若偏好只給 warning 不產生 blocker，請在核准前提出。
- `noarchive` 或 `nocache` → `fail`，severity `blocker`，blocker `applies_to` 僅 Bing Copilot 範圍。
- `data-nosnippet` 屬性只計數並寫入 evidence，不影響結果，因為它是局部排除。
- 無上述 directive → `pass`。頁面未取得、非 2xx 或因 robots 略過時 → `not_tested`，與現有 content 規則的 unavailable 路徑一致。
- `technical.indexability` 的判定邏輯不變；其 noindex blocker 的 `applies_to` 與 finding 的 `claim_scope` 擴充涵蓋 `google_ai_overviews` 與 `google_ai_mode`，因為 Google「AI features and your website」把 `noindex` 與 `nosnippet` 列為同一組 AI 內容控制項。

**C. registry 更新**
- 既有項目：Anthropic 三筆來源改 `https://support.claude.com/...` 同路徑；bingbot 來源改正規 Bing 官方 crawler 說明頁（`https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0`）；Googlebot `productScopes` 加入 `google_ai_overviews`、`google_ai_mode`；bingbot `productScopes` 加入 Bing Copilot 範圍；`CHECKED_AT` 改 `2026-09-03`（全部 11 筆已於當日重新核對）。
- 新增上列 15 個 token，`robotsApplicability` 依各官方頁面逐一填寫：Applebot、Meta-ExternalAgent、meta-webindexer、Amazonbot、Amzn-SearchBot、CCBot、MistralAI 三筆、DuckAssistBot 預期為 `applies`；Applebot-Extended 為 `control_token`；Meta-ExternalFetcher、Amzn-User 為 `may_apply`；Google-Agent、Google-GeminiNotebook 為 `generally_ignored`。實作時每筆都要以官方頁面核對 token 與 robots 說法，核對不到的不加並在完成回報中列出。
- `provider` 型別聯集擴充為涵蓋 apple、meta、amazon、commoncrawl、mistral、duckduckgo。
- `RULESET_VERSION` 由 `0.3.0` 升為 `0.4.0`。

設計取向：AI 產品範圍字串沿用現有 `GOOGLE_NOINDEX_SCOPES` 模式，在 `technical.ts` 以常數列出、在 registry 的 `productScopes` 同步列出，兩處以測試比對一致；集中為單一來源另案處理（原因：本提案只修正判定與 registry 內容，不改資料形狀）。

**保持不變**
- `SCHEMA_VERSION` 維持 `1.1.0`；新 finding id 與新 claim scope 都是既有 schema 允許的字串，不改 `schemas/audit-result.schema.json`。
- Ora crosswalk（`src/registry/ora-checks.ts`）、README、CLI 選項不變。

**不在範圍**
- 評估中的第四項（schema 系列規則降級、可見日期偵測、`initial_html_content` 改 scored）與第五項（Organization 子型別、hreflang、中文日期格式）。
- Bytespider、xAI、Felo、Cohere、Brave、You.com：無官方文件或官方明言不適用 robots，不加入。

## 影響範圍
- `src/rules/content.ts`：`articleLike` 判定（一處）。
- `src/rules/technical.ts`：新增 `auditSnippetDirectives`，unavailable 路徑的規則清單加入新 id，directive 擷取抽成共用並改為逗號切分；noindex 的 Google 範圍常數擴充 AI 範圍；Bing directive 的 finding source URL 改引用 2023 年公告。
- `src/registry/agents.ts`：`provider` 型別、`CHECKED_AT`、既有 URL 與 scopes、新增 15 筆。
- `src/report/html.ts`：`ZH_TW_FINDINGS` 加 `technical.snippet_directives` 中文文案；`technical.robots.*` 走既有通用翻譯，不需逐筆新增。
- `src/version.ts`：`RULESET_VERSION`。
- 測試：`tests/content-rules.test.ts`（新增列表頁案例；另有三個既有案例只靠 `<article>` 元素取得文章判定，分別是無效 JSON-LD 回 error、可見作者與日期 fallback、同源導覽不算外部來源，需補上 `og:type=article` 讓原斷言繼續成立）、`tests/technical-rules.test.ts`（新增 snippet 案例）、`tests/agent-registry.test.ts`（token 清單與 checkedAt）、`tests/run-audit.test.ts`（ruleset 版本字串）、`tests/html-report.test.ts`（新規則 zh-TW 文案，預估）。
- 報告副作用：每頁 `technical.robots.*` finding 由 11 條增為 26 條，`access_and_eligibility` 類別的分母隨之變大。這是既有設計的延伸，不另做加權。
- 驗證命令：`pnpm run typecheck`、`pnpm test`（AGENTS.md 已宣告）。
