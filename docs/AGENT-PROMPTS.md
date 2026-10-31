# 可直接貼給 Agent 的提示詞

適用能讀寫專案與執行終端的工具。瀏覽器操作能力依 CodeSandbox、Cursor、OpenCode 或其他客戶端的實際配置，不要宣稱所有環境都有相同工具。

## 建立自己的各科教材

```text
請閱讀這個 Classroom Kit 的 AGENTS.md、README.md、docs/AUTHORING.md 與教材 schema。
科目：[填入科目]；年級：[填入年級]；主題：[填入主題]；課程時間：[填入分鐘]。
依我提供的教材整理學習目標、重點與形成性活動，產出可匯入的課程 JSON。
不確定的知識與來源標記待教師確認；不蒐集真實學生個資。
沿用課程、師生介面及答案提交契約，不為了換教材重寫登入與 D1 權限。
完成後檢查題意、答案、ID 唯一性與實際畫面，交付 JSON 與驗證結果。
```

## 登入後由 Agent 完成 Cloudflare D1 部署

```text
請把目前的 Classroom Kit 部署到我自己的 Cloudflare，使用 Workers 靜態資產＋Worker API＋D1。
先讀 AGENTS.md、docs/DEPLOYMENT.md、docs/SECURITY.md、wrangler.jsonc 與 migrations/。
核心資料與小型學生附件全部存 D1，不新增其他資料庫或物件儲存服務，不啟用付費方案。
學生個人識別碼預設關閉；若我指定開啟，設定 STUDENT_CODES_ENABLED=true，再驗證產生、分發、登入與重發。

先確認 Node.js、Wrangler、帳號、profile、專案與免費額度，沿用本專案既有資源。
使用可用的內建瀏覽器引導註冊／登入 Cloudflare 及 Wrangler OAuth；密碼、驗證碼由我親自處理。
CodeSandbox 等遠端環境需確認 OAuth 回呼。工具不足時說明必要的手動步驟；不要要求秘密貼到聊天。
確認免費額度內可建立本專案 D1 後，建立或沿用資料庫，把實際 database_id 與 DB binding 設好。
透過安全介面設定我自己的 TEACHER_PASSWORD 與 SESSION_SECRET。既有部署不要重生或輸出 Secret。
先驗證本機，再套用遠端 migrations、建置並部署。使用免費 workers.dev 網址。

學生附件透過 API 存 D1 BLOB，單檔最多 1 MiB；不要把靜態資產空間說成可直接上傳的硬碟。
部署後用合成資料驗證：教師登入建班、另一個瀏覽器的學生提交、重整後讀回、附件上傳下載、跨座號拒絕存取。
再以 Wrangler 遠端查詢核對 D1 資料；不能只憑本機或部署指令成功就宣稱完成。
我授權建立本專案必要的免費資源、修改並部署前端；學生資料不能公開。
付款、升級、刪除既有資料或必要的本人操作須先說明；其餘持續完成。
最後提供正式網址、資源名稱、實際通過及尚未驗證的檢查，並更新專案文件。
```

## 新增互動元件

```text
請依 docs/HTML-BRIDGE.md，新增能提交現有 activity 格式的互動元件。
保留 sandbox、事件來源檢查與後端作答限制，不加入外部腳本、金鑰或直接資料庫存取。
若改活動型別，同步更新型別、schema、驗證、統計、匯出、文件與相關測試。
請實際驗證教師開關題目、學生提交、重新整理讀回及手機／平板操作。
```
