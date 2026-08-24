# add-citation-probe 任務

- [ ] 定義版本化 probe schema、prompts／repeats／locale 設定、provider 介面、target alias provenance 與專用憑證讀取，並以 mock 驗證 target 資訊不會進入 provider request
- [ ] 實作 attempt outcome、search status、completed set、雙 view 分母、unknown／coverage 與 target matching／source overlap 計算，讓每個指標保存可重算的 numerator 與 denominator
- [ ] 依實作時官方文件加入 OpenAI Responses API web search adapter，區分 retrieved sources 與 cited sources，保留 response metadata，並以合成或合規 fixture 驗證正常、refusal、無搜尋、無引用、tool error 及 API error
- [ ] 依實作時官方文件加入 Anthropic Messages API web search adapter，處理 search result、citation、空結果、server tool error 與 pause continuation，並以合成或合規 fixture 驗證各 outcome
- [ ] 實作 `geo-aeo probe` 的版本化 JSON 與安全單檔 HTML 報告，分 provider／模型／設定呈現逐次結果、雙 view rates、observable coverage、attribution 與限制聲明
- [ ] 完成 probe CLI 文件與端到端測試，驗證缺少憑證、零分母、未知欄位、重複執行、provider 隔離、HTML 注入防護及不發出真實付費請求

## 驗收條件
- 情境：使用者指定 OpenAI 或 Anthropic、prompts 檔與 repeats 後，每次 attempt 都保存 provider／adapter／API／tool／model／SDK／時間／locale／搜尋設定／prompt／usage／request metadata 與明確 outcome；缺少憑證時提供可行動錯誤且不洩漏其他環境變數。
- 情境：第一版 provider 清單、CLI help、schema 與文件都不包含 Google Gemini adapter；若指定 Google，CLI 回報 unsupported provider 且不發出請求。
- 情境：mock provider 收到的 request 不含 target URL、hostname、registrable domain、alias、domain filter、URL context 或其他 retrieval hint；target 資訊只在本地 matching 階段使用。
- 情境：completed_answer、completed_refusal、completed_no_search、completed_tool_error 進入 completed set；provider_error、timeout、normalization_error 只留在 all_attempts。每次 attempt 僅有一個 outcome，search status 另以 used／not_used／tool_error／not_exposed／unavailable 表示。
- 情境：每個 rate 都輸出 numerator、denominator、value、unknown_count 與 denominator_definition；all_attempts view 表示端到端產率，completed view 只使用 completed set，零分母輸出 null 而非 0、NaN 或無限值。
- 情境：search status 未揭露或無法取得時不當成未搜尋，completed search_use_rate 排除未知狀態並顯示 observable coverage；provider_error_rate 只以 all_attempts 為分母。
- 情境：每個 citation 保存 provider 實際揭露的 URL、title、answer_span 與 source_excerpt；未取得欄位為 null 並帶 present／not_used／not_exposed／unavailable status，不從任意 cited URL 補抓內容。
- 情境：target page／host／domain match 只依帶 provenance 的 target alias set 判定並保存命中 alias；source overlap 在相同 provider／模型／設定內計算，跨 provider 結果分欄顯示而不合成單一分數。
- 情境：OpenAI 與 Anthropic 的正常、refusal、無搜尋、無引用、搜尋工具錯誤、provider error、timeout 及 normalization error fixtures 都得到預期 outcome、completed membership 與分母。
- 情境：HTML 報告顯示必要 attribution，安全編碼 provider 回應，明確說明 API 測試不等同消費者版產品或未來表現，且報告本身不含 JavaScript。
- 情境：所有單元、adapter fixture integration 與 CLI end-to-end 測試通過，測試不呼叫真實付費 API。
