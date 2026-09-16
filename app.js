/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆；雙擊日期 → 新增/編輯 工時描述 + 加班描述 + 半夜加班描述
 * 儲存：localStorage（同步、離線可用），含版本號
 * ========================================================= */
(() => {
  'use strict';

  // 由 bump-version.sh 自動維護
  const APP_VERSION = '1.11.0';
  const APP_BUILD = '20260916-1927';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  const DEFAULTS = {
    stdHours: 8,
    showWeekend: true,
    showHours: true,
    mondayFirst: true,
    dayPay: 0,      // 日薪（1 工）
    otPay: 0,       // 加班時薪
    nightPay: 0,    // 半夜加班時薪
  };

  /* ---------------- 狀態 ---------------- */
  let entries = {};              // { 'YYYY-MM-DD': {workDesc, workUnits, otDesc, otHours, nightDesc, nightHours, tags, updatedAt} }
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
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* noop */ }
  }

  /* ---------------- 畫面元素 ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    monthTitle: $('monthTitle'),
    monthStats: $('monthStats'),
    incomeBar: $('incomeBar'),
    weekdayRow: $('weekdayRow'),
    calendarGrid: $('calendarGrid'),
    prevMonth: $('prevMonth'),
    nextMonth: $('nextMonth'),
    todayBtn: $('todayBtn'),
    menuBtn: $('menuBtn'),

    sheet: $('sheet'),
    sheetBackdrop: $('sheetBackdrop'),
    sheetDate: $('sheetDate'),
    sheetTitle: $('sheetTitle'),
    sheetClose: $('sheetClose'),
    workDesc: $('workDesc'),
    otDesc: $('otDesc'),
    nightDesc: $('nightDesc'),
    tagsInput: $('tagsInput'),
    saveBtn: $('saveBtn'),
    cancelBtn: $('cancelBtn'),
    deleteBtn: $('deleteBtn'),

    // 工數（0.5 工 / 1 工）、加班時數與半夜加班時數（皆 0.5 小時遞進）
    workUnitPicker: $('workUnitPicker'),
    workEquivalent: $('workEquivalent'),
    otHours: $('otHours'),
    nightHours: $('nightHours'),

    drawer: $('drawer'),
    drawerBackdrop: $('drawerBackdrop'),
    drawerClose: $('drawerClose'),
    stdHours: $('stdHours'),
    dayPay: $('dayPay'),
    otPay: $('otPay'),
    nightPay: $('nightPay'),
    optWeekend: $('optWeekend'),
    optShowHours: $('optShowHours'),
    optMondayFirst: $('optMondayFirst'),
    exportCsv: $('exportCsv'),
    exportJson: $('exportJson'),
    importJson: $('importJson'),
    importFile: $('importFile'),
    clearAll: $('clearAll'),
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

  function renderStats() {
    const y = view.getFullYear(), m = view.getMonth();
    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);        // 工
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);            // 小時
    const totalNight = list.reduce((s, e) => s + num(e.nightHours), 0);      // 小時
    const days = list.filter((e) => num(e.workUnits) > 0 || num(e.otHours) > 0 ||
      num(e.nightHours) > 0 || e.workDesc || e.otDesc || e.nightDesc).length;

    el.monthStats.innerHTML = `
      <span class="stat-pill">工時 <b>${fmtUnits(totalWork)}</b> 工</span>
      <span class="stat-pill ot">加班 <b>${fmtH(totalOt)}</b> h</span>
      ${totalNight > 0 ? `<span class="stat-pill night">半夜 <b>${fmtH(totalNight)}</b> h</span>` : ''}
      <span class="stat-pill">記錄 <b>${days}</b> 天</span>
    `;
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
        entry: e,
      });
    }
    // 後置補齊至整週
    const tail = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= tail; i++) cells.push({ blank: true, day: i });

    el.calendarGrid.innerHTML = cells.map(cellHTML).join('');
  }
