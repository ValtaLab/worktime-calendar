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

### 2026-10-07（下午）| GSC 擁有權驗證 tag 上線 + sitemap 已提交
- Ken 喺 Google Search Console（URL 前置字元：`https://valtalab.github.io/worktime-calendar/`）揀「HTML 標記」驗證，拎到 tag
- tag 已加入 `index.html` head（`google-site-verification`）——**唔可以改或刪**，否則會失去 GSC 擁有權
- **Ken 回報已提交 sitemap**（`sitemap.xml`）——⚠️ 呢個係用戶回報，Pi 側無法獨立驗證 Google 嘅狀態
- Pi 側驗證：用 Googlebot UA 抓 `?x=<cachebuster>` → **200**，`google-site-verification` / `.site-about` / JSON-LD 全部在；`sitemap.xml` 200 且 `<loc>` 正確；冇 `X-Robots-Tag` 阻擋
- 驗證方式選擇過程：先試自動登入（headless 被 Google 攔）→ 試 Xvfb headful（成功到密碼頁）→ vault 遮罩輸入喺 Telegram 唔支援 → passkey QR 卡喺「connecting」（要藍牙近距離）→ 最後由 Ken 喺手機自己拎 tag
- 相關技能：`headful-browser-login-walls`、`worktime-calendar-seo`

### 2026-10-07 | v1.34.2：手機版壓縮月曆下方區塊（Ken：「下方太多空白，留多啲俾格仔」）
- **量度基準**（390×844，改動前）：格仔 104px、底部提示 60px（兩行）、備份橫幅 38px、關於卡 51px+22px 邊距、月曆底部 padding 10px → 月曆下方合共 **185px**
- **改動（純 CSS，冇郁邏輯）**
  - `.hint-bar`：手機字級 14.5px → **12.5px**（提示由兩行收成一行）、padding 10/12 → 5/6
  - **移除 `.hint-bar` 重複嘅 `var(--safe-b)`** —— 底部安全區統一由最底嘅 `.site-about` 負責（之前兩個元素各加一次，白食一個 home indicator ≈34px）
  - `.site-about` / `.cf-banner` / `.calendar-wrap` / `.weekday-row` 邊距收緊
- **結果**：格仔 **104 → 113px（+9%）**、月曆總高 527 → 571px、下方 185 → **143px**；iPhone（safe-area 34px）再多賺 34px → 約 **+15px/格（+14%）**
- **跨寬度驗證**：320/360/390/430 全部無橫向溢出；360px 以上提示單行（320 舊細機仍兩行，同改動前一樣）；**0 JS error**
- 關鍵機制：手機版 `.calendar-grid` 用 `align-content: stretch`，下方省落嘅每一 px 都會自動平均分入每一列 —— 所以呢類「壓縮」嘅效益係即時的

### 2026-10-07 | v1.34.1：頁尾介紹預設折疊（Ken 要求）
- `.site-about` 由 `<section>` 改為 `<details>` —— 默認收合，卡片高度由 589px 縮到 **51px**（只剩一行「關於工時月曆 ⌄」）
- FAQ 由嵌套 `<details>` 改為直接內容（一層 toggle 就夠，唔使開兩次）
- **SEO 不受影響**：段落（140 字）同 4 條 FAQ 仍然完整留在 HTML DOM，Google 讀得到 `<details>` 內容
- summary 右側加 chevron，展開時旋轉 180°；跟隨 `prefers-reduced-motion`
- 本地實測：收合/展開來回正常、中英雙語正常、**0 JS error**

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
