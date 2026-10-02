# 部署雲端備份 Worker（Cloudflare）— 10 分鐘

App 的「雲端備份」功能需要一個備份中轉服務。用你自己的 Cloudflare 賬號部署，
**數據存在你自己的 KV 裡（且只有加密後的密文）**，終端用戶不需要申請任何帳號。

---

## 步驟 1：建立 KV 儲存空間

1. 登入 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左側選單 → **Storage & Databases** → **KV**
3. **Create a namespace** → 名稱填 `worktime-backup` → 建立

## 步驟 1.5（推薦）：用腳本一鍵部署

不想手動貼程式碼的話，用 repo 內的腳本（走 Cloudflare API，不需 wrangler）：

```bash
CLOUDFLARE_API_TOKEN=xxxx bash cloudflare-worker/deploy.sh
```

Token 在 https://dash.cloudflare.com/profile/api-tokens 生：
**Create Custom Token** → Permissions 選 `Account | Workers Scripts | Edit`
→ Account Resources 選你的帳號。腳本會自動上傳並跑四項驗證。

---

## 步驟 2：建立 Worker

1. 左側選單 → **Workers & Pages** → **Create** → **Create Worker**
2. 名稱填 `worktime-backup`（網址會是 `worktime-backup.<你的子域>.workers.dev`）→ Deploy
3. Deploy 成功後點 **Edit code**：把 `worker.js` 的**全部內容**貼進去，覆蓋原有代碼 → **Deploy**
4. 回到 Worker 頁面 → **Settings** → **Bindings** → **Add**：
   - 類型選 **KV Namespace**
   - Variable name 填 `BACKUP_KV`（必須一字不差）
   - Namespace 選步驟 1 建的 `worktime-backup` → Save

## 步驟 3（選用）：設定速率限制與開關

Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**：

| 變數 | 預設 | 說明 |
|---|---|---|
| `RATE_LIMIT` | `60` | 每 IP 每分鐘的配額，一次寫入算 5 點（≈每分鐘 12 次寫入）。設 `0` 關閉 |
| `RATE_LIMIT_READS` | 未設 | 設 `1` 連讀取也計數。**預設不計讀取**——計數器要寫 KV，免費額度只有 1000 次寫入／日，若連讀取都計，別人狂發請求反而更容易把額度耗光 |

想要更嚴的讀取限速，去 Cloudflare 後台 **WAF → Rate limiting rules** 加一條
（那條不佔 KV 額度）：對 `https://.../api/backup*` 限制每 IP 每分鐘 60 次。

## 步驟 4：驗證

瀏覽器打開（換成你的實際網址）：

```
https://worktime-backup.<你的子域>.workers.dev/api/backup?code=AAAAAAAA
```

看到 `{"found":false,...}`（HTTP 404）＝部署成功。

用 curl 驗新 API（應該回 404／`{"ok":true}`）：

```bash
curl -X POST https://worktime-backup.<你的子域>.workers.dev/api/backup \
  -H 'Content-Type: application/json' \
  -d '{"op":"get","tok":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
```

## 步驟 5：填入 App

手機打開工時月曆 → 選單 →「雲端備份（Cloudflare）」→ 貼上 Worker 網址 → 連接。
出現 8 位恢復碼 → **截圖保存**（重裝找回資料全靠它）。

---

## 費用與額度（免費版）

| 項目 | 免費額度 | 說明 |
|---|---|---|
| Worker 請求 | 100,000 次/天 | 讀寫備份都算 |
| KV 寫入 | 1,000 次/天 | 每次備份 2 次（資料＋寫入金鑰雜湊）＋限速計數 1 次；App 端有 20 秒 debounce 且內容沒變不重推 |
| KV 讀取 | 100,000 次/天 | |
| KV 容量 | 1 GB | 每份備份約幾十 KB |

用戶多了免費額度不夠時，Workers Paid（$5/月）把寫入額度提高到 100 萬次/天。

## 安全說明（v2，2026-10-02 改版）

三件憑證分工，壞掉其中一件也不會全盤失守：

| 憑證 | 誰有 | 能做什麼 |
|---|---|---|
| 恢復碼（8 位，使用者保管） | 只有使用者 | 派生下面兩把，本身不上網 |
| `tok`（由恢復碼 PBKDF2 600k 派生） | 會送伺服器 | 只用來定位與讀取（讀到的是密文） |
| `wk` 寫入金鑰（隨機 32B） | 使用者裝置＋加密內容 | 才能覆寫／刪除 |

- **真正的端對端加密**：加密金鑰由「恢復碼＋隨機鹽」經 PBKDF2（600k 次）派生，
  鹽雖然明碼隨備份走（鹽不需要保密），但**恢復碼永遠不出裝置**，
  伺服器拿到密文＋鹽＋tok 也解不開——這點是 v1 做不到的（v1 的恢復碼會出現在 URL）。
- **憑證外洩也毀不掉資料**：即使 `tok` 從日誌外洩，沒有 `wk` 就無法覆寫或刪除。
- **寫入限速**：每 IP 每分鐘約 12 次寫入（可用 `RATE_LIMIT` 調整／關閉）。
- **來源限制**：Worker 只回應 `https://valtalab.github.io`（加上本地測試）的瀏覽器請求；
  要加自訂網域時改 `worker.js` 頂部的 `ALLOW_ORIGINS`。
- **濫用防護**：單檔 300KB 上限、寫入限速、碼空間 2^40 不可枚舉。

### 從 v1 升級要做的只有一件事

把新的 `worker.js` 貼上去重新 Deploy 即可，資料不用搬：

- v1 的舊備份放在 `wtc:<code>`，新備份放在 `wtc2:<tok>`，兩者並存互不干擾
- App 端讀得到舊格式，會自動用新格式重推一份完成升級
- 舊版 App（未更新）仍然能用 v1 API；等所有用戶都升級後可直接刪掉 worker.js 裡的 v1 段落

## 換網址／搬家

Worker 網址改了（例如換子域）：App 端填新網址＋原恢復碼即可找回資料
（`tok` 由「恢復碼＋網址」共同派生，所以**必須填同一個網址**；若要永久搬家，
在舊網址還原→新網址重新連接備份一次）。

---

## ✅ 已部署（2026-09-18，透過 API 自動部署）

| 項目 | 值 |
|---|---|
| Worker 網址 | `https://worktime-backup.isearover.workers.dev` |
| Worker 名稱 | `worktime-backup` |
| KV namespace | `worktime-backup`（id `32ecc1c3302f4b4f9d0bfa725013dfcc`） |
| KV 綁定變數 | `BACKUP_KV` |
| workers.dev | 已啟用 |

App 端「Worker 網址」直接填：`https://worktime-backup.isearover.workers.dev`

驗證方式：手機瀏覽器打開
`https://worktime-backup.isearover.workers.dev/api/backup?code=AAAAAAAA`
看到 `{"found":false}`（404）＝正常。

> **更新 Worker 代碼**（推薦一行搞定）：
> ```bash
> CLOUDFLARE_API_TOKEN=xxxx bash cloudflare-worker/deploy.sh
> ```
> 或手動：Dashboard 的 Edit code 貼上新的 `worker.js` → Deploy。
> 腳本會順便驗證 v1/v2 API 與讀寫刪是否都正常。
