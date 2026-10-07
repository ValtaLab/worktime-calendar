---
project: worktime-calendar
status: active
last_deploy: （2026-10-02，v1.32.0）
last_version: 1.32.0
last_update_by: HermesBPi
---

# 工時月曆 · 項目進展日誌

## 🚀 最新狀態
**版本:** `1.32.0`（線上）｜**本地待部署:** `1.33.0`｜**狀態:** 開發中

- 線上：https://valtalab.github.io/worktime-calendar/
- Repo：ValtaLab/worktime-calendar（public，GitHub Pages + GitHub Actions 部署）
- 本地：`/home/blackpi/work/worktime-calendar`

---

### 2026-10-07 | SEO：令 Google／Bing 搜得到（v1.33.0，本地完成待推）
- **起因**：Ken 要求「喺 Google 都搜尋到」。檢查：Bing `site:valtalab.github.io` 零結果（未收錄）；站上冇 sitemap、冇任何外部連結、頁面幾乎冇靜態文字。
- **改動**
  - `sitemap.xml`（新）：列出正式網址，供 GSC 提交
  - `index.html` head：canonical、hreflang（zh-Hant／en／x-default）、`robots: index,follow`、Open Graph／Twitter card、JSON-LD `WebApplication`（名稱、免費、功能清單）
  - `index.html` 頁尾：新增 `.site-about` 資訊卡（H2 + 簡介 + 4 條 FAQ `<details>`），中英雙語
  - `app.js`：新增 i18n key `docTitle` / `metaDesc`（加長）/ `about*`；`document.title` 改用 `docTitle`（加入主畫面名稱仍用 `appName`）
  - `styles.css`：`.site-about` 玻璃卡樣式（沿用 `--glass-cell-hi/lo`、內高光）
  - `version.json` / `sw.js` / `app.js` / `manifest`：bump 至 1.33.0（build 20261007-0814）
  - 單檔版已重建（`build-standalone.sh`）
- **本地驗證**：本機 8099 伺服器 → HTTP 200；JSON-LD 可 parse；`about` 卡桌面／手機／深色渲染正常、無 console error；中英切換正常；字距 padding 左右實測各 16px。
- **未完成**：push 上 GitHub（等 Ken 確認）→ 之後到 Google Search Console 驗證 + 提交 sitemap。
- **教訓**：驗證本地改動前要先清 Service Worker 快取，否則會睇到舊 CSS（第一次截圖就中招）。
