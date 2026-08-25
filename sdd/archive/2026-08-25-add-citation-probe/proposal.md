---
schema_version: 2
---
# add-citation-probe

## 狀態
completed

## 類型
新功能

## 為什麼做
靜態 audit 只能說明網站從公開 HTTP 回應觀察到的檢索準備度，不能證明特定 AI 搜尋 API 在某個時間點、模型與設定下是否真的搜尋或引用目標網站。需要一條獨立、可重複且保留完整實驗條件的 citation probe，避免把靜態分數誤解成引用機率。

Google Gemini Grounding with Google Search 的現行使用條款限制分析、儲存及程式化收集 Grounded Results、Search Suggestions 與 Links，與本工具保存逐次結果並計算引用指標的用途不相容。因此第一版只支援 OpenAI 與 Anthropic 官方 API，不包含 Google adapter；日後若有明確可用授權，必須另提案處理。

## 要改什麼
設計取向：CLI 先辨識子命令，再於現有 `src/cli.ts` 以 Node 原生 `parseArgs` 套用各自 options；新子命令沿用專屬解析，command module 抽取另案處理（原因：阻止跨子命令旗標誤用，且目前僅兩個子命令）。

在 `build-geo-aeo-audit-cli` 完成的 CLI 與版本化 schema 上新增 `geo-aeo probe <url> --prompts <file> --provider <name> --model <id> --repeats <n>`，並提供選用的 locale／country／timezone 搜尋設定。prompts 檔為 UTF-8 JSON 字串陣列，最多 20 筆、每筆最多 8 KiB、整檔最多 256 KiB；空陣列、空字串、格式錯誤或超限皆在 provider request 前拒絕。repeats 必須為 1 至 10 的整數，prompts × repeats 不得超過 100 attempts。probe 選用且可能產生成本，第一版 provider 為 OpenAI 與 Anthropic；API key 只從各 provider 專用環境變數讀取，錯誤訊息不得列出其他環境變數。

`<url>` 僅作為被觀察 target、target alias 建立與 citation matching 的本地輸入。一般實驗不得把 target URL、hostname、registrable domain 或 alias 注入 prompt、system instructions、provider domain filter、URL context、tool configuration 或其他 retrieval hint；若未來需要 constrained experiment，另提案定義，第一版不提供此模式。probe 以既有 fail-closed transport 對 target 做一次有界觀察並遵守通用 crawler 的 robots 規則；target alias set 僅由輸入 URL、成功取得的 redirect 最終 URL 及該 target 初始 HTML 唯一且有效的 canonical URL 組成。target 無法擷取、robots 阻擋或 canonical 無效時仍可用已取得的 alias 執行，並將觀察限制寫入結果；不從 finding 文字解析 alias，也不為 matching 額外擷取 cited URL。exact match 沿用 `normalizeHttpUrl` 的保守規則，不移除 query；hostname 與 registrable-domain match 使用正規化 hostname 及實作時驗證的 PSL 套件，並在 probe metadata 保存套件與資料版本。

每次 provider 呼叫保存 provider、adapter version、api_surface、API version、search tool type/version、要求與回傳模型、SDK version（未使用 SDK 時為 not_used）、執行時間、locale／country／timezone、搜尋設定、原始 prompt、完整最終回應、request/response ID、usage，以及 provider 實際揭露的 retrieved sources、cited sources、search queries、citation URL／title、answer_span 與 source_excerpt。request metadata 明確排除 API key、Authorization、`x-api-key`、cookie 及等價認證資料。每個可能缺少的欄位使用 value 加 availability status，status 為 present／not_used／not_exposed／unavailable，不使用 magic string，也不以 adapter 推測 provider 未揭露的內容。報告顯示 provider 要求的來源 attribution；不額外抓取引用 URL。

每次 attempt 只有一個 outcome：completed_answer、completed_refusal、completed_no_search、completed_tool_error、provider_error、timeout、normalization_error。分類依序為：attempt deadline 超時、provider／transport 失敗或沒有最終回應、無法 normalize、已揭露的搜尋工具錯誤、refusal、已揭露未使用搜尋，其餘可 normalize 的最終回應；第一個符合者即為唯一 outcome。前四個 completed outcome 構成 completed set；即使 refusal、沒有搜尋、沒有引用或搜尋工具回報錯誤，只要仍有可 normalize 的最終回應便屬 completed。provider／transport 失敗、逾時與無法 normalize 不進 completed set，但完整保留於 all_attempts。搜尋狀態另記為 used／not_used／tool_error／not_exposed／unavailable，與 outcome 分離。所有預定 attempts 依 prompts 檔順序及 repeat ordinal 逐一執行；失敗保留後繼續下一個預定 attempt，但不做隱含重試、併發或背景請求。

