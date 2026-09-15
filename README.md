# 工時月曆 · Worktime Calendar

以月曆為核心的工時與加班記錄 PWA。**雙擊日期即可新增工時描述與加班描述**，資料存在本機、離線可用、可安裝到主畫面。

![status](https://img.shields.io/badge/PWA-offline--ready-2563eb) ![license](https://img.shields.io/badge/license-MIT-green)

---

## 功能

| 功能 | 說明 |
| --- | --- |
| **月曆主介面** | 一眼看清整月工時分布，有記錄的日期自動標示 |
| **雙擊新增** | 雙擊任一日期 → 填寫工時描述、工時、加班描述、加班時數 |
| **月度統計** | 月工時、月加班、記錄天數、達標率（依標準工時計算） |
| **快捷操作** | 觸控裝置單擊即開；`←/→` 切換月份、`T` 回到本月、`⌘/Ctrl+Enter` 儲存 |
| **離線可用** | Service Worker 快取，無網路也能開；資料存在瀏覽器 |
| **可安裝** | 完整 Web App Manifest，加到主畫面後如原生 App |
| **深色模式** | 跟隨系統自動切換 |
| **資料匯出** | 匯出 CSV（可直接進 Excel）、匯出／匯入 JSON 備份 |

---

## 快速開始

### 本機執行

因為使用 Service Worker，**不能用 `file://` 直接開啟**，需要一個靜態伺服器：

```bash
cd worktime-calendar

# Python（內建）
python3 -m http.server 8099

# 或 Node
npx http-server -p 8099
```

開啟 <http://localhost:8099>

### 部署

純靜態檔案，**不需要建置步驟**，推到任何靜態託管都能跑：

```bash
# GitHub Pages：把檔案放到 repo 根目錄或 /docs，於 Settings → Pages 選擇分支即可
# Netlify / Vercel / Cloudflare Pages：直接連動 repo，build command 留空，
# publish directory 指向本專案資料夾
```

專案已內含 GitHub Actions 工作流（`.github/workflows/pages.yml`），
若要在 GitHub Pages 自動部署，於 repo 的 **Settings → Pages → Source** 選擇 **GitHub Actions** 即可。

---

## 檔案結構

```
worktime-calendar/
├── index.html                 # 主介面（月曆 + 編輯面板 + 選單）
├── styles.css                 # 樣式：響應式、深色模式
├── app.js                     # 邏輯：月曆渲染、儲存、匯出匯入
├── sw.js                      # Service Worker（離線快取）
├── manifest.webmanifest       # PWA 資訊清單
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   ├── apple-touch-icon.png
│   └── favicon-32.png
├── .github/workflows/pages.yml
└── README.md
```

---

## 資料儲存

資料儲存在瀏覽器 `localStorage`，**不會上傳到任何伺服器**：

| Key | 內容 |
| --- | --- |
| `worktime-calendar:v1` | 所有工時記錄，格式 `{ "YYYY-MM-DD": { workDesc, workHours, otDesc, otHours, tags } }` |
| `worktime-calendar:settings:v1` | 偏好設定（標準工時、顯示選項） |

> **注意**：清除瀏覽器資料會一併清除記錄，建議定期用「匯出備份 JSON」留存。

### 換裝置 / 換瀏覽器

1. 舊裝置：選單 → **匯出備份 JSON**
2. 新裝置：選單 → **匯入備份 JSON**

---

## 操作說明

| 操作 | 方式 |
| --- | --- |
| 新增／編輯記錄 | **雙擊**日期格（觸控裝置單擊即可） |
| 快速儲存 | `⌘/Ctrl + Enter` |
| 關閉面板 | `Esc` 或點擊背景 |
| 切換月份 | 點 `‹` `›`，或按 `←` `→` |
| 回到本月 | 點「今天」，或按 `T` |
| 調整時數 | 點 `−` / `+`，每次 0.5 小時 |

---

## 技術要點

- **零依賴**：純 HTML/CSS/JS，無框架、無建置流程，整包約 50 KB
- **離線優先**：Service Worker 採「快取優先、背景更新」策略；導航請求走「網路優先、離線回快取」
- **輸入體驗**：數字欄位 `inputmode="decimal"`，行動端彈出數字鍵盤
- **無障礙**：面板為 `role="dialog"` + `aria-modal`，日期格可 Tab 聚焦並以 `Enter` 開啟，支援 `prefers-reduced-motion`
- **觸控優化**：44px 以上觸控目標、`env(safe-area-inset-*)` 適配瀏海螢幕

---

## 授權

MIT
