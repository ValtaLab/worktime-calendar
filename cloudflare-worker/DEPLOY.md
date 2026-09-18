# 部署雲端備份 Worker（Cloudflare）— 10 分鐘

App 的「雲端備份」功能需要一個備份中轉服務。用你自己的 Cloudflare 賬號部署，
**數據存在你自己的 KV 裡（且只有加密後的密文）**，終端用戶不需要申請任何帳號。

---

## 步驟 1：建立 KV 儲存空間

1. 登入 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左側選單 → **Storage & Databases** → **KV**
3. **Create a namespace** → 名稱填 `worktime-backup` → 建立

## 步驟 2：建立 Worker

1. 左側選單 → **Workers & Pages** → **Create** → **Create Worker**
2. 名稱填 `worktime-backup`（網址會是 `worktime-backup.<你的子域>.workers.dev`）→ Deploy
3. Deploy 成功後點 **Edit code**：把 `worker.js` 的**全部內容**貼進去，覆蓋原有代碼 → **Deploy**
4. 回到 Worker 頁面 → **Settings** → **Bindings** → **Add**：
   - 類型選 **KV Namespace**
   - Variable name 填 `BACKUP_KV`（必須一字不差）
   - Namespace 選步驟 1 建的 `worktime-backup` → Save

## 步驟 3：驗證

瀏覽器打開（換成你的實際網址）：

```
https://worktime-backup.<你的子域>.workers.dev/api/backup?code=AAAAAAAA
```

看到 `{"found":false,...}`（HTTP 404）＝部署成功。

## 步驟 4：填入 App

手機打開工時月曆 → 選單 →「雲端備份（Cloudflare）」→ 貼上 Worker 網址 → 連接。
出現 8 位恢復碼 → **截圖保存**（重裝找回資料全靠它）。

---

## 費用與額度（免費版）

| 項目 | 免費額度 | 說明 |
|---|---|---|
| Worker 請求 | 100,000 次/天 | 讀寫備份都算 |
| KV 寫入 | 1,000 次/天 | App 端有 30 秒 debounce ＋內容沒變不重推，幾百個用戶夠用 |
| KV 讀取 | 100,000 次/天 | |
| KV 容量 | 1 GB | 每份備份約幾十 KB |

用戶多了免費額度不夠時，Workers Paid（$5/月）把寫入額度提高到 100 萬次/天。

## 安全說明

- **Worker 只見密文**：App 端以恢復碼派生 AES-GCM 金鑰加密後才上傳，KV 裡沒有明文。
- **恢復碼即鑰匙**：誰有碼誰能還原，8 位隨機碼（不含易混淆字元）約 8500 億組合，不可枚舉。
- **來源限制**：Worker 只回應 `https://valtalab.github.io`（加上本地測試）的瀏覽器請求；
  要加自訂網域時改 `worker.js` 頂部的 `ALLOW_ORIGINS`。
- **濫用防護**：單檔 300KB 上限＋KV 免費額度天然限速。碼空間大，瞎猜撞碼不現實。

## 換網址／搬家

Worker 網址改了（例如換子域）：App 端填新網址＋原恢復碼即可找回資料
（加密金鑰由「恢復碼＋網址」共同派生，所以**必須填同一個網址**；若要永久搬家，
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

> 更新 Worker 代碼：改 `worker.js` 後用 Dashboard 的 Edit code 貼上重新 Deploy，
> 或用同一支部署腳本重新 PUT。