每項 rate 保存 numerator、denominator、value、unknown_count 與 denominator_definition；denominator 為零時 value 為 null。citation rate 與 search_use_rate 各提供兩個 view：all_attempts view 的分母是所有 attempts，表示包含 provider 失敗在內的端到端觀察產率；completed view 的分母是 completed set，表示 provider 已回傳可 normalize 最終回應時的觀察率。search status 為 not_exposed 或 unavailable 時不假裝為 false，計入 unknown_count，另顯示 observable coverage；completed search_use_rate 的有效分母只含 search status 可觀察的 completed attempts。provider_error_rate 只使用 all_attempts 作分母。報告不得把不同 provider、模型、locale 或 API surface 的樣本直接合併成單一比例。

指標包括 search_use_rate、any_citation_rate、target_page_citation_rate、target_host_citation_rate、target_domain_citation_rate 與 provider_error_rate。target matching 分級為 exact_input_url、exact_final_url、target_declared_canonical、same_hostname、same_registrable_domain；同一 citation 多級命中時保存最精確等級、命中 alias 與 provenance。source overlap 以相同 provider／要求模型／回傳模型／API surface／搜尋設定／locale 組內的逐次結果為比較單位，保存每一對 completed attempts 的 url_source_overlap 與 domain_source_overlap；兩者分別以正規化 cited URL 與 cited registrable domain 的集合計算 Jaccard，相同空集合為 null。跨 provider 比較必須分欄顯示，不能聚合成單一品質分數。

OpenAI adapter 使用實作時官方建議的 Responses API web search surface，區分 provider 揭露的完整 retrieved sources 與 inline cited sources。Anthropic adapter 使用實作時官方 Messages API web search tool，處理 server tool error、空結果、pause／continuation 與 citations。兩個 adapter 都以官方文件當時的 response shape 實作，使用合成或依條款允許保存的 fixtures 測試，不在自動測試中發出付費請求。

probe 結果寫入獨立的版本化 JSON，並可產生獨立、不含 JavaScript 的單檔 HTML 報告；不擴充 audit envelope。provider_error、timeout、normalization_error 或 target 觀察限制是可報告的結果，不中止其餘預定 attempts；輸入 target URL／設定無效或無法建立要求的輸出才是 CLI 層失敗。報告明確區分靜態準備度與特定 provider 的觀察結果，保存實驗 metadata、逐次 outcome、雙 view 分母、coverage 與限制聲明。結果只代表該 API、模型、設定、locale 與執行時間，不宣稱等同消費者版 ChatGPT 或 Claude，也不預測未來引用。

可能檔案（預估）：`package.json`、`pnpm-lock.yaml`、`src/cli.ts`、`src/config.ts`、`src/discovery/url.ts`、`src/transport/safe-fetch.ts`、`src/probe/`、`src/probe/providers/openai.ts`、`src/probe/providers/anthropic.ts`、`src/schema/probe.ts`、`src/report/`、`schemas/`、`tests/fixtures/providers/`、`tests/probe/`、`tests/cli.e2e.test.ts`、`README.md`。

## 影響範圍
- 依賴 `build-geo-aeo-audit-cli` 提供的 CLI、URL 正規化、安全 transport、版本化 schema 與安全 HTML 報告模式；現有 audit envelope 不提供結構化 final／canonical alias，probe 以自己的版本化結果保存 target 觀察，不解析 audit finding 文字。
- 第一版只支援 OpenAI 與 Anthropic；明確不包含 Google Gemini、Google Search Grounding、URL Context 或其他 Google adapter。
- provider API 可能產生成本與速率限制；每次執行前由使用者明確選擇 provider、prompts 與 repeats，CLI 不在背景自動重試造成額外付費。
- prompts 與 provider 回應可能含敏感資料，全部只寫入使用者指定的本機輸出；CLI 不建立遠端資料庫、遙測或跨使用者歷史。
- provider 認證資料只存在記憶體與送往所選 provider 的認證 header；schema、JSON、HTML、錯誤與 fixture 都不得保存或回顯。
- HTML 報告將 provider 回應視為不可信並做 context-aware encoding，保留官方要求的可見且可點擊 attribution。
- 模型名稱、API surface、工具版本、回應格式、使用條款與 citation 欄位可能變動；正式實作前重新查核官方文件及使用條款，adapter 以版本隔離差異。若條款不允許保存或分析所需資料，該 adapter fail closed，不以刪減 attribution 或規避條款的方式運作。
- 自動測試只使用 mock、合成或依條款允許保存的 fixtures，不呼叫真實付費 API。
- registrable-domain 判定需要 PSL 資料；新增套件前驗證維護狀態與授權，鎖定版本並將套件／資料版本寫入結果。若無法取得可靠 PSL，domain 指標標為 unavailable，不以最後兩個 hostname labels 猜測。
