# 儲存庫指南

這是跨學科互動教學模板，前端與 API 使用 Cloudflare Workers，所有持久資料使用 D1。請先讀 README.md、docs/ARCHITECTURE.md、docs/SECURITY.md 與 docs/VALIDATION.md。

## 結構與開發

- `src/`：Vite＋TypeScript 教師、學生與投影介面；`shared/`：共同型別。
- `worker/`：登入、權限、D1 儲存、附件及選用 AI；`migrations/`：D1 SQL。
- `content/`、`schemas/`：可替換的教材與格式；`tests/`：Node 與 Playwright 測試。
- `npm ci` 安裝；`npm run dev` 建立本機 D1 並啟動虛構示範；`npm run dev:secured` 使用部署模式及本機 Secrets 測試。
- `npm run check` 執行型別、測試及建置；互動變更再執行 `npm run test:e2e` 並檢視桌面、平板及手機畫面。

## 不可破壞的規則

- 正式預設 `APP_MODE=d1`，只有 `DB` 持久儲存，不新增其他資料庫或儲存服務。示範模式只供本機與合成資料，不能在正式設定失敗時自動降級。
- `STUDENT_CODES_ENABLED` 預設 `false`；關閉時不產生個人識別碼。仍保留內部班級／座號 ID。開啟時才產生 HMAC 驗證的隨機碼；變更開關或重發須撤銷舊學生登入。
- 靜態資產隨部署發布，不能當執行期間可寫入的硬碟。學生小型附件存 D1 BLOB，維持大小、數量、總量、檔案內容與下載權限檢查。
- 教師密碼、SESSION_SECRET、選用 AI key 放 Worker Secrets；不放前端、日誌、教材、Git 或聊天。維持現有 Secret，不在每次部署重新生成。
- 後端檢查身分、班級與場次；標準答案、解析與教師備註不得提前傳給學生。未啟用識別碼時不得宣稱可防止座號冒用。
- D1 原子批次與版本檢查共同防止覆寫；修改儲存必須驗證並行提交、重送去重與搶答。
- 改資料契約時同步修改型別、schema、後端驗證、前端、文件與測試。保持既有教材 ID 穩定；題意改變時換活動 ID。
- 自訂 HTML 使用 sandbox 與 bridge，不可加入 allow-same-origin、外部追蹤或直接資料庫存取。

## 部署與交付

遵守部署者的帳號與 profile；如有共用設定入口先讀取。使用者親自完成登入／OAuth／必要 Secret 輸入；Agent 負責檢查、migration、部署與驗證。公開模板不得包含私人帳號、database_id 或路徑。

新教師首次部署前設定自己的管理密碼。每份部署共用一個管理身分，不能聲稱具有獨立教師帳號或跨校隔離。不要刪除或重設既有資料庫。

提交訊息使用簡短祈使句。變更說明包含目的、影響與已執行檢查，畫面變更附截圖。最終回報區分本機通過、實際雲端部署與真實裝置測試，使用繁體中文。
