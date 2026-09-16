/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆
 * 雙擊日期添加工時描述、加班描述、半夜加班描述
 * 零依賴、純前端、資料存在 localStorage
 * ========================================================= */
(function () {
  'use strict';

  const APP_VERSION = '1.11.0';
  const APP_BUILD = '20260916-1927';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  const DEFAULTS = {
    stdHours: 8,
    showWeekend: true,
    showHours: true,
    mondayFirst: true,
    dayPay: 0,
    otPay: 0,
    nightPay: 0,
  };

  const WORK_CHOICES = [0.5, 1];

  // { 'YYYY-MM-DD': {workDesc, workUnits, otDesc, otHours, nightDesc, nightHours, tags, updatedAt} }
  let entries = {};
  let settings = { ...DEFAULTS };
  let view = new Date();
  let editingKey = null;

  const WEEK_TC = ['日', '一', '二', '三', '四', '五', '六'];

  function fmtDateLabel(d) {
    const w = WEEK_TC[d.getDay()];
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${w}）`;
  }

  /* ---------------- 儲存 ---------------- */
  function load() {
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
          if (result.converted > 0) save();
        }
      }
    } catch (e) { console.warn('讀取資料失敗', e); }
  }

  function migrate(data) {
    if (!data || typeof data !== 'object') return { data: {}, converted: 0 };
    const base = num(settings.stdHours) || num(DEFAULTS.stdHours) || 8;
    const out = {};
    let converted = 0;

    for (const [k, e] of Object.entries(data)) {
      if (!e || typeof e !== 'object') continue;
      const next = { ...e };

      if (next.workUnits == null && next.workHours != null) {
        next.workUnits = round1(num(next.workHours) / base);
        converted++;
      }
      if (next.otHours == null && next.otUnits != null) {
        next.otHours = round1(num(next.otUnits) * base);
        converted++;
      }
      delete next.workHours;
      delete next.otUnits;

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
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* noop */ }
  }

  /* ---------------- 小工具 ---------------- */
  const $ = (id) => document.getElementById(id);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const round1 = (v) => Math.round(v * 10) / 10;

  // 工數顯示：整數不帶小數，半工顯示 0.5
  const fmtUnits = (v) => {
    const n = round1(num(v));
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  // 小時顯示：同工數邏輯
  const fmtH = (v) => fmtUnits(v);

  // 金額顯示：千分位 + 最多兩位小數（有需要才顯示小數）
  const fmtMoney = (n) => {
    const v = Math.round(n * 100) / 100;
    const hasFrac = Math.abs(v % 1) > 0.0001;
    return v.toLocaleString('zh-TW', {
      minimumFractionDigits: hasFrac ? 2 : 0,
      maximumFractionDigits: 2,
    });
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function dateKey(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function entriesOfMonth(y, m) {
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
    return Object.entries(entries)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, e]) => e);
  }

  function toDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function hasContent(e) {
    if (!e) return false;
    return !!(String(e.workDesc || '').trim() || String(e.otDesc || '').trim() ||
      String(e.nightDesc || '').trim() ||
      num(e.workUnits) > 0 || num(e.otHours) > 0 || num(e.nightHours) > 0);
  }

  /* ---------------- 收入 ---------------- */
  // 本月收入：工數 × 日薪 + 加班時數 × 加班時薪 + 半夜加班時數 × 半夜加班時薪
  // 三個費率都未設定（皆為 0）時回傳 null，呼叫端據此隱藏整個區塊
  function incomeOfMonth(y, m) {
    const dayPay = num(settings.dayPay);
    const otPay = num(settings.otPay);
    const nightPay = num(settings.nightPay);
    if (dayPay <= 0 && otPay <= 0 && nightPay <= 0) return null;

    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);
    const totalNight = list.reduce((s, e) => s + num(e.nightHours), 0);
    const workIncome = totalWork * dayPay;
    const otIncome = totalOt * otPay;
    const nightIncome = totalNight * nightPay;
    return {
      totalWork, totalOt, totalNight, dayPay, otPay, nightPay,
      workIncome, otIncome, nightIncome,
      total: workIncome + otIncome + nightIncome,
    };
  }

  // 元素快取在下方 el，這裡先用函式延後取用
  let el = {};

  function renderIncome() {
    const y = view.getFullYear(), m = view.getMonth();
    const inc = incomeOfMonth(y, m);
    if (!inc) { el.incomeBar.hidden = true; el.incomeBar.innerHTML = ''; return; }

    // 只有設定了費率的項目才出現在計算式裡，
    // 避免使用者只設日薪時還看到「0 h × $0」這種沒意義的片段。
    const parts = [];
    if (inc.dayPay > 0) {
      parts.push(`<span class="income-part">${fmtUnits(inc.totalWork)} 工 × $${fmtMoney(inc.dayPay)}</span>`);
    }
    if (inc.otPay > 0) {
      parts.push(`<span class="income-part ot">${fmtH(inc.totalOt)} h × $${fmtMoney(inc.otPay)}</span>`);
    }
    if (inc.nightPay > 0) {
      parts.push(`<span class="income-part night">${fmtH(inc.totalNight)} h × $${fmtMoney(inc.nightPay)}</span>`);
    }

    el.incomeBar.innerHTML = `
      <div class="income-label">
        <span>本月收入總計</span>
        ${parts.length ? `<span class="income-formula">${parts.join('<i>＋</i>')}</span>` : ''}
      </div>
      <p class="income-total"><span class="income-cur">$</span>${fmtMoney(inc.total)}</p>
    `;
    el.incomeBar.hidden = false;
  }

  /* ---------------- 統計 ---------------- */
  function renderStats() {
    const y = view.getFullYear(), m = view.getMonth();
    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);
    const totalNight = list.reduce((s, e) => s + num(e.nightHours), 0);
    const days = list.filter((e) => num(e.workUnits) > 0 || num(e.otHours) > 0 ||
      num(e.nightHours) > 0 || e.workDesc || e.otDesc || e.nightDesc).length;

    el.monthStats.innerHTML = `
      <span class="stat-pill">工時 <b>${fmtUnits(totalWork)}</b> 工</span>
      <span class="stat-pill ot">加班 <b>${fmtH(totalOt)}</b> h</span>
      ${totalNight > 0 ? `<span class="stat-pill night">半夜 <b>${fmtH(totalNight)}</b> h</span>` : ''}
      <span class="stat-pill">記錄 <b>${days}</b> 天</span>
    `;
  }
