/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆；雙擊日期 → 新增/編輯 工時描述 + 加班描述
 * 儲存：localStorage（同步、離線可用），含版本號
 * ========================================================= */
(() => {
  'use strict';

  // 由 bump-version.sh 自動維護
  const APP_VERSION = '1.30.0';
  const APP_BUILD = '20260923-1324';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  // 香港公眾假期（紅日）——資料來源：1823 官方 iCal（www.1823.gov.hk）
  // 2025–2027 已由政府憲報公布；新一年公布後於年末更新此表。
  // 無資料的年份照常運作（只是不顯示假期標示）。
  const HK_HOLIDAYS = {
    // 2025
    '2025-01-01': '一月一日',
    '2025-01-29': '農曆年初一',
    '2025-01-30': '農曆年初二',
    '2025-01-31': '農曆年初三',
    '2025-04-04': '清明節',
    '2025-04-18': '耶穌受難節',
    '2025-04-19': '耶穌受難節翌日',
    '2025-04-21': '復活節星期一',
    '2025-05-01': '勞動節',
    '2025-05-05': '佛誕',
    '2025-05-31': '端午節',
    '2025-07-01': '香港特別行政區成立紀念日',
    '2025-10-01': '國慶日',
    '2025-10-07': '中秋節翌日',
    '2025-10-29': '重陽節',
    '2025-12-25': '聖誕節',
    '2025-12-26': '聖誕節後第一個周日',
    // 2026
    '2026-01-01': '一月一日',
    '2026-02-17': '農曆年初一',
    '2026-02-18': '農曆年初二',
    '2026-02-19': '農曆年初三',
    '2026-04-03': '耶穌受難節',
    '2026-04-04': '耶穌受難節翌日',
    '2026-04-06': '清明節翌日',
    '2026-04-07': '復活節星期一翌日',
    '2026-05-01': '勞動節',
    '2026-05-25': '佛誕翌日',
    '2026-06-19': '端午節',
    '2026-07-01': '香港特別行政區成立紀念日',
    '2026-09-26': '中秋節翌日',
    '2026-10-01': '國慶日',
    '2026-10-19': '重陽節翌日',
    '2026-12-25': '聖誕節',
    '2026-12-26': '聖誕節後第一個周日',
    // 2027
    '2027-01-01': '一月一日',
    '2027-02-06': '農曆年初一',
    '2027-02-08': '農曆年初三',
    '2027-02-09': '農曆年初四',
    '2027-03-26': '耶穌受難節',
    '2027-03-27': '耶穌受難節翌日',
    '2027-03-29': '復活節星期一',
    '2027-04-05': '清明節',
    '2027-05-01': '勞動節',
    '2027-05-13': '佛誕',
    '2027-06-09': '端午節',
    '2027-07-01': '香港特別行政區成立紀念日',
    '2027-09-16': '中秋節翌日',
    '2027-10-01': '國慶日',
    '2027-10-08': '重陽節',
    '2027-12-25': '聖誕節',
    '2027-12-27': '聖誕節後第一個周日',
  };

  const DEFAULTS = {
    stdHours: 8,    // 僅供舊資料遷移換算（1 工 = N 小時）；UI 已移除此設定
    theme: 'auto',  // 主題：auto＝跟隨系統光暗模式；light／dark＝固定
    showWeekend: true,
    showHolidays: true,  // 顯示香港公眾假期（紅日：日期轉紅＋假期名）
    showHours: true,
    mondayFirst: true,
    dayPay: 0,      // 日薪（1 工）
    hourlyPay: 0,   // 時薪（兼職小時 × 時薪）
    otPay: 0,       // 加班時薪
    nightPay: 0,    // 半夜加班時薪
    pinHash: '',    // 螢幕鎖定密碼（SHA-256 雜湊）；空字串＝未啟用
    descHistory: { work: [], ot: [], night: [] },  // 描述記憶：各欄最近輸入（新在前，存 10 顯 3）
    cfEndpoint: '', // 雲端備份 Worker 網址
    cfCode: '',     // 恢復碼（8 位，重裝找回資料的唯一憑證）
    cfAt: '',       // 上次成功備份時間（ISO）
    cfHash: '',     // 上次成功備份的內容指紋（沒變不重推）
  };

  /* ---------------- 狀態 ---------------- */
  let entries = {};              // { 'YYYY-MM-DD': {workDesc, workUnits, partHours, otDesc, otHours, nightDesc, nightHours, tags, updatedAt} }
  let settings = { ...DEFAULTS };
  let view = new Date();         // 目前顯示月份
  let editingKey = null;         // 正在編輯的日期 key

  /* ---------------- 工具 ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => keyOf(new Date());
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const fmtH = (n) => round1(n).toString().replace(/\.0$/, '');

  // 工數顯示：整數不帶小數，半工保留 .5
  const fmtUnits = (u) => round1(u).toString().replace(/\.0$/, '');

  // 金額顯示：千分位 + 最多兩位小數（有需要才顯示小數）
  const fmtMoney = (n) => {
    const v = Math.round(n * 100) / 100;
    const hasFrac = Math.abs(v % 1) > 0.0001;
    return v.toLocaleString('zh-TW', {
      minimumFractionDigits: hasFrac ? 2 : 0,
      maximumFractionDigits: 2,
    });
  };

  // 工數僅提供 0.5 工（半日）與 1 工（全日）兩個選擇
  const WORK_CHOICES = [0.5, 1];

  const WEEK_TC = ['日', '一', '二', '三', '四', '五', '六'];

  function fmtDateLabel(d) {
    const w = WEEK_TC[d.getDay()];
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${w}）`;
  }

  /* ---------------- 儲存 ---------------- */
  function load() {
    // 先讀設定，讓遷移能用到正確的「1 工 = N 小時」基準
    try {
      const rs = localStorage.getItem(SETTINGS_KEY);
      if (rs) settings = { ...DEFAULTS, ...JSON.parse(rs) };
    } catch (e) { /* 用預設 */ }

    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const result = migrate(parsed.data || parsed);
          entries = result.data;
          if (result.converted > 0) save();   // 遷移後立即寫回，避免每次載入重複轉換
        }
      }
    } catch (e) { console.warn('讀取資料失敗', e); }
  }

  /**
   * 資料遷移，兼容兩代舊格式：
   *   v1：workHours / otHours（小時）
   *   v2：workUnits / otUnits（皆為「工」）
   * 目前格式：workUnits（工，僅 0.5 或 1）＋ otHours（小時）
   * 「工」與「小時」的換算基準為設定的標準工時，預設 8 小時 = 1 工。
   * 回傳 { data, converted }，由呼叫方決定是否寫回儲存。
   */
  function migrate(data) {
    if (!data || typeof data !== 'object') return { data: {}, converted: 0 };
    const base = num(settings.stdHours) || num(DEFAULTS.stdHours) || 8;
    const out = {};
    let converted = 0;

    for (const [k, e] of Object.entries(data)) {
      if (!e || typeof e !== 'object') continue;
      const next = { ...e };

      // 工數：v1 的 workHours（小時）→ 工
      if (next.workUnits == null && next.workHours != null) {
        next.workUnits = round1(num(next.workHours) / base);
        converted++;
      }
      // 加班：v2 的 otUnits（工）→ 小時；v1 的 otHours（小時）沿用
      if (next.otHours == null && next.otUnits != null) {
        next.otHours = round1(num(next.otUnits) * base);
        converted++;
      }
      delete next.workHours;
      delete next.otUnits;

      // 工數僅保留兩個選項，超出範圍者夾到最近值
      if (next.workUnits != null && next.workUnits !== 0) {
        const v = num(next.workUnits);
        if (v > 0) {
          const nearest = WORK_CHOICES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
          if (nearest !== v) { next.workUnits = nearest; converted++; }
        } else {
          next.workUnits = 0;
        }
      }

      out[k] = next;
    }

    if (converted) {
      console.info(`[工時月曆] 已遷移 ${converted} 個欄位（1 工 = ${base} 小時）`);
    }
    return { data: out, converted };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, updatedAt: Date.now(), data: entries }));
    } catch (e) {
      toast('儲存失敗，瀏覽器空間可能已滿');
      console.error(e);
    }
    scheduleCfBackup();  // 已連接雲端時：20 秒 debounce 自動備份
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* noop */ }
    scheduleCfBackup();  // 費率等設定變更也納入自動備份（內容沒變會自動跳過）
  }

  /* ---------------- 主題（光暗模式） ----------------
     settings.theme: 'auto' | 'light' | 'dark'。
     auto 依 matchMedia 即時解析，並監聽系統切換；實際主題寫在
     <html data-theme>，CSS 由此屬性切換（head inline script 負責首幀前設好）。 */
  const themeMql = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const THEME_META = { light: '#f4f6fb', dark: '#0d1117' };   // 瀏覽器 UI（地址欄）跟著主題走

  function applyTheme() {
    const t = settings.theme === 'light' || settings.theme === 'dark'
      ? settings.theme
      : (themeMql && themeMql.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[t]);
    return t;
  }

  function syncThemeSeg() {
    if (!el.themeSeg) return;
    const cur = settings.theme || 'auto';
    el.themeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.themeOpt || 'auto') === cur);
    });
  }

  /* ---------------- 畫面元素 ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    monthTitle: $('monthTitle'),
    monthStats: $('monthStats'),
    incomeBar: $('incomeBar'),
    lockScreen: $('lockScreen'),
    lockTitle: $('lockTitle'),
    lockDots: $('lockDots'),
    lockMsg: $('lockMsg'),
    lockPad: $('lockPad'),
    lockState: $('lockState'),
    lockBtn: $('lockBtn'),
    weekdayRow: $('weekdayRow'),
    calendarGrid: $('calendarGrid'),
    prevMonth: $('prevMonth'),
    nextMonth: $('nextMonth'),
    todayBtn: $('todayBtn'),
    menuBtn: $('menuBtn'),

    sheet: $('sheet'),
    sheetBackdrop: $('sheetBackdrop'),
    sheetDate: $('sheetDate'),
    sheetHol: $('sheetHol'),
    sheetTitle: $('sheetTitle'),
    partGroup: $('partGroup'),
    sheetClose: $('sheetClose'),
    workDesc: $('workDesc'),
    otDesc: $('otDesc'),
    nightDesc: $('nightDesc'),
    suggestWork: $('suggestWork'),
    suggestOt: $('suggestOt'),
    suggestNight: $('suggestNight'),
    tagsInput: $('tagsInput'),
    saveBtn: $('saveBtn'),
    cancelBtn: $('cancelBtn'),
    deleteBtn: $('deleteBtn'),

    // 工數（0.5 工 / 1 工）、兼職時數、加班與半夜時數（滾輪選擇，input 為資料來源）
    workUnitPicker: $('workUnitPicker'),
    partHours: $('partHours'),
    partHoursWheel: $('partHoursWheel'),
    otHours: $('otHours'),
    nightHours: $('nightHours'),
    otHoursWheel: $('otHoursWheel'),
    nightHoursWheel: $('nightHoursWheel'),

    drawer: $('drawer'),
    drawerBackdrop: $('drawerBackdrop'),
    drawerClose: $('drawerClose'),
    dayPay: $('dayPay'),
    hourlyPay: $('hourlyPay'),
    otPay: $('otPay'),
    nightPay: $('nightPay'),
    optWeekend: $('optWeekend'),
    optHoliday: $('optHoliday'),
    optShowHours: $('optShowHours'),
    optMondayFirst: $('optMondayFirst'),
    themeSeg: $('themeSeg'),
    exportCsv: $('exportCsv'),
    exportJson: $('exportJson'),
    importJson: $('importJson'),
    importFile: $('importFile'),
    clearAll: $('clearAll'),
    cfSetup: $('cfSetup'),
    cfEndpoint: $('cfEndpoint'),
    cfCodeInput: $('cfCodeInput'),
    cfConnect: $('cfConnect'),
    cfConnected: $('cfConnected'),
    cfStatus: $('cfStatus'),
    cfRestore: $('cfRestore'),
    cfBackupNow: $('cfBackupNow'),
    cfShowCode: $('cfShowCode'),
    cfDisconnect: $('cfDisconnect'),
    cfCodeShow: $('cfCodeShow'),
    cfCodeText: $('cfCodeText'),
    cfCodeOk: $('cfCodeOk'),
    cfBanner: $('cfBanner'),
    cfSheet: $('cfSheet'),
    cfSheetBackdrop: $('cfSheetBackdrop'),
    cfSheetClose: $('cfSheetClose'),
    cfSheetOpen: $('cfSheetOpen'),
    cfSheetIntro: $('cfSheetIntro'),
    cfSheetHaveToggle: $('cfSheetHaveToggle'),
    cfSheetHave: $('cfSheetHave'),
    cfSheetHaveInput: $('cfSheetHaveInput'),
    cfSheetHaveGo: $('cfSheetHaveGo'),
    cfSheetCode: $('cfSheetCode'),
    cfSheetCodeText: $('cfSheetCodeText'),
    cfSheetDone: $('cfSheetDone'),
    installHint: $('installHint'),

    // 版本與更新
    verCurrent: $('verCurrent'),
    verBuild: $('verBuild'),
    verStatus: $('verStatus'),
    checkUpdateBtn: $('checkUpdateBtn'),
    updateBar: $('updateBar'),
    updateDesc: $('updateDesc'),
    updateNowBtn: $('updateNowBtn'),
    updateLaterBtn: $('updateLaterBtn'),

    toast: $('toast'),
  };

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('show');
      setTimeout(() => { el.toast.hidden = true; }, 220);
    }, 2000);
  }

  /* ---------------- 月曆渲染 ---------------- */
  function entriesOfMonth(y, m) {
    const prefix = `${y}-${pad(m + 1)}-`;
    return Object.entries(entries)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  }

  // 本月收入：工數 × 日薪 + 兼職時數 × 時薪 + 加班時數 × 加班時薪 + 半夜加班時數 × 半夜加班時薪
  // 四個費率都未設定（皆為 0）時回傳 null，呼叫端據此隱藏整個區塊
  function incomeOfMonth(y, m) {
    const dayPay = num(settings.dayPay);
    const hourlyPay = num(settings.hourlyPay);
    const otPay = num(settings.otPay);
    const nightPay = num(settings.nightPay);
    if (dayPay <= 0 && hourlyPay <= 0 && otPay <= 0 && nightPay <= 0) return null;

    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);
    const totalPart = list.reduce((s, e) => s + num(e.partHours), 0);
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);
    const totalNight = list.reduce((s, e) => s + num(e.nightHours), 0);
    const workIncome = totalWork * dayPay;
    const partIncome = totalPart * hourlyPay;
    const otIncome = totalOt * otPay;
    const nightIncome = totalNight * nightPay;
    return {
      totalWork, totalPart, totalOt, totalNight, dayPay, hourlyPay, otPay, nightPay,
      workIncome, partIncome, otIncome, nightIncome,
      total: workIncome + partIncome + otIncome + nightIncome,
    };
  }

  /* ===================== 雲端備份（Cloudflare Worker） =====================
     資料加密後備份到站長自己的 Cloudflare Worker＋KV：
     - 恢復碼（8 位隨機碼）是唯一憑證：重裝 App 後填回 Worker 網址＋恢復碼即自動找回。
     - 端到端加密：金鑰由「恢復碼＋Worker 網址」派生（SHA-256 → AES-GCM），
       伺服器只有密文，站長也看不到內容。
     - 自動備份：資料或設定變更後 20 秒 debounce 推送；內容指紋沒變不重推；
       切到背景前若有未推送變更立即補推。 */
  const CF_APP = 'worktime-calendar-cf';
  // 站長部署的預設備份端點：用戶一鍵開啟即用，無需填寫
  const CF_DEFAULT_ENDPOINT = 'https://worktime-backup.isearover.workers.dev';
  const CF_DEBOUNCE = 20000;

  function genRecoveryCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  // 去掉易混淆的 I/O/0/1/L
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[rnd[i] % chars.length];
    return s;
  }

  function fmtCode(code) {
    return code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
  }

  function cfNorm(u) {
    return (u || '').trim().replace(/\/+$/, '');
  }

  function cfB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function cfUnb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function cfKey(code, endpoint) {
    const raw = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${CF_APP}|${code}|${endpoint}`)
    );
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function cfEncrypt(state, code, endpoint) {
    const key = await cfKey(code, endpoint);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(state))
    );
    return { iv: cfB64(iv), data: cfB64(new Uint8Array(ct)) };
  }

  async function cfDecrypt(enc, code, endpoint) {
    const key = await cfKey(code, endpoint);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: cfUnb64(enc.iv) },
      key,
      cfUnb64(enc.data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // 備份內容＝全部打卡記錄＋全部設定；連接資訊與 PIN 不上雲
  function cfBackupPayload() {
    return {
      entries,
      settings: { ...settings, cfEndpoint: '', cfCode: '', cfAt: '', cfHash: '', pinHash: '' },
    };
  }

  function cfHashOfState() {
    const s = { ...settings };
    delete s.cfEndpoint; delete s.cfCode; delete s.cfAt; delete s.cfHash; delete s.pinHash;
    const str = JSON.stringify({ entries, s });
    // FNV-1a 32 位：夠用於「內容有沒有變」的判斷
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return String(h);
  }

  async function cfApi(method, body) {
    const ep = cfNorm(settings.cfEndpoint);
    const res = await fetch(
      `${ep}/api/backup?code=${encodeURIComponent(settings.cfCode)}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }
    );
    let j = null;
    try { j = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
    return { status: res.status, ok: res.ok, json: j };
  }

  async function cfPush() {
    const endpoint = cfNorm(settings.cfEndpoint);
    if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.|localhost)/.test(endpoint)) {
      throw new Error('Worker 網址必須是 https://');
    }
    const enc = await cfEncrypt(cfBackupPayload(), settings.cfCode, endpoint);
    const body = { app: CF_APP, v: 1, savedAt: new Date().toISOString(), enc };
    const r = await cfApi('PUT', body);
    if (!r.ok) throw new Error(`備份失敗（${r.status}）`);
    settings.cfAt = new Date().toISOString();
    settings.cfHash = cfHashOfState();
    saveSettings();
  }

  let cfTimer = null;
  function scheduleCfBackup() {
    if (!settings.cfEndpoint || !settings.cfCode) return;
    if (cfHashOfState() === settings.cfHash) return;  // 內容沒變不重推（省 KV 寫入額度）
    clearTimeout(cfTimer);
    cfTimer = setTimeout(() => {
      cfPush().then(syncCfUI).catch((e) => console.warn('[備份] 自動備份失敗', e));
    }, CF_DEBOUNCE);
  }

  function syncCfUI() {
    const on = !!(settings.cfEndpoint && settings.cfCode);
    el.cfSetup.hidden = on;
    el.cfConnected.hidden = !on;
    if (on) {
      const t = settings.cfAt ? new Date(settings.cfAt) : null;
      el.cfStatus.textContent = t
        ? `已連接・上次備份：${t.toLocaleString('zh-TW')}`
        : '已連接・尚未備份過';
    }
  }

  function showCfCode(fromNew) {
    el.cfCodeText.textContent = fmtCode(settings.cfCode);
    el.cfCodeShow.hidden = false;
    el.cfCodeShow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function connectCf() {
    const endpoint = cfNorm(el.cfEndpoint.value) || cfNorm(settings.cfEndpoint) || CF_DEFAULT_ENDPOINT;
    if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.|localhost)/.test(endpoint)) {
      toast('Worker 網址必須是 https:// 開頭');
      el.cfEndpoint.focus();
      return;
    }
    const typed = el.cfCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isNew = !typed;
    const code = isNew ? genRecoveryCode() : typed;

    el.cfConnect.disabled = true;
    el.cfConnect.textContent = '連接中…';
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = endpoint;
      settings.cfCode = code;
      const r = await cfApi('GET');
      if (r.status === 200 && r.json && r.json.found) {
        if (Object.keys(entries).length) {
          const cloudAt = r.json.data && r.json.data.savedAt
            ? new Date(r.json.data.savedAt).toLocaleString('zh-TW') : '時間不明';
          const useCloud = confirm(`雲端已有這個碼的備份（${cloudAt}）。\n\n「確定」＝用雲端覆蓋本機\n「取消」＝把本機推上雲端`);
          if (useCloud) {
            await cfRestore(true);
            toast('已從雲端找回資料');
          } else {
            await cfPush();
            toast('已把本機資料備份到雲端');
          }
        } else {
          await cfRestore(true);   // 本機是空的：直接還原
          toast('已從雲端找回資料');
        }
      } else if (r.status === 404) {
        if (!isNew) toast('這個碼在雲端沒有備份，將以本機資料開始');
        await cfPush();
        toast('已建立雲端備份');
      } else {
        throw new Error(`Worker 回應異常（${r.status}）`);
      }
      saveSettings();
      syncCfUI();
      el.cfCodeInput.value = '';
      if (isNew) showCfCode(true);   // 新碼：立即大字展示引導截圖
    } catch (e) {
      console.error(e);
      toast('連接失敗：' + String(e.message || e).slice(0, 80));
      settings.cfEndpoint = prev.ep;
      settings.cfCode = prev.code;
      saveSettings();
      syncCfUI();
    } finally {
      el.cfConnect.disabled = false;
      el.cfConnect.textContent = '連接雲端備份';
    }
  }

  async function cfRestore(silent) {
    if (!settings.cfEndpoint || !settings.cfCode) { toast('尚未連接雲端'); return; }
    if (!silent && !confirm('用雲端備份覆蓋本機資料？\n本機目前的記錄會被取代。')) return;
    const r = await cfApi('GET');
    if (r.status !== 200 || !r.json || !r.json.found) {
      throw new Error('雲端沒有這個碼的備份');
    }
    const endpoint = cfNorm(settings.cfEndpoint);
    const state = await cfDecrypt(r.json.data.enc, settings.cfCode, endpoint);
    if (!state || !state.entries) throw new Error('備份格式不符');
    entries = migrate(state.entries).data;   // migrate 回傳 { data, converted }
    if (state.settings) {
      // 連接資訊與 PIN 留本機現值，其餘設定以備份為準
      const keep = {
        cfEndpoint: settings.cfEndpoint, cfCode: settings.cfCode,
        cfAt: settings.cfAt, cfHash: settings.cfHash, pinHash: settings.pinHash,
      };
      settings = { ...DEFAULTS, ...state.settings, ...keep };
    }
    settings.cfHash = cfHashOfState();  // 剛還原的內容＝雲端內容，避免立刻重推
    save(); saveSettings();
    view = new Date(); view.setDate(1);
    render(); updateHintText();
    syncCfUI();
  }

  async function cfBackupNow() {
    if (!settings.cfEndpoint || !settings.cfCode) { toast('尚未連接雲端'); return; }
    el.cfBackupNow.disabled = true;
    try {
      await cfPush();
      syncCfUI();
      toast('已備份到雲端');
    } catch (e) {
      console.error(e);
      toast('備份失敗：' + String(e.message || e).slice(0, 80));
    } finally {
      el.cfBackupNow.disabled = false;
    }
  }

  function disconnectCf() {
    if (!confirm('斷開雲端備份？\n本機資料不受影響，之後不再自動備份。\n（恢復碼若要繼續使用，請保留截圖）')) return;
    settings.cfEndpoint = '';
    settings.cfCode = '';
    settings.cfAt = '';
    settings.cfHash = '';
    saveSettings();
    syncCfUI();
    syncCfBanner();
    toast('已斷開雲端備份');
  }

  /* ---------------- 一鍵開啟（主畫面橫幅） ---------------- */
  function syncCfBanner() {
    el.cfBanner.hidden = !!settings.cfCode;   // 已開啟（有恢復碼）就收起
  }

  function openCfSheet() {
    el.cfSheetIntro.hidden = false;
    el.cfSheetOpen.hidden = false;
    el.cfSheetHaveToggle.hidden = false;
    el.cfSheetHave.hidden = true;          // 找回輸入區每次打開都收起
    el.cfSheetHaveInput.value = '';
    el.cfSheetCode.hidden = true;
    showOverlay(el.cfSheetBackdrop, el.cfSheet);
  }

  function closeCfSheet() {
    hideOverlay(el.cfSheetBackdrop, el.cfSheet);
  }

  async function oneTapConnect() {
    el.cfSheetOpen.disabled = true;
    el.cfSheetOpen.textContent = '開啟中…';
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = cfNorm(settings.cfEndpoint) || CF_DEFAULT_ENDPOINT;
      settings.cfCode = genRecoveryCode();
      // 撞碼（機率約 10^-11）就換一碼重試一次
      let r = await cfApi('GET');
      if (r.status === 200 && r.json && r.json.found) {
        settings.cfCode = genRecoveryCode();
        await cfApi('GET');
      }
      await cfPush();
      saveSettings();
      syncCfUI();
      syncCfBanner();
      el.cfSheetIntro.hidden = true;
      el.cfSheetOpen.hidden = true;
      el.cfSheetHaveToggle.hidden = true;
      el.cfSheetHave.hidden = true;
      el.cfSheetCode.hidden = false;
      el.cfSheetCodeText.textContent = fmtCode(settings.cfCode);
    } catch (e) {
      console.error(e);
      settings.cfEndpoint = prev.ep;
      settings.cfCode = prev.code;
      saveSettings();
      toast('開啟失敗：' + String(e.message || e).slice(0, 80));
    } finally {
      el.cfSheetOpen.disabled = false;
      el.cfSheetOpen.textContent = '一鍵開啟自動備份';
    }
  }

  /* 重裝找回：輸入已有的恢復碼 → 雲端有備份就還原並沿用此碼；
     沒有就報錯回滾，絕不悄悄換新碼。 */
  async function restoreByCode() {
    const code = (el.cfSheetHaveInput.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) {
      toast('請輸入 8 位恢復碼（格式 XXXX-XXXX）');
      el.cfSheetHaveInput.focus();
      return;
    }
    el.cfSheetHaveGo.disabled = true;
    el.cfSheetHaveGo.textContent = '找家中…';
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = cfNorm(settings.cfEndpoint) || CF_DEFAULT_ENDPOINT;
      settings.cfCode = code;
      const r = await cfApi('GET');
      if (r.status === 200 && r.json && r.json.found) {
        if (Object.keys(entries).length) {
          // 本機已有資料：沿用 connectCf 的衝突選擇
          const cloudAt = r.json.data && r.json.data.savedAt
            ? new Date(r.json.data.savedAt).toLocaleString('zh-TW') : '時間不明';
          const useCloud = confirm(`雲端已有這個碼的備份（${cloudAt}）。\n\n「確定」＝用雲端覆蓋本機\n「取消」＝保留本機，把本機推上雲端`);
          if (useCloud) {
            await cfRestore(true);
            toast('已從雲端找回資料');
          } else {
            await cfPush();
            toast('已把本機資料備份到雲端');
          }
        } else {
          await cfRestore(true);   // 本機是空的（剛重裝）：直接還原
          toast('已從雲端找回資料');
        }
      } else if (r.status === 404) {
        throw new Error('雲端沒有這組恢復碼的備份，請確認有沒有打錯');
      } else {
        throw new Error(`Worker 回應異常（${r.status}）`);
      }
      saveSettings();   // 沿用此碼：cfCode 已是舊碼，之後自動備份續用同一碼
      syncCfUI();
      syncCfBanner();   // 已開啟（有碼）→ 橫幅收起
      closeCfSheet();
    } catch (e) {
      console.error(e);
      settings.cfEndpoint = prev.ep;
      settings.cfCode = prev.code;
      saveSettings();
      toast(String(e.message || e).slice(0, 100));
    } finally {
      el.cfSheetHaveGo.disabled = false;
      el.cfSheetHaveGo.textContent = '用此碼找回並沿用';
    }
  }

  /* ===================== 螢幕鎖定 =====================
     啟用後：每次載入 App（init）、以及每次從背景回到前台（PWA 掛起
     不會重載頁面，靠 visibilitychange 補上「每次開 App 都要解鎖」），
     都要先輸入 4 位數字密碼。密碼只存 SHA-256 雜湊（settings.pinHash），
     不存明文、不離開裝置。連錯 5 次鎖鍵盤 30 秒（防瞎猜）。 */
  const LOCK_MAX = 4;
  let lockMode = '';        // '' 無 | 'unlock' | 'set1' | 'set2' | 'off'
  let lockBuf = '';
  let lockTemp = '';        // set1 暫存的新 PIN
  let lockWrong = 0;
  let lockCooldown = 0;
  let lockTimer = null;

  async function sha256Hex(s) {
    try {
      if (crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* 非 secure context，走後備 */ }
    // 後備（本地單機場景：防窺不防駭）
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = ((h1 ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
      h2 = ((h2 + s.charCodeAt(i) * (i + 7)) * 0x85ebca6b) >>> 0;
    }
    return 'fb' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  function lockRenderDots() {
    [...el.lockDots.children].forEach((d, i) => d.classList.toggle('on', i < lockBuf.length));
  }
  function lockMsg(text, hint) {
    el.lockMsg.textContent = text || '';
    el.lockMsg.classList.toggle('hint', !!hint);
  }
  function openLock(mode) {
    lockMode = mode; lockBuf = '';
    el.lockScreen.hidden = false;
    el.lockScreen.classList.remove('unlocked', 'shake');
    if (Date.now() < lockCooldown) lockTickCooldown();
    else { el.lockPad.classList.remove('locked'); lockMsg(''); }
    if (mode === 'unlock') { el.lockTitle.textContent = '輸入密碼'; lockMsg(''); }
    else if (mode === 'set1') { el.lockTitle.textContent = '設定新密碼'; lockMsg('請輸入 4 位數字', true); }
    else if (mode === 'set2') { el.lockTitle.textContent = '再輸入一次確認'; lockMsg(''); }
    else if (mode === 'off') { el.lockTitle.textContent = '關閉鎖定'; lockMsg('輸入目前密碼以確認', true); }
    lockRenderDots();
  }
  function closeLock() {
    lockMode = ''; lockBuf = ''; lockTemp = '';
    el.lockScreen.classList.add('unlocked');
    setTimeout(() => { el.lockScreen.hidden = true; }, 300);
  }
  function lockFail(msg) {
    lockWrong++;
    el.lockScreen.classList.remove('shake');
    void el.lockScreen.offsetWidth;   // 重觸發抖動動畫
    el.lockScreen.classList.add('shake');
    lockBuf = ''; lockRenderDots();
    if (lockWrong >= 5) { lockCooldown = Date.now() + 30000; lockTickCooldown(); }
    else lockMsg(msg);
  }
  function lockTickCooldown() {
    const left = Math.ceil((lockCooldown - Date.now()) / 1000);
    if (left > 0) {
      el.lockPad.classList.add('locked');
      lockMsg(`嘗試次數過多，${left} 秒後可再試`);
      clearTimeout(lockTimer);
      lockTimer = setTimeout(lockTickCooldown, 500);
    } else {
      lockWrong = 0;
      el.lockPad.classList.remove('locked');
      lockMsg('');
    }
  }
  async function lockSubmit() {
    if (Date.now() < lockCooldown) return;
    const pin = lockBuf;
    lockBuf = ''; lockRenderDots();
    if (lockMode === 'unlock') {
      if (pin && await sha256Hex(pin) === settings.pinHash) { lockWrong = 0; closeLock(); }
      else lockFail('密碼錯誤，請重試');
    } else if (lockMode === 'set1') {
      lockTemp = pin; openLock('set2');
    } else if (lockMode === 'set2') {
      if (pin === lockTemp) {
        settings.pinHash = await sha256Hex(pin);
        saveSettings(); syncLockUI();
        closeLock(); toast('螢幕鎖定已啟用');
      } else { openLock('set1'); lockMsg('兩次輸入不一致，請重新設定'); }
    } else if (lockMode === 'off') {
      if (pin && await sha256Hex(pin) === settings.pinHash) {
        settings.pinHash = '';
        saveSettings(); syncLockUI();
        closeLock(); toast('螢幕鎖定已關閉');
      } else lockFail('密碼錯誤，請重試');
    }
  }
  function lockKey(k) {
    if (!lockMode || Date.now() < lockCooldown) return;
    if (k === 'clear') lockBuf = '';
    else if (k === 'back') lockBuf = lockBuf.slice(0, -1);
    else if (lockBuf.length < LOCK_MAX) lockBuf += k;
    lockRenderDots();
    lockMsg('');
    if (lockBuf.length === LOCK_MAX) setTimeout(lockSubmit, 120);  // 輸滿自動驗證
  }
  function syncLockUI() {
    const on = !!settings.pinHash;
    el.lockState.textContent = on ? '已啟用' : '未啟用';
    el.lockBtn.textContent = on ? '關閉鎖定' : '設定密碼';
  }

  /* 收入金額的顯示狀態：session 內記憶、每次載入 App 都預設隱藏
     （不寫進 settings/localStorage——重新打開 App 不會記住「顯示」，
     避免在旁人面前一打開就直接暴露收入）。 */
  let incomeShown = false;

  function renderIncome() {
    const y = view.getFullYear(), m = view.getMonth();
    const inc = incomeOfMonth(y, m);
    if (!inc) { el.incomeBar.hidden = true; el.incomeBar.innerHTML = ''; return; }

    // 只有設定了費率的項目才出現在計算式裡，
    // 避免使用者只設日薪時還看到「0 h × $0」這種沒意義的片段。
    // 金額（日薪／加班時薪／半夜時薪的單價與總額）預設全部遮蔽，
    // 時數保留——旁人只看得到「做了多少」，看不到「值多少錢」。
    const shown = incomeShown;   // 先取狀態，money() 才能在模板展開時讀到
    const money = (v) => shown
      ? `$${fmtMoney(v)}`
      : `<span class="income-mask sm" aria-hidden="true">•••</span>`;
    const parts = [];
    if (inc.dayPay > 0) {
      parts.push(`<span class="income-part">${fmtUnits(inc.totalWork)} 工 × ${money(inc.dayPay)}</span>`);
    }
    if (inc.hourlyPay > 0) {
      parts.push(`<span class="income-part part">${fmtH(inc.totalPart)} h × ${money(inc.hourlyPay)}</span>`);
    }
    if (inc.otPay > 0) {
      parts.push(`<span class="income-part ot">${fmtH(inc.totalOt)} h × ${money(inc.otPay)}</span>`);
    }
    if (inc.nightPay > 0) {
      parts.push(`<span class="income-part night">${fmtH(inc.totalNight)} h × ${money(inc.nightPay)}</span>`);
    }
    const amount = shown
      ? `<span class="income-cur">$</span>${fmtMoney(inc.total)}`
      : `<span class="income-mask" aria-hidden="true">••••••</span>`;

    el.incomeBar.innerHTML = `
      <div class="income-label">
        <span>本月收入總計</span>
        ${parts.length ? `<span class="income-formula">${parts.join('<i>＋</i>')}</span>` : ''}
      </div>
      <button type="button" class="income-total${shown ? '' : ' is-masked'}"
              id="incomeToggle"
              aria-expanded="${shown}"
              aria-label="${shown ? '本月收入總計，點擊隱藏金額' : '本月收入總計已隱藏，點擊顯示金額'}"
              title="${shown ? '點擊隱藏金額' : '點擊顯示金額'}">
        ${amount}
        <span class="income-eye" aria-hidden="true">${shown ? '隱藏' : '顯示'}</span>
      </button>
    `;
    el.incomeBar.hidden = false;
  }

  function renderStats() {
    const y = view.getFullYear(), m = view.getMonth();
    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);        // 工
    const totalPart = list.reduce((s, e) => s + num(e.partHours), 0);        // 小時
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);            // 小時
    const totalNight = list.reduce((s, e) => s + num(e.nightHours), 0);      // 小時
    const days = list.filter((e) => num(e.workUnits) > 0 || num(e.partHours) > 0 ||
      num(e.otHours) > 0 || num(e.nightHours) > 0 ||
      e.workDesc || e.otDesc || e.nightDesc).length;

    el.monthStats.innerHTML = `
      ${totalWork > 0 || (!totalPart && !totalOt && !totalNight)
        ? `<span class="stat-pill"><span class="pill-label">工時 </span><b>${fmtUnits(totalWork)}</b> 工</span>` : ''}
      ${totalPart > 0 ? `<span class="stat-pill part"><span class="pill-label">兼職 </span><b>${fmtH(totalPart)}</b> h</span>` : ''}
      <span class="stat-pill ot"><span class="pill-label">加班 </span><b>${fmtH(totalOt)}</b> h</span>
      ${totalNight > 0 ? `<span class="stat-pill night"><span class="pill-label">半夜 </span><b>${fmtH(totalNight)}</b> h</span>` : ''}
      <span class="stat-pill"><span class="pill-label">記錄 </span><b>${days}</b> 天</span>
    `;
    fitStatsRow();
  }

  /* 統計膠囊與月標題「強制同行」自適應（讓出整行高度給月曆格子）：
     1) 寬度本來就夠（桌機）→ 原字級直接同行；
     2) 放不下 → 逐步縮膠囊字級（0.5px 步進，下限 10.5px）；
     3) 縮到下限仍放不下 → 精簡模式：隱藏「工時/加班/記錄」標籤詞，
        只留「數字＋單位」靠膠囊色塊區分語意，再視需要微縮；
     4) 極端情況 → 連月標題字級也輕微下調（下限 17px）；
     5) 全部失敗（如 320px 極窄機）→ 保留精簡模式折到標題下方獨佔一行：
        精簡版寬度遠小於完整版，即使折行也不會水平溢出。
     同行判定：膠囊容器與標題有垂直重疊（flex wrap 後兩者完全分離）。
     觸發時機：每次渲染統計、視窗 resize。 */
  function fitStatsRow() {
    const title = el.monthTitle;
    const box = el.monthStats;
    if (!box || !title || !box.children.length) return;
    box.style.fontSize = '';
    title.style.fontSize = '';
    box.classList.remove('stats-compact');
    const onOneRow = () => box.offsetTop < title.offsetTop + title.offsetHeight - 2;
    if (onOneRow()) return;
    let size = parseFloat(getComputedStyle(box).fontSize);
    for (size -= .5; size >= 10.5; size -= .5) {          // 一級：縮膠囊字級
      box.style.fontSize = size + 'px';
      if (onOneRow()) return;
    }
    box.classList.add('stats-compact');                    // 二級：精簡模式
    box.style.fontSize = '';
    if (onOneRow()) return;
    for (size = 14; size >= 11; size -= .5) {              // 精簡下再微縮
      box.style.fontSize = size + 'px';
      if (onOneRow()) return;
    }
    box.style.fontSize = '';
    let t = parseFloat(getComputedStyle(title).fontSize);
    for (t -= .5; t >= 17; t -= .5) {                      // 三級：縮月標題
      title.style.fontSize = t + 'px';
      if (onOneRow()) return;
    }
    title.style.fontSize = '';
    /* 全敗：保留 compact 折到標題下方——比完整折行版窄 ~100px，不會水平溢出。 */
  }

  function renderWeekdayRow() {
    const order = settings.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    el.weekdayRow.innerHTML = order
      .map((i) => {
        const cls = i === 6 ? 'wk-sat' : i === 0 ? 'wk-sun' : '';
        return `<span class="${cls}">${WEEK_TC[i]}</span>`;
      })
      .join('');
  }

  function renderCalendar() {
    const y = view.getFullYear(), m = view.getMonth();
    el.monthTitle.textContent = `${y} 年 ${m + 1} 月`;
    renderWeekdayRow();

    // 月曆第一個格子
    const first = new Date(y, m, 1);
    let offset = settings.mondayFirst ? (first.getDay() + 6) % 7 : first.getDay();

    const dim = new Date(y, m + 1, 0).getDate();
    const prevDim = new Date(y, m, 0).getDate();
    const cells = [];
    const tKey = todayKey();

    // 前置日期（上月）
    for (let i = offset - 1; i >= 0; i--) {
      cells.push({ blank: true, day: prevDim - i });
    }
    // 本月
    for (let d = 1; d <= dim; d++) {
      const date = new Date(y, m, d);
      const k = keyOf(date);
      const dow = date.getDay();
      const e = entries[k];
      cells.push({
        key: k,
        day: d,
        dow,
        isWeekend: dow === 0 || dow === 6,
        isToday: k === tKey,
        holiday: settings.showHolidays ? (HK_HOLIDAYS[k] || null) : null,
        entry: e,
      });
    }
    // 後置補齊至整週
    const tail = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= tail; i++) cells.push({ blank: true, day: i });

    el.calendarGrid.innerHTML = cells.map(cellHTML).join('');
  }

  function cellHTML(c) {
    if (c.blank) {
      return `<div class="day is-blank" aria-hidden="true"></div>`;
    }
    const e = c.entry || {};
    const wu = num(e.workUnits);
    const ph = num(e.partHours);
    const oh = num(e.otHours);
    const nh = num(e.nightHours);
    const hasWork = wu > 0 || (e.workDesc && e.workDesc.trim());
    const hasPart = ph > 0;
    const hasOt = oh > 0 || (e.otDesc && e.otDesc.trim());
    const hasNight = nh > 0 || (e.nightDesc && e.nightDesc.trim());
    const hasEntry = hasWork || hasPart || hasOt || hasNight;

    const classes = ['day'];
    if (c.isWeekend) classes.push('is-weekend');
    if (c.isToday) classes.push('is-today');
    if (c.holiday) classes.push('is-holiday');
    if (hasEntry) classes.push('has-entry');

    // 四組資料，各自「描述在上、時數在下」，但兩者包在**同一個色塊**裡：
    //   第一組：工時描述 + 工數（藍）
    //   第二組：兼職時數（綠，時薪制）
    //   第三組：加班描述 + 加班時數（橘）
    //   第四組：半夜加班描述 + 半夜加班時數（紫）
    // 色塊（.day-group）本身帶底色框住整組，描述與數字都在裡面，
    // 一眼就能看出「這個描述對應這個數字」。
    const workDesc = (e.workDesc || '').trim();
    const otDesc = (e.otDesc || '').trim();
    const nightDesc = (e.nightDesc || '').trim();
    const showUnits = settings.showHours;

    const groups = [];
    if (hasWork) {
      const rows = [];
      if (workDesc) {
        rows.push(`<div class="day-desc">${escapeHtml(workDesc)}</div>`);
      }
      if (showUnits) {
        rows.push(`<div class="day-units"><span class="uv">${fmtUnits(wu)}<span class="u">工</span></span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group work-group">${rows.join('')}</div>`);
    }
    if (hasPart) {
      if (showUnits) {
        groups.push(`<div class="day-group part-group"><div class="day-units part-units"><span class="uv">${fmtH(ph)}<span class="u">h</span></span><span class="ut">兼職</span></div></div>`);
      }
    }
    if (hasOt) {
      const rows = [];
      if (otDesc) {
        rows.push(`<div class="day-desc ot-text">${escapeHtml(otDesc)}</div>`);
      }
      if (showUnits) {
        rows.push(`<div class="day-units ot-units"><span class="uv"><span class="ot-pre">OT</span> ${fmtH(oh)}<span class="u">h</span></span><span class="ut">加班</span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group ot-group">${rows.join('')}</div>`);
    }
    if (hasNight) {
      const rows = [];
      if (nightDesc) {
        rows.push(`<div class="day-desc night-text">${escapeHtml(nightDesc)}</div>`);
      }
      if (showUnits) {
        rows.push(`<div class="day-units night-units"><span class="uv"><span class="ot-pre">OT</span> ${fmtH(nh)}<span class="u">h</span></span><span class="ut">半夜</span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group night-group">${rows.join('')}</div>`);
    }
    const groupsHtml = groups.length ? `<div class="day-groups">${groups.join('')}</div>` : '';

    const labelParts = [fmtDateLabel(new Date(c.key + 'T00:00:00'))];
    if (c.holiday) labelParts.push(`公眾假期：${c.holiday}`);
    if (hasEntry) {
      if (hasWork) labelParts.push(`工時 ${fmtUnits(wu)} 工`);
      if (hasPart) labelParts.push(`兼職 ${fmtH(ph)} 小時`);
      if (hasOt) labelParts.push(`加班 ${fmtH(oh)} 小時`);
      if (hasNight) labelParts.push(`半夜加班 ${fmtH(nh)} 小時`);
    } else {
      labelParts.push('尚無記錄');
    }

    // data-dow：讓 CSS 能分辨「六」與「日」。
    // 兩者都是週末（.is-weekend），但配色不同（星期六藍、星期日橘），
    // 與表頭的 六／日 一致；單靠 .is-weekend 無法區分。
    return `<div class="${classes.join(' ')}" data-key="${c.key}" data-dow="${c.dow}" role="gridcell" tabindex="0" aria-label="${escapeAttr(labelParts.join('，'))}">
      <div class="day-num">${c.day}</div>
      ${c.holiday ? `<div class="day-hol">${escapeHtml(c.holiday)}</div>` : ''}
      ${groupsHtml}
    </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
  const escapeAttr = escapeHtml;

  function render() {
    renderCalendar();
    renderStats();
    renderIncome();
  }

  /* ---------------- 面板：開啟 / 關閉 ---------------- */
  let lastFocused = null;

  function openSheet(key) {
    editingKey = key;
    const d = new Date(key + 'T00:00:00');
    const e = entries[key] || {};

    el.sheetDate.textContent = fmtDateLabel(d);
    // 假期日：日期下方顯示紅日名稱（顯示選項關閉時連面板也不標示）
    const hol = settings.showHolidays ? (HK_HOLIDAYS[key] || null) : null;
    el.sheetHol.textContent = hol ? `香港公眾假期・${hol}` : '';
    el.sheetHol.hidden = !hol;
    el.sheetTitle.textContent = hasContent(e) ? '編輯記錄' : '新增記錄';
    el.workDesc.value = e.workDesc || '';
    el.otDesc.value = e.otDesc || '';
    el.nightDesc.value = e.nightDesc || '';
    el.suggestWork.hidden = true;   // 開面板先收起描述建議（聚焦時才顯示）
    el.suggestOt.hidden = true;
    el.suggestNight.hidden = true;
    el.tagsInput.value = (e.tags || []).join(', ');

    // 工數預設：全新記錄 → 1 工（點開即存的快捷不變）；
    // 編輯已有記錄但無工數（純兼職／純加班日）→ 三個都不選，不誤導成「兼職」
    const wu = num(e.workUnits);
    const ph = e.partHours != null ? num(e.partHours) : 0;
    setWorkUnits(wu > 0 ? wu : (hasContent(e) ? null : 1));
    // 已有兼職記錄 → 展開兼職卡片供修改（不論工數模式）
    if (ph > 0) el.partGroup.hidden = false;
    el.partHours.value = ph;
    el.otHours.value = e.otHours != null ? num(e.otHours) : 0;
    el.nightHours.value = e.nightHours != null ? num(e.nightHours) : 0;

    el.deleteBtn.hidden = !hasContent(e);

    lastFocused = document.activeElement;
    showOverlay(el.sheetBackdrop, el.sheet);
    // 面板顯示後再同步滾輪位置（hidden 時 scrollTop 無效）。
    // 兩層 rAF 確保 layout 已完成，定位用 instant 不做動畫。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      syncWheel(el.partHoursWheel);
      syncWheel(el.otHoursWheel);
      syncWheel(el.nightHoursWheel);
    }));
    setTimeout(() => el.workDesc.focus({ preventScroll: true }), 280);
  }

  /** 設定工數（兼職時數 0 / 0.5 工 / 1 工 三個選項；null＝三個都不選，純加班／純兼職日用）
   *  選「兼職時數」→ 展開兼職小時卡片；選工數或全不選 → 收起（編輯保護由 openSheet 覆寫） */
  function setWorkUnits(value) {
    const chips = el.workUnitPicker.querySelectorAll('.unit-chip');
    // null / undefined → 全部取消選擇（不記工數，主介面可只顯示加班等記錄）
    if (value == null) {
      chips.forEach((chip) => {
        chip.classList.remove('is-active');
        chip.setAttribute('aria-checked', 'false');
      });
      if (!el.partGroup.hidden) el.partGroup.hidden = true;
      return;
    }

    const v = num(value);
    // 夾到最接近的合法選項（0＝兼職時數是合法值）
    const chosen = v === 0 ? 0
      : WORK_CHOICES.includes(v)
        ? v
        : WORK_CHOICES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

    chips.forEach((chip) => {
      const on = parseFloat(chip.dataset.value) === chosen;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    // 兼職小時卡片按需顯示：收起時 input 值保留（存檔不變）；
    // 從收起變展開時滾輪高度才有效，rAF 後同步一次滾輪位置
    const expand = chosen === 0;
    if (el.partGroup.hidden !== !expand) {
      el.partGroup.hidden = !expand;
      if (expand) requestAnimationFrame(() => syncWheel(el.partHoursWheel));
    }
  }

  function getWorkUnits() {
    const active = el.workUnitPicker.querySelector('.unit-chip.is-active');
    return active ? round1(num(active.dataset.value)) : 0;
  }

  function getPartHours() {
    return round1(num(el.partHours.value));
  }

  function getOtHours() {
    return round1(num(el.otHours.value));
  }

  function getNightHours() {
    return round1(num(el.nightHours.value));
  }

  function hasContent(e) {
    if (!e) return false;
    return !!(String(e.workDesc || '').trim() || String(e.otDesc || '').trim() ||
      String(e.nightDesc || '').trim() ||
      num(e.workUnits) > 0 || num(e.partHours) > 0 ||
      num(e.otHours) > 0 || num(e.nightHours) > 0);
  }

  function closeSheet() {
    hideOverlay(el.sheetBackdrop, el.sheet);
    editingKey = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  }

  function showOverlay(backdrop, panel) {
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      panel.classList.add('show');
    });
  }

  function hideOverlay(backdrop, panel, done) {
    backdrop.classList.remove('show');
    panel.classList.remove('show');
    setTimeout(() => {
      backdrop.hidden = true;
      panel.hidden = true;
      done && done();
    }, 280);
  }

  /* ---------------- 滾輪選擇器 ----------------
     加班／半夜時數共用：0–24、每次 0.5（共 49 格）。
     選項高度由 CSS 變數 --wheel-item-h 統一，JS 依 scrollTop 換算索引。 */
  const WHEEL_STEP = 0.5;
  const WHEEL_MAX = 24;
  const WHEEL_ITEM_H_FALLBACK = 36;

  function wheelItemH(wheel) {
    const v = parseFloat(getComputedStyle(wheel).getPropertyValue('--wheel-item-h'));
    return v > 0 ? v : WHEEL_ITEM_H_FALLBACK;
  }

  function wheelCount() {
    return Math.round(WHEEL_MAX / WHEEL_STEP); // 48 → 索引 0..48
  }

  function fmtWheelNum(v) {
    return v % 1 === 0 ? String(v) : v.toFixed(1); // 3 → "3"、2.5 → "2.5"
  }

  /** 依索引套用選中狀態：更新隱藏 input、aria 與選中格樣式 */
  function applyWheelIdx(wheel, idx) {
    const items = wheel._items;
    const maxIdx = items.length - 1;
    idx = Math.max(0, Math.min(maxIdx, idx));
    if (idx === wheel._idx) return;
    wheel._idx = idx;

    const v = round1(idx * WHEEL_STEP);
    const input = $(wheel.dataset.input);
    if (input) input.value = fmtWheelNum(v);
    wheel.setAttribute('aria-valuenow', String(v));
    wheel.setAttribute('aria-valuetext', `${fmtWheelNum(v)} 小時`);
    items.forEach((it, i) => it.toggleAttribute('data-active', i === idx));
  }

  /** 捲動使第 idx 格置中；smooth=true 時帶動畫 */
  function scrollWheelTo(wheel, idx, smooth) {
    const maxIdx = wheel._items.length - 1;
    idx = Math.max(0, Math.min(maxIdx, idx));
    wheel._scroll.scrollTo({
      top: idx * wheelItemH(wheel),
      behavior: smooth ? 'smooth' : 'auto',
    });
    applyWheelIdx(wheel, idx);
  }

  /** 依隱藏 input 目前的值，讓滾輪定位到對應格（開面板時用） */
  function syncWheel(wheel) {
    const input = $(wheel.dataset.input);
    const v = num(input ? input.value : 0);
    const idx = Math.round(v / WHEEL_STEP);
    wheel._idx = -1; // 強制 applyWheelIdx 重套（值可能沒變但位置要歸位）
    scrollWheelTo(wheel, idx, false);
  }

  function initWheel(wheel) {
    const scroll = wheel.querySelector('.wheel-scroll');
    wheel._scroll = scroll;
    wheel._items = [];
    wheel._idx = -1;

    for (let i = 0; i <= wheelCount(); i++) {
      const v = round1(i * WHEEL_STEP);
      const it = document.createElement('div');
      it.className = 'wheel-item';
      it.dataset.value = String(v);
      it.textContent = fmtWheelNum(v);
      it.addEventListener('click', () => scrollWheelTo(wheel, i, true));
      scroll.appendChild(it);
      wheel._items.push(it);
    }

    // 捲動中即時換算置中格（rAF 節流）
    let raf = 0;
    scroll.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyWheelIdx(wheel, Math.round(scroll.scrollTop / wheelItemH(wheel)));
      });
    }, { passive: true });

    // 鍵盤：上下 = ±0.5 小時，Home/End = 首尾
    wheel.addEventListener('keydown', (ev) => {
      const cur = wheel._idx < 0 ? 0 : wheel._idx;
      if (ev.key === 'ArrowUp') { ev.preventDefault(); scrollWheelTo(wheel, cur - 1, true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); scrollWheelTo(wheel, cur + 1, true); }
      else if (ev.key === 'Home') { ev.preventDefault(); scrollWheelTo(wheel, 0, true); }
      else if (ev.key === 'End') { ev.preventDefault(); scrollWheelTo(wheel, wheel._items.length - 1, true); }
    });
  }

  /* ---------------- 儲存 / 刪除 ---------------- */
  /* ---------------- 描述記憶 ----------------
     儲存記錄時把非空描述記入 settings.descHistory（work／ot／night 各自獨立）：
     最新在前、去重（重複輸入提到首位）、最多存 10 條。
     描述框聚焦時顯示最近 3 條建議 chips，點一下即填入。
     放在 settings 裡：隨一般設定持久化，也自動納入雲端備份。 */
  const DESC_HIST_MAX = 10;   // 儲存上限；面板內只顯示最近 3 條
  const DESC_SUGGEST_SHOW = 3;

  function rememberDesc(kind, text) {
    const t = (text || '').trim();
    if (!t) return;
    const h = (settings.descHistory = settings.descHistory || DEFAULTS.descHistory);
    const list = h[kind] = h[kind] || [];
    const i = list.indexOf(t);
    if (i > -1) list.splice(i, 1);
    list.unshift(t);
    if (list.length > DESC_HIST_MAX) list.length = DESC_HIST_MAX;
    saveSettings();
  }

  function renderDescSuggest(ta, box, kind) {
    const list = (settings.descHistory && settings.descHistory[kind]) || [];
    box.innerHTML = '';
    list.slice(0, DESC_SUGGEST_SHOW).forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggest-chip';
      chip.textContent = t;
      chip.title = t;
      // pointerdown 在 blur 前觸發：先攔下填入，避免建議被 blur 提前收起
      chip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ta.value = t;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        box.hidden = true;
      });
      box.appendChild(chip);
    });
    box.hidden = box.children.length === 0;
  }

  function saveEntry() {
    if (!editingKey) return;
    const workDesc = el.workDesc.value.trim();
    const otDesc = el.otDesc.value.trim();
    const nightDesc = el.nightDesc.value.trim();
    const workUnits = getWorkUnits();
    const partHours = getPartHours();
    const otHours = getOtHours();
    const nightHours = getNightHours();
    const tags = el.tagsInput.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

    const empty = !workDesc && !otDesc && !nightDesc && workUnits === 0 &&
      partHours === 0 && otHours === 0 && nightHours === 0 && tags.length === 0;
    if (empty) {
      delete entries[editingKey];
    } else {
      entries[editingKey] = {
        workDesc, workUnits, partHours, otDesc, otHours, nightDesc, nightHours, tags,
        updatedAt: Date.now(),
      };
      // 描述記憶：儲存時把非空描述記入各自歷史（最新在前、去重）
      rememberDesc('work', workDesc);
      rememberDesc('ot', otDesc);
      rememberDesc('night', nightDesc);
    }

    save();
    closeSheet();
    render();
    toast(empty ? '已清空此日記錄' : '已儲存');
  }

  function deleteEntry() {
    if (!editingKey) return;
    delete entries[editingKey];
    save();
    closeSheet();
    render();
    toast('已刪除記錄');
  }

  /* ---------------- 事件綁定 ---------------- */
  function bind() {
    /* 視窗尺寸變化時重算統計膠囊字級（轉屏、桌面拉窗） */
    window.addEventListener('resize', fitStatsRow);
    /* ---- 切換月份（按鈕與滑動共用）：帶方向性滑動過渡 ----
       dir=1 下一個月（新格從右滑入、舊格向左滑出淡出）；dir=-1 相反。
       prefers-reduced-motion 時直接切換不做動畫。 */
    let slideLock = false;
    function changeMonth(dir, animated) {
      view = new Date(view.getFullYear(), view.getMonth() + dir, 1);
      if (animated && !slideLock &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animateSlide(dir);
      } else {
        // 動畫中途連滑：先清掉上一輪殘留的位移/透明樣式，立即切換
        el.calendarGrid.style.transform = '';
        el.calendarGrid.style.opacity = '';
        render();
      }
    }

    /** 舊格 clone 成絕對定位層 → render 新月份 → 新格從 dir 側滑入、
        舊層向反方向滑出淡出 → 260ms 後移除 clone。期間 slideLock 鎖連滑。 */
    function animateSlide(dir) {
      slideLock = true;
      const grid = el.calendarGrid;
      const parent = grid.parentElement;
      const clone = grid.cloneNode(true);
      clone.removeAttribute('id');   // 避免動畫期間出現重複 id
      clone.classList.add('calendar-clone');
      clone.setAttribute('aria-hidden', 'true');
      const b = grid.getBoundingClientRect();
      const pb = parent.getBoundingClientRect();
      clone.style.left = (b.left - pb.left) + 'px';
      clone.style.top = (b.top - pb.top) + 'px';
      clone.style.width = b.width + 'px';
      clone.style.height = b.height + 'px';
      parent.appendChild(clone);

      render();   // grid 換上新月份內容
      // 左上角月份標題：與格子同方向滑入淡入，明確提示已切換月份
      const title = el.monthTitle;
      title.classList.remove('slide-next', 'slide-prev');
      void title.offsetWidth;   // 強制 reflow：連滑時也能重啟動畫
      title.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
      title.addEventListener('animationend', () => title.classList.remove('slide-next', 'slide-prev'), { once: true });
      grid.style.transform = `translateX(${dir * 56}px)`;
      grid.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        grid.classList.add('sliding');
        grid.style.transform = 'translateX(0)';
        grid.style.opacity = '1';
        clone.style.transform = `translateX(${-dir * 72}px)`;
        clone.style.opacity = '0';
      }));
      setTimeout(() => {
        clone.remove();
        grid.classList.remove('sliding');
        grid.style.transform = '';
        grid.style.opacity = '';
        slideLock = false;
      }, 290);
    }

    el.prevMonth.addEventListener('click', () => changeMonth(-1, true));
    el.nextMonth.addEventListener('click', () => changeMonth(1, true));
    el.todayBtn.addEventListener('click', () => {
      const t = new Date();
      view = new Date(t.getFullYear(), t.getMonth(), 1);
      render();
      toast('已回到本月');
    });

    /* ---- 月曆左右滑動切換月份（觸控）----
       水平位移 ≥56px、且水平明顯大於垂直（≥1.5 倍）才判定為滑動，
       避免和頁面上下捲動、格子單擊（位移小於閾值）互相干擾。
       面板／抽屜蓋住格子時 touchstart 不會落在格子上，無需額外判斷。 */
    let swipeX = null, swipeY = null, swipeAt = 0;
    el.calendarGrid.addEventListener('touchstart', (ev) => {
      if (ev.touches.length !== 1) { swipeX = null; return; }   // 多指（縮放）不處理
      swipeX = ev.touches[0].clientX;
      swipeY = ev.touches[0].clientY;
      swipeAt = Date.now();
    }, { passive: true });
    el.calendarGrid.addEventListener('touchend', (ev) => {
      if (swipeX == null) return;
      const t = ev.changedTouches[0];
      const dx = t.clientX - swipeX;
      const dy = t.clientY - swipeY;
      swipeX = null;
      if (Date.now() - swipeAt > 650) return;                          // 拖太久＝長按拖曳，不算滑
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) changeMonth(1, true);   // 左滑 → 下個月
      else changeMonth(-1, true);         // 右滑 → 上個月
    }, { passive: true });

    /* ---- 月曆：雙擊開啟；同時支援單擊（觸控裝置）---- */
    let lastTapKey = null;
    let lastTapTime = 0;
    let singleTapTimer = null;

    el.calendarGrid.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.day');
      if (!cell || cell.classList.contains('is-blank')) return;
      const k = cell.dataset.key;

      const now = Date.now();
      if (lastTapKey === k && now - lastTapTime < 320) {
        // 雙擊確認
        clearTimeout(singleTapTimer);
        lastTapKey = null;
        lastTapTime = 0;
        openSheet(k);
        return;
      }
      lastTapKey = k;
      lastTapTime = now;

      // 觸控裝置：延遲後視為單擊 → 也開啟（行動端較直覺）
      const isTouch = matchMedia('(hover: none)').matches;
      if (isTouch) {
        clearTimeout(singleTapTimer);
        singleTapTimer = setTimeout(() => { openSheet(k); }, 200);
      }
    });

    // 滑鼠雙擊（桌機原生 dblclick）
    el.calendarGrid.addEventListener('dblclick', (ev) => {
      const cell = ev.target.closest('.day');
      if (!cell || cell.classList.contains('is-blank')) return;
      clearTimeout(singleTapTimer);
      openSheet(cell.dataset.key);
    });

    // 鍵盤操作
    el.calendarGrid.addEventListener('keydown', (ev) => {
      const cell = ev.target.closest('.day');
      if (!cell || cell.classList.contains('is-blank')) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openSheet(cell.dataset.key);
      }
    });

    /* ---- 面板 ---- */
    el.saveBtn.addEventListener('click', saveEntry);
    el.cancelBtn.addEventListener('click', closeSheet);
    el.sheetClose.addEventListener('click', closeSheet);
    el.deleteBtn.addEventListener('click', () => {
      if (confirm('確定要刪除此日記錄嗎？')) deleteEntry();
    });
    el.sheetBackdrop.addEventListener('click', closeSheet);

    // Ctrl/Cmd + Enter 快速儲存
    el.sheet.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); saveEntry(); }
      if (ev.key === 'Escape') { ev.preventDefault(); closeSheet(); }
    });

    /* ---- 工數選項（兼職時數 / 0.5 工 / 1 工；可全部不選＝純加班日）---- */
    el.workUnitPicker.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.unit-chip');
      if (!chip) return;
      // 再點一次已選中的 chip → 取消選擇（工數可不記，只記加班／半夜）
      setWorkUnits(chip.classList.contains('is-active') ? null : parseFloat(chip.dataset.value));
    });

    /* ---- 滾輪選擇器（加班時數 / 半夜加班時數）----
       iOS 風格：上下滑動、scroll-snap 吸附置中，置中那格就是選中值。
       隱藏的 number input 仍是資料來源（openSheet 寫值、saveEntry 讀值），
       滾輪只負責顯示與輸入，兩者即時同步。 */
    document.querySelectorAll('.wheel-picker').forEach(initWheel);

    /* ---- 步進器（抽屜的每日工時；加班／半夜已改用滾輪）---- */
    document.querySelectorAll('.step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        const delta = parseFloat(btn.dataset.delta);
        const cur = parseFloat(input.value) || 0;
        let next = round1(cur + delta);
        const max = parseFloat(input.max) || 24;
        if (next < 0) next = 0;
        if (next > max) next = max;
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    /* ---- 抽屜 ---- */
    el.menuBtn.addEventListener('click', () => {
      el.dayPay.value = settings.dayPay > 0 ? settings.dayPay : '';
      el.hourlyPay.value = settings.hourlyPay > 0 ? settings.hourlyPay : '';
      el.otPay.value = settings.otPay > 0 ? settings.otPay : '';
      el.nightPay.value = settings.nightPay > 0 ? settings.nightPay : '';
      el.optWeekend.checked = settings.showWeekend;
      el.optHoliday.checked = settings.showHolidays;
      el.optShowHours.checked = settings.showHours;
      el.optMondayFirst.checked = settings.mondayFirst;
      syncThemeSeg();
      showOverlay(el.drawerBackdrop, el.drawer);
    });
    const closeDrawer = () => hideOverlay(el.drawerBackdrop, el.drawer);
    el.drawerClose.addEventListener('click', closeDrawer);
    el.drawerBackdrop.addEventListener('click', closeDrawer);

    // 薪資設定：日薪、時薪（兼職）、加班時薪、半夜加班時薪
    // 用 input 事件即時反映（使用者邊打字邊看到收入變化），change 時寫入儲存
    const payFields = [
      [el.dayPay, 'dayPay'],
      [el.hourlyPay, 'hourlyPay'],
      [el.otPay, 'otPay'],
      [el.nightPay, 'nightPay'],
    ];
    payFields.forEach(([input, name]) => {
      const apply = () => {
        const raw = input.value.trim();
        // 空字串視為 0（未設定），避免顯示成 NaN
        const v = raw === '' ? 0 : Math.max(0, num(raw));
        settings[name] = v;
        renderIncome();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => {
        apply();
        // 正規化顯示：0 或空 → 清空；有值 → 原樣保留
        input.value = settings[name] > 0 ? settings[name] : '';
        saveSettings();
        renderIncome();
      });
    });

    const toggleMap = [
      [el.optWeekend, 'showWeekend'],
      [el.optHoliday, 'showHolidays'],
      [el.optShowHours, 'showHours'],
      [el.optMondayFirst, 'mondayFirst'],
    ];
    toggleMap.forEach(([input, name]) => {
      input.addEventListener('change', () => {
        settings[name] = input.checked;
        saveSettings();
        render();
      });
    });

    /* ---- 主題三段選擇（跟隨系統／淺色／深色） ---- */
    if (el.themeSeg) {
      el.themeSeg.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.seg-btn');
        if (!btn) return;
        settings.theme = btn.dataset.themeOpt || 'auto';
        saveSettings();
        applyTheme();
        syncThemeSeg();
      });
    }
    if (themeMql) {
      const onSchemeChange = () => {
        if (settings.theme !== 'light' && settings.theme !== 'dark') applyTheme();
      };
      if (themeMql.addEventListener) themeMql.addEventListener('change', onSchemeChange);
      else if (themeMql.addListener) themeMql.addListener(onSchemeChange);   // 舊 Safari
    }

    /* ---- 描述記憶：聚焦顯示最近描述建議、失焦收起 ---- */
    [[el.workDesc, el.suggestWork, 'work'],
     [el.otDesc, el.suggestOt, 'ot'],
     [el.nightDesc, el.suggestNight, 'night'],
    ].forEach(([ta, box, kind]) => {
      if (!ta || !box) return;
      ta.addEventListener('focus', () => renderDescSuggest(ta, box, kind));
      ta.addEventListener('blur', () => { box.hidden = true; });
    });

    /* ---- 收入金額：點一下切換顯示 / 遮蔽 ----
       按鈕本身每次 renderIncome() 都會重建，所以用委派綁在容器上。 */
    el.incomeBar.addEventListener('click', (ev) => {
      if (!ev.target.closest('#incomeToggle')) return;
      incomeShown = !incomeShown;   // 只記在記憶體：重載 App 回到預設隱藏
      renderIncome();
    });

    /* ---- 螢幕鎖定：鍵盤（點擊委派）、選單入口、回前台重鎖 ---- */
    el.lockPad.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.lock-key');
      if (btn) lockKey(btn.dataset.k);
    });
    el.lockBtn.addEventListener('click', () => {
      closeDrawer();
      openLock(settings.pinHash ? 'off' : 'set1');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!settings.pinHash) return;                 // 未啟用：不鎖
      if (el.lockScreen.hidden) openLock('unlock');  // 已解鎖狀態從背景回來 → 重鎖
      // 鎖屏本來就開著（輸入到一半切走）也重開一次，清掉輸入
      else if (lockMode === 'unlock') openLock('unlock');
    });
    syncLockUI();

    /* ---- 雲端備份（Cloudflare） ---- */
    el.cfConnect.addEventListener('click', connectCf);
    el.cfBackupNow.addEventListener('click', cfBackupNow);
    el.cfDisconnect.addEventListener('click', disconnectCf);
    el.cfShowCode.addEventListener('click', () => showCfCode(false));
    el.cfCodeOk.addEventListener('click', () => { el.cfCodeShow.hidden = true; });
    el.cfBanner.addEventListener('click', openCfSheet);
    el.cfSheetOpen.addEventListener('click', oneTapConnect);
    el.cfSheetHaveToggle.addEventListener('click', () => {
      el.cfSheetHave.hidden = !el.cfSheetHave.hidden;
      if (!el.cfSheetHave.hidden) el.cfSheetHaveInput.focus();
    });
    el.cfSheetHaveGo.addEventListener('click', restoreByCode);
    el.cfSheetHaveInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') restoreByCode();
    });
    el.cfSheetDone.addEventListener('click', closeCfSheet);
    el.cfSheetClose.addEventListener('click', closeCfSheet);
    el.cfSheetBackdrop.addEventListener('click', closeCfSheet);
    el.cfRestore.addEventListener('click', () => {
      cfRestore(false).catch((e) => {
        console.error(e);
        toast('還原失敗：' + String(e.message || e).slice(0, 80));
      });
    });
    // 切到背景前若有未推送的變更，立即補推（瀏覽器通常允許剛發起的請求完成）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      if (!settings.cfEndpoint || !settings.cfCode) return;
      if (cfHashOfState() === settings.cfHash) return;
      cfPush().then(syncCfUI).catch(() => {});
    });
    syncCfUI();
    syncCfBanner();

    /* ---- 匯出 CSV ---- */
    el.exportCsv.addEventListener('click', () => {
      const y = view.getFullYear(), m = view.getMonth();
      const prefix = `${y}-${pad(m + 1)}-`;
      const rows = [['日期', '星期', '工數(工)', '工時描述', '兼職(小時)', '加班(小時)', '加班描述',
        '半夜加班(小時)', '半夜加班描述', '標籤']];
      Object.keys(entries).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
        const e = entries[k];
        const d = new Date(k + 'T00:00:00');
        rows.push([
          k, `週${WEEK_TC[d.getDay()]}`,
          num(e.workUnits), e.workDesc || '',
          num(e.partHours),
          num(e.otHours), e.otDesc || '',
          num(e.nightHours), e.nightDesc || '',
          (e.tags || []).join(' / '),
        ]);
      });
      if (rows.length === 1) { toast('本月尚無記錄可匯出'); return; }
      const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `工時月曆_${y}-${pad(m + 1)}.csv`);
      toast('已匯出 CSV');
    });

    /* ---- 匯出 JSON ---- */
    el.exportJson.addEventListener('click', () => {
      const payload = { app: 'worktime-calendar', v: 1, exportedAt: new Date().toISOString(), settings, data: entries };
      download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `工時月曆_備份_${todayKey()}.json`);
      toast('已匯出備份');
    });

    /* ---- 匯入 JSON ---- */
    el.importJson.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', async () => {
      const file = el.importFile.files && el.importFile.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const data = parsed.data || parsed;
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('格式錯誤');
        const incoming = Object.keys(data).length;
        if (!confirm(`將匯入 ${incoming} 筆記錄，同名日期會被覆蓋。確定繼續？`)) return;
        // 舊版小時制備份也會自動轉換為「工」
        entries = { ...entries, ...migrate(data).data };
        if (parsed.settings) settings = { ...settings, ...parsed.settings };
        save(); saveSettings();
        closeDrawer();
        render();
        toast(`已匯入 ${incoming} 筆記錄`);
      } catch (err) {
        toast('匯入失敗：檔案格式不正確');
        console.error(err);
      } finally {
        el.importFile.value = '';
      }
    });

    /* ---- 清除全部 ---- */
    el.clearAll.addEventListener('click', () => {
      if (!confirm('確定要清除全部工時記錄嗎？此操作無法復原。建議先匯出備份。')) return;
      entries = {};
      save();
      closeDrawer();
      render();
      toast('已清除全部資料');
    });

    /* ---- 全域快捷鍵 ---- */
    document.addEventListener('keydown', (ev) => {
      if (el.sheet.hidden && el.drawer.hidden) {
        if (ev.key === 'ArrowLeft') el.prevMonth.click();
        if (ev.key === 'ArrowRight') el.nextMonth.click();
        if (ev.key.toLowerCase() === 't') el.todayBtn.click();
      }
    });

    // 瀏覽器返回鍵關閉面板
    window.addEventListener('popstate', () => {
      if (!el.sheet.hidden) closeSheet();
      if (!el.drawer.hidden) closeDrawer();
    });
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /* ---------------- PWA 安裝提示 ---------------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPrompt = ev;
    el.installHint.textContent = '此應用可安裝到主畫面：點右上角選單 → 安裝應用程式。';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    el.installHint.textContent = '已安裝到裝置，可離線使用。';
  });

  function setupInstallHint() {
    const isStandalone = matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isStandalone) {
      el.installHint.textContent = '已以獨立應用模式執行，離線可用。';
    } else if (isIOS) {
      el.installHint.textContent = 'iOS：點「分享」→「加入主畫面」即可安裝。';
    } else if (!deferredPrompt) {
      el.installHint.textContent = '可安裝為 App：瀏覽器選單 → 安裝／加到主畫面。';
    }
  }

  /* =========================================================
   * 版本檢測與更新
   * ========================================================= */
  const version = {
    remote: null,      // 遠端最新版本資訊
    waiting: null,     // 等待接管的新版 Service Worker
    updating: false,   // 是否正在更新
    dismissed: null,   // 使用者選擇「稍後」的版本號
  };

  /** 版本號比對：a 是否比 b 新 */
  function isNewer(a, b) {
    if (!a || !b) return false;
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  function formatBuild(b) {
    // 20260915-1848 → 2026/09/15 18:48
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(b || '');
    return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : (b || '');
  }

  function renderVersionInfo() {
    el.verCurrent.textContent = `v${APP_VERSION}`;
    el.verBuild.textContent = APP_BUILD ? `建置於 ${formatBuild(APP_BUILD)}` : '';
  }

  /** 向伺服器查詢最新版本（繞過所有快取） */
  async function fetchRemoteVersion() {
    // 單檔模式（file://）無法連網，直接跳過，避免瀏覽器拋出無謂錯誤
    if (location.protocol === 'file:') return null;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.version ? data : null;
    } catch (e) {
      console.info('[版本] 查詢失敗（可能離線）', e);
      return null;
    }
  }

  /** 檢查更新 → 'update' | 'latest' | 'error' */
  async function checkForUpdate({ silent = false } = {}) {
    if (version.updating) return 'error';
    if (!silent) el.verStatus.textContent = '檢查中…';

    // 1) 已有 waiting 的新版 SW → 這是新版鐵證，直接提示
    if (version.waiting) {
      showUpdateBar(null, true);
      if (!silent) el.verStatus.textContent = '發現新版本，可立即更新';
      return 'update';
    }

    // 2) 比對 version.json
    const remote = await fetchRemoteVersion();
    if (!remote) {
      if (!silent) {
        el.verStatus.textContent = (location.protocol === 'file:')
          ? '單檔版不支援線上檢查更新'
          : '目前離線，無法檢查更新';
      }
      return 'error';
    }
    version.remote = remote;

    if (isNewer(remote.version, APP_VERSION)) {
      showUpdateBar(remote);
      if (!silent) el.verStatus.textContent = `發現新版本 v${remote.version}`;
      return 'update';
    }

    if (!silent) {
      el.verStatus.textContent = '已是最新版本';
      toast('已是最新版本');
    }
    return 'latest';
  }

  /**
   * 顯示更新提示橫幅
   * @param {object}  remote   遠端版本資訊（可省略）
   * @param {boolean} trusted  true = 已確認有新版本（例如 SW 進入 waiting），不再做版本比較
   */
  function showUpdateBar(remote, trusted) {
    // 更新進行中（按鈕正顯示「更新中…」）不重繪橫幅，避免輪詢期間被其他偵測蓋掉狀態
    if (version.updating) return;
    // 有遠端版本資訊就用它；沒有也照樣提示
    const info = remote || version.remote || null;
    const ver = info && info.version;

    if (!trusted) {
      // 只有在「非可信來源」時才做版本比較，避免誤報；
      // 但若連版本號都拿不到，寧可提示也不要靜默失敗
      if (ver && !isNewer(ver, APP_VERSION)) return;

      // 使用者已選「稍後」→ 同一版本不再重複提示
      if (ver && version.dismissed === ver) return;
    } else if (ver && version.dismissed === ver) {
      return;
    }

    el.updateDesc.textContent = (ver && isNewer(ver, APP_VERSION))
      ? (info.notes ? `v${ver}：${info.notes}` : `更新至 v${ver}`)
      : '已下載新版本，點此套用';

    el.updateBar.hidden = false;
    // 強制一次重排，確保 transition 由 transform 起始值開始
    void el.updateBar.offsetHeight;
    el.updateBar.classList.add('show');
    el.updateBar.setAttribute('aria-hidden', 'false');
  }

  function hideUpdateBar() {
    el.updateBar.classList.remove('show');
    el.updateBar.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.updateBar.hidden = true; }, 300);
  }

  /** 一鍵更新 */
  async function performUpdate() {
    if (version.updating) return;
    version.updating = true;

    const btn = el.updateNowBtn;
    const originalText = btn.textContent;
    btn.textContent = '更新中…';
    btn.disabled = true;

    // 套用就緒的新 SW：postMessage(skipWaiting) → controllerchange → 重載
    const applyWaiting = (sw) => {
      version.waiting = sw;
      try { sw.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ }
      setTimeout(() => hardReload(), 3000);   // 保險：訊息通道失效也會手動刷新
    };

    try {
      // A) 已有 waiting 的新 SW → 立即套用
      if (version.waiting) {
        applyWaiting(version.waiting);
        return;
      }

      // B) 偵測到版本差異 → 觸發瀏覽器抓新 SW，輪詢等它安裝完成（進入 waiting）。
      //    **安裝完成前絕不重載**——重載後仍是舊 SW 控制頁面、app.js 還是舊版，
      //    啟動時的版本比對會再彈一次提示（「按更新後提示仍在」的根因）。
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          let waited = 0;
          while (waited < 60000) {
            if (version.waiting || reg.waiting) {
              applyWaiting(version.waiting || reg.waiting);
              return;
            }
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }
          // 60 秒仍未就緒（網路慢）→ 不重載；全域偵測會在安裝完成時再提示套用
          version.updating = false;
          btn.textContent = '下載較慢…';
          btn.disabled = false;
          toast('新版本下載中，完成後會自動提示');
          return;
        }
      }

      // C) 沒有 SW（單檔模式）→ 清快取後重載
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      hardReload();
    } catch (e) {
      console.warn('[更新] 失敗', e);
      version.updating = false;
      btn.textContent = originalText;
      btn.disabled = false;
      toast('更新失敗，請稍後再試');
    }
  }

  /** 強制重新載入（加上參數避開瀏覽器快取） */
  function hardReload() {
    const url = new URL(location.href);
    url.searchParams.set('_v', Date.now().toString(36));
    location.replace(url.toString());
  }

  /**
   * SW 偵測到新版本 → 補抓一次遠端版本資訊（讓文案顯示正確版本號），再提示
   * 注意：SW 進入 waiting 已是新版本的鐵證，即使版本檔因舊 SW 快取而過期，
   *       仍必須提示使用者（trusted = true）。
   */
  async function announceWaitingSW(sw) {
    version.waiting = sw;
    if (!version.remote) {
      const remote = await fetchRemoteVersion();
      // 只在真的拿到「比目前新」的版本號時才採用，避免覆蓋成過期資料
      if (remote && isNewer(remote.version, APP_VERSION)) version.remote = remote;
    }
    showUpdateBar(null, true);
  }

  /** 註冊 Service Worker 並掛上更新偵測 */
  function setupServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      /** 檢查註冊狀態，若有 waiting 中的新 SW 就提示 */
      function detectWaiting(reg) {
        if (!reg || !reg.waiting) return false;
        if (!navigator.serviceWorker.controller) return false;
        if (version.waiting === reg.waiting) return true;   // 已處理過
        announceWaitingSW(reg.waiting);
        return true;
      }

      // 上次沒更新就關掉分頁 → 這裡補提示
      detectWaiting(reg);

      // 新 SW 安裝完成 → 提示
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed') detectWaiting(reg);
        });
      });

      // 保險：輪詢 waiting（updatefound / statechange 有時機競態，會漏事件）
      const poll = setInterval(() => {
        if (detectWaiting(reg)) clearInterval(poll);
      }, 1000);
      // 60 秒後停止輪詢，避免長期佔用
      setTimeout(() => clearInterval(poll), 60000);

      // 回到前景時檢查
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(() => {});
          setTimeout(() => detectWaiting(reg), 1500);
        }
      });

      // 定期檢查（30 分鐘）
      setInterval(() => {
        reg.update().catch(() => {});
        setTimeout(() => detectWaiting(reg), 1500);
      }, 30 * 60 * 1000);

      // 啟動時比對一次版本檔
      setTimeout(() => checkForUpdate({ silent: true }), 1500);

    }).catch((e) => console.warn('[SW] 註冊失敗', e));

    // 新 SW 接管 → 重載為新版
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      hardReload();
    });
  }

  function bindVersionUI() {
    el.updateNowBtn.addEventListener('click', performUpdate);

    el.updateLaterBtn.addEventListener('click', () => {
      const v = version.remote && version.remote.version;
      if (v) version.dismissed = v;
      hideUpdateBar();
      el.verStatus.textContent = '已稍後提醒，可隨時在選單檢查更新';
    });

    el.checkUpdateBtn.addEventListener('click', async () => {
      const r = await checkForUpdate();
      if (r === 'latest') el.verStatus.textContent = '已是最新版本';
      if (r === 'update') el.verStatus.textContent = '發現新版本，請點上方提示更新';
    });
  }

  /* ---------------- 啟動 ---------------- */
  /** 底部提示文字：依輸入方式調整——觸控裝置單擊即開面板，滑鼠需雙擊 */
  function updateHintText() {
    const el = document.getElementById('hintText');
    if (!el) return;
    el.textContent = matchMedia('(hover: none)').matches
      ? '點一下日期可新增或編輯工時／兼職／加班／半夜記錄'
      : '雙擊日期可新增或編輯工時／兼職／加班／半夜記錄';
  }

  function init() {
    load();
    applyTheme();   // 重設 meta theme-color 為目前主題（首幀由 inline script 設好）
    view = new Date();
    view.setDate(1);
    if (settings.pinHash) openLock('unlock');   // 先蓋鎖屏再渲染，內容不閃現
    bind();
    render();
    updateHintText();
    setupInstallHint();
    renderVersionInfo();
    bindVersionUI();

    if (window.addEventListener) {
      window.addEventListener('load', setupServiceWorker);
    } else {
      setupServiceWorker();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
