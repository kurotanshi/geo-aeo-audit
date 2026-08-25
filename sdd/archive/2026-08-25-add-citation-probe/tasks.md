# add-citation-probe 任務

- [x] 定義版本化 probe schema、prompts／model／repeats／locale 設定與硬上限、provider normalization 介面、專用憑證讀取及敏感 metadata 排除
- [x] 以既有安全 transport 建立帶 provenance 的 target alias set，加入 PSL metadata 與 page／host／domain matching，並以 mock 驗證 target 資訊不會進入 provider request
- [x] 實作唯一 attempt outcome 優先序、search status、completed set、雙 view 分母及 unknown／observable coverage，讓每個 rate 保存可重算的 numerator 與 denominator
- [x] 在相同 provider／模型／API surface／搜尋設定／locale 組內實作逐對 URL 與 registrable-domain Jaccard source overlap，空集合結果為 null
- [x] 依實作時官方文件加入 OpenAI Responses API web search adapter，區分 retrieved sources 與 cited sources，保留 response metadata，並以合成或合規 fixture 驗證正常、refusal、無搜尋、無引用、tool error 及 API error
- [x] 依實作時官方文件加入 Anthropic Messages API web search adapter，處理 search result、citation、空結果、server tool error 與 pause continuation，並以合成或合規 fixture 驗證各 outcome
- [x] 實作 `geo-aeo probe` runner、子命令參數驗證、循序 attempts 與獨立版本化 JSON 輸出，讓單次 provider 失敗不阻斷其餘預定 attempts
- [x] 實作獨立的安全單檔 HTML 報告，分 provider／模型／設定呈現逐次結果、雙 view rates、observable coverage、attribution 與限制聲明
- [x] 完成 probe CLI 文件與端到端測試，驗證輸入上限、缺少憑證、認證資料不外洩、零分母、未知欄位、重複執行、provider 隔離、HTML 注入防護及不發出真實付費請求

## 驗收條件
- 情境：使用者指定 OpenAI 或 Anthropic、model、有效的 UTF-8 JSON prompts 檔與 1 至 10 repeats 後，每次 attempt 都保存 provider／adapter／API／tool／model／SDK／時間／locale／搜尋設定／prompt／usage／request metadata 與明確 outcome；空白、格式錯誤、檔案／prompt／attempt 數超限或缺少憑證時，在 provider request 前提供可行動錯誤。
- 情境：API key、Authorization、`x-api-key`、cookie 及等價認證資料不出現在錯誤、JSON、HTML、schema 或 fixture；只讀取所選 provider 的專用憑證環境變數。
- 情境：第一版 provider 清單、CLI help、schema 與文件都不包含 Google Gemini adapter；若指定 Google，CLI 回報 unsupported provider 且不發出請求。
- 情境：mock provider 收到的 request 不含 target URL、hostname、registrable domain、alias、domain filter、URL context 或其他 retrieval hint；target 資訊只在本地 matching 階段使用。
- 情境：outcome 依 timeout → provider_error → normalization_error → completed_tool_error → completed_refusal → completed_no_search → completed_answer 優先序產生；completed_answer、completed_refusal、completed_no_search、completed_tool_error 進入 completed set，其餘只留在 all_attempts，search status 另以 used／not_used／tool_error／not_exposed／unavailable 表示。
- 情境：attempts 依 prompt 與 repeat ordinal 循序執行；provider error、timeout 或 normalization error 保留後繼續下一個預定 attempt，且不產生隱含重試、併發或超出 prompts × repeats 的 provider request。
- 情境：每個 rate 都輸出 numerator、denominator、value、unknown_count 與 denominator_definition；all_attempts view 表示端到端產率，completed view 只使用 completed set，零分母輸出 null 而非 0、NaN 或無限值。
- 情境：search status 未揭露或無法取得時不當成未搜尋，completed search_use_rate 排除未知狀態並顯示 observable coverage；provider_error_rate 只以 all_attempts 為分母。
- 情境：每個 citation 保存 provider 實際揭露的 URL、title、answer_span 與 source_excerpt；未取得欄位為 null 並帶 present／not_used／not_exposed／unavailable status，不從任意 cited URL 補抓內容。
- 情境：target page／host／domain match 只依帶 provenance 的 target alias set 判定並保存最精確等級與命中 alias；target 無法擷取、robots 阻擋或 canonical 無效時不從 finding 或 cited URL 補建 alias，registrable-domain 無可靠 PSL 時標為 unavailable。
- 情境：source overlap 在相同 provider／要求模型／回傳模型／API surface／搜尋設定／locale 組內輸出逐對 URL 與 registrable-domain Jaccard；相同空集合為 null，跨 provider 結果分欄顯示而不合成單一分數。
- 情境：OpenAI 與 Anthropic 的正常、refusal、無搜尋、無引用、搜尋工具錯誤、provider error、timeout 及 normalization error fixtures 都得到預期 outcome、completed membership 與分母。
- 情境：HTML 報告顯示必要 attribution，安全編碼 provider 回應，明確說明 API 測試不等同消費者版產品或未來表現，且報告本身不含 JavaScript。
- 情境：所有單元、adapter fixture integration 與 CLI end-to-end 測試通過，測試不呼叫真實付費 API。
