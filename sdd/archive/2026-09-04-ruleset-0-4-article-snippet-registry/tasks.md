# ruleset-0-4-article-snippet-registry 任務

- [x] 新增失敗回歸測試：含多個 `<article>` 卡片、無 og:type=article、無 Article JSON-LD 的列表頁，六條文章限定規則應為 not_applicable 且無任何 fail
- [x] 修正 `articleLike` 判定，讓列表頁測試通過，且既有單一 `<article>` 文章頁測試維持原結果
- [x] 更新 registry 既有項目：Anthropic 三筆來源 URL、bingbot 來源 URL、Googlebot 與 bingbot 的 productScopes、CHECKED_AT 改 2026-09-03，noindex blocker 的 applies_to 同步涵蓋 google_ai_overviews 與 google_ai_mode，並同步 agent-registry 與 technical-rules 測試
- [x] 逐一以官方頁面核對後新增 Applebot、Applebot-Extended、Meta 三筆、Amazon 三筆、CCBot、MistralAI 三筆、DuckAssistBot、Google-Agent、Google-GeminiNotebook，擴充 provider 型別，更新 agent-registry 測試的 token 清單；核對不到的不加並回報
- [x] 新增失敗測試：nosnippet meta、X-Robots-Tag `max-snippet:0` 與 `max-snippet: 0`（冒號後有空白）各自使 `technical.snippet_directives` 為 fail 並產生 applies_to 含 google_ai_overviews 與 google_ai_mode 的 provider_eligibility blocker；noarchive 為 fail 且 blocker 僅 Bing Copilot 範圍；`max-snippet:-1` 與無 directive 為 pass；頁面不可用為 not_tested；`technical.indexability` 結果不受影響
- [x] 實作 `technical.snippet_directives`，與 `technical.indexability` 共用 directive 擷取，讓第 5 條測試通過
- [x] 為 `technical.snippet_directives` 補 zh-TW 報告文案，並以 html-report 測試確認 zh-TW 報告中該 finding 的 rationale 與 recommendation 不回落英文
- [x] RULESET_VERSION 升為 0.4.0，更新 run-audit 測試的版本字串，`pnpm run typecheck` 與 `pnpm test` 全部通過
- [x] 新增失敗回歸測試：只有一個 `<article>` 卡片、頁面唯一的 h1 在卡片外、無 `og:type=article` 且無 Article JSON-LD 時，六條文章限定規則應為 `not_applicable` 且無任何 `fail`
- [x] 修正 `articleLike` 只接受 `og:type=article` 或 Article 家族 JSON-LD，讓單卡片列表頁回歸測試通過；為三個只靠 `<article>` 元素取得文章判定的既有 content-rules 測試 fixture 補上 `og:type=article`，維持其原斷言，其餘既有文章頁結果不變
- [x] 修正 Bing 證據與 crawler 來源：`technical.snippet_directives` 的 Bing directive source URL 改為 2023 年 Bing Webmaster Blog 公告，bingbot `officialSourceUrl` 改為正規 `/help/which-crawlers-does-bing-use-8c184ec0`，並同步測試

## 驗收條件
- 情境：對 audit.json 中原本失敗的 14 個 `/tags/*.html`／`/misc/` 型列表頁重跑 audit，六條文章限定規則全為 `not_applicable` 且沒有任何 `fail`，包含恰好一個 `<article>` 卡片的 9 頁
- 情境：單一 `<article>` 且含 Article JSON-LD 的文章頁，所有 content 規則結果與 0.3.0 相同
- 情境：頁面含無法解析的 JSON-LD、無 `og:type=article`，`content.jsonld_validity` 為 error，六條文章限定規則為 not_applicable
- 情境：頁面含 `<meta name="robots" content="nosnippet">`，`technical.snippet_directives` 為 fail，blockers 中有一筆 rule_id 為該規則、applies_to 含 google_ai_overviews 與 google_ai_mode、not_asserted_for 含 chatgpt_search；`technical.indexability` 仍為 pass
- 情境：頁面 header 為 `X-Robots-Tag: max-snippet: 0`（冒號後有空白），`technical.snippet_directives` 為 fail；改為 `max-snippet:-1` 則為 pass
- 情境：頁面含 `<meta name="robots" content="noindex">`，`technical.indexability` 的 blocker applies_to 同時含 google_search 與 google_ai_overviews
- 情境：頁面無任何 snippet directive，`technical.snippet_directives` 為 pass，evidence 註明未觀察到限制指示
- 情境：頁面回 404 或因 robots 略過，`technical.snippet_directives` 為 not_tested，與其他 content 規則一致
- 情境：audit JSON 的 ruleset_version 為 0.4.0，findings 中出現 `technical.robots.apple.applebot` 等新 token 的 finding，registry 每筆 checkedAt 為 2026-09-03，`validateAgentRegistry()` 不拋錯
- 情境：`--html-lang zh-TW` 報告中 `technical.snippet_directives` 的說明與建議為中文
- 情境：`technical.snippet_directives` 遇到 `noarchive` 或 `nocache` 時，finding 的 source URL 是 2023 年 Bing Webmaster Blog 公告；bingbot finding 使用正規 crawler 說明頁 URL
- 情境：`pnpm run typecheck` 與 `pnpm test` 全部通過，schema-compat 測試對新輸出驗證成功
