---
project: worktime-calendar
status: active
last_deploy: （2026-10-08，v1.34.5）
last_version: 1.34.5
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

### 2026-10-07 | v1.34.3：關於卡貼底 + 修正「手機覆寫被蓋過」嘅真 bug
- **Bug（重要）**：v1.34.2 對 `.site-about` 嘅手機覆寫**從來冇生效** —— 全域 `.site-about` 基礎規則在檔案**最尾**，
  同特異度（0,1,0）下後宣告者勝，媒體查詢唔會加特異度 → 覆寫被蓋過。
  發現方法：改完之後**量度數字前後一樣**（113px／18px）才察覺。`.hint-bar`／`.cf-banner` 冇事（基礎規則在手機區塊之前）。
  修法：把 `.site-about` 手機覆寫搬到**檔案最尾**，並在手機區塊加註解防止再犯。
- **結果（390×844）**：格仔 113 → **119px（+5%）**、關於卡 51 → **42px**、卡底距螢幕底 18 → **0px**；
  iPhone 安全區下 = **剛好 34px**（只剩 home indicator），即「貼底」
- **驗證**：safe-b 0 / 34 兩種情境都量過、`--safe-b` 用注入 `<style>` 模擬、0 JS error
- 教訓已寫入 `~/.hermes/.learnings/LRN-20261007-css-media-query-order.md`

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

### 2026-10-08 | v1.34.4：格仔加班／半夜改為「時數行先、OT 做後綴」
- **起因**：Ken 要求「格仔的 OT 字移去後面，小時數排前面」
- **改動**
  - `app.js`：`.ot-units` 同 `.night-units` 嘅 `.uv` 由 `<ot-pre>OT</ot-pre> {n}h` 改為 `{n}h<ot-pre>OT</ot-pre>`
  - `styles.css`：`.ot-pre` 由 `margin-right: 1px`（前綴）改為 `margin-left: .25em`（後綴）
  - `README.md`：更新格子標記說明
  - `version.json` / `sw.js` / `app.js` 單檔版：bump 至 1.34.4（build 20261008-1232）
- **關鍵機制（易踩）**：`.uv` 在 `@media (min-width: 1000px)` 係 `display: inline-flex` —— flex container 會**食掉純空白字元**，所以 markup 入面寫 `</span> <span>` 係冇用嘅，間距一定要靠 CSS `margin`。舊版就係因為咁，桌面版實際 render 成「OT3h」（冇空格）。今次改用 `.25em` em 單位，令 11px（手機）到 19px（桌面）嘅間距都跟字級縮放。
- **驗證**：本地 8099（清 SW 後）＋ 線上 `valtalab.github.io` 兩邊都實測 —— 桌面 5/6/7 號讀「3h OT 加班」「2.5h OT 加班」「5h OT 加班」；手機 390px 讀「3h OT」「2.5h OT」「5h OT」，0 格橫向溢出、0 JS error；單檔版內容一致；GH Actions 綠燈、線上 `version.json` = 1.34.4、`sw.js` CACHE = v1.34.4。

### 2026-10-08 | v1.34.5：加班行刪走重複標籤（3h OT）；半夜行標籤縮短為「半夜」
- **起因**：v1.34.4 之後桌面版讀成「3h OT 加班」——「OT」同「加班」講同一件事。Ken 確認「刪走加班」。
- **改動**
  - `app.js`：`.ot-units` 移除整個 `<span class="ut">`（加班標籤）；`.night-units` 的 `.ut` 由 `cellNight` 改用新 key `cellNightTag`
  - `app.js` i18n：新增 `cellNightTag`（zh「半夜」／en「Night」）。`cellNight` 保留，因為 aria-label 仍然用佢（「半夜加班 2 小時」對讀屏仍然最清楚）
  - `README.md`：更新格子標記說明
  - `version.json` / `sw.js` / 單檔版：bump 至 1.34.5（build 20261008-1300）
- **為何半夜行唔可以一併刪乾淨**：`.ut` 喺 ≤480px 係 `display: none`，所以手機版向來只見到「3h OT」「2h OT」。桌面版如果半夜行都刪清光，就會同加班行一模一樣（只有顏色唔同），但兩者計薪唔同（加班 1.5x vs 午夜後 2x），所以留「半夜」保底。
- **驗證**：本地 8099（清 SW 後）桌面 5/6/7 號讀「3h OT」「2.5h OT」「2h OT 半夜」「5h OT」；手機 390px 冇變、0 格溢出、0 JS error；v1.34.4→1.34.5 before/after 對照圖已出。
