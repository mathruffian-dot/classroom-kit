# 部署到自己的 Cloudflare

這份模板只需 Cloudflare Workers、靜態資產及 D1。每份部署有自己的教師管理密碼與資料庫。核心授課不依賴 AI。

## 1. 本機體驗

安裝 Node.js 24，執行 `npm ci`、`npm run dev`。腳本自動套用本機 migrations，啟動本機 D1 的虛構示範。正式設定預設為 `APP_MODE=d1`，本機體驗由啟動參數暫時切為 demo，不改部署設定。

## 2. 帳號與 D1

使用平台內建瀏覽器或官方登入頁完成 Cloudflare 登入、驗證及 Wrangler OAuth；密碼與驗證碼由本人處理。CodeSandbox 等遠端環境需確認 OAuth 回呼能回到 Wrangler；無法時，才依官方方式在平台 Secrets 使用限權 API Token，不能貼到聊天。

```sh
npx wrangler whoami
npx wrangler login
npx wrangler d1 list
npx wrangler d1 create classroom-kit-db
```

已登入者略過 login；已有本專案專用 D1 就沿用，不重建。若有多帳號，所有命令明確使用該專案的 profile／account，且資料庫與 Worker 必須屬同帳號。免費資料庫數量已滿時先說明，不能自行升級、刪除或共用其他專案資料。

將回傳的 `database_id` 與實際名稱填入 `wrangler.jsonc` 的 `d1_databases`，保留 `binding: DB`、`migrations_dir: migrations`。模板全零 ID 僅供本機，部署腳本會拒絕此佔位值。各取用者自行設定，不把原作者的資源識別碼帶入模板。

## 3. 設定秘密與學生登入選項

```sh
npx wrangler secret put TEACHER_PASSWORD
npx wrangler secret put SESSION_SECRET
```

教師密碼至少 12 字元；SESSION_SECRET 使用密碼學亂數，至少 32 字元。在私密終端或 Cloudflare Dashboard Secret 介面安全輸入，不透過聊天。既有部署沿用原 Secret；輪替 SESSION_SECRET 會撤銷登入，啟用識別碼時也需要重發學生碼。輪替教師密碼會撤銷既有教師登入。

| 設定 | 預設／用途 |
| --- | --- |
| APP_MODE | `d1`；正式環境不可使用 demo |
| APP_INSTANCE | `default`；同一資料庫中的資料範圍識別，正式使用後不任意更改 |
| ALLOW_PUBLIC_DEMO | `false` |
| STUDENT_CODES_ENABLED | `false`；改 `true` 才產生並要求學生個人識別碼 |
| POLL_INTERVAL_MS | `10000`；最短 5000、最長 60000 毫秒 |
| FILE_TOTAL_MB | `100`；每個 instance 的附件 MiB 配額，最高 300 |

識別碼關閉時，知道班級代碼者可選擇任何有效座號；這是方便的課堂加入方式，不能當作身分驗證。需要防止冒用時由部署者開啟。既有班級啟用後須重發個人碼；新班級自動產生並提供教師下載。

可選 AI 設定：Secrets 的 `AI_API_KEY`，vars 的 `AI_MODEL` 與 `AI_BASE_URL`。不設定就使用明確標示的 mock。不要為了上線啟用付費 AI。

## 4. migration 與部署

```sh
npm run check
npm run deploy
```

部署腳本先建置與檢查設定，再套用遠端 migrations 並執行 Wrangler deploy。也可分開執行 `npm run db:remote` 與 `npx wrangler deploy`。本機 `--local` 不會初始化雲端，必須明確使用 `--remote`。套用既有 migrations 前檢查名稱、歷史與資料，不重設資料庫。

## 5. 正式網址驗收

- `/api/config` 應回傳 `mode: d1` 及正確的識別碼開關。
- 教師以自己設定的密碼登入、建班、開課；學生以另一個瀏覽器加入並提交。
- 重新整理後仍讀得到作答；以遠端 SQL 獨立核對，例如：

```sh
npx wrangler d1 execute DB --remote --command="SELECT COUNT(*) AS answers FROM kit_answers"
```

- 上傳合成附件、重新整理並下載，確認內容一致；另一座號與班級不能下載。
- 確認登出、教師 API 權限、答案揭露與重送去重；測試紀錄不混入正式學生資料。

## 免費用量與錯誤

保持 Workers Free，查閱 [Workers 定價](https://developers.cloudflare.com/workers/platform/pricing/) 與 [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)。API、D1 讀寫與容量有獨立限制；額度不足時提示並保留待送答案，不自動升級方案。10 秒輪詢降低請求量，但不能保證任意學生數都免費。

缺少 DB/migration 或 Secret 時，正式模式應拒絕服務，不可用 demo 掩蓋設定失敗。資料衝突會自動重讀重試；持續失敗時提示使用者，不可顯示儲存成功。
