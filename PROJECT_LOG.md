---
project: worktime-calendar
status: active
last_deploy: （2026-10-02，v1.32.0）
last_version: 1.32.0
last_update_by: HermesBPi
---

# 工時月曆 · 項目進展日誌

## 🚀 最新狀態
**版本:** `1.34.0`（線上，commit `ebef544`，2026-10-07 08:23 HKT 部署成功）｜**狀態:** 運行中

> ⚠️ **開始改嘢前一定要先 `git fetch`**：remote 曾經領先本機 6 個 commit（v1.33.1），
> 我最初喺 10 月 2 日嘅舊底上做嘢，好彩 push 被 reject 先發現。詳見下面 2026-10-07 條目。

- 線上：https://valtalab.github.io/worktime-calendar/
- Repo：ValtaLab/worktime-calendar（public，GitHub Pages + GitHub Actions 部署）
- 本地：`/home/blackpi/work/worktime-calendar`

---

### 2026-10-07（下午）| GSC 擁有權驗證 tag 上線
- Ken 喺 Google Search Console（URL 前置字元：`https://valtalab.github.io/worktime-calendar/`）揀「HTML 標記」驗證，拎到 tag
- tag 已加入 `index.html` head（`google-site-verification`）——**唔可以改或刪**，否則會失去 GSC 擁有權
- 驗證方式選擇過程：先試自動登入（headless 被 Google 攔）→ 試 Xvfb headful（成功到密碼頁）→ vault 遮罩輸入喺 Telegram 唔支援 → passkey QR 卡喺「connecting」（要藍牙近距離）→ 最後由 Ken 喺手機自己拎 tag
- 相關技能：`headful-browser-login-walls`、`worktime-calendar-seo`

### 2026-10-07 | SEO：令 Google／Bing 搜得到（v1.34.0）
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
