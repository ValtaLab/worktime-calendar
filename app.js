/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆；雙擊日期 → 新增/編輯 工時描述 + 加班描述
 * 儲存：localStorage（同步、離線可用），含版本號
 * ========================================================= */
(() => {
  'use strict';

  // 由 bump-version.sh 自動維護
  const APP_VERSION = '1.9.0';
  const APP_BUILD = '20260916-0844';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  const DEFAULTS = {
    stdHours: 8,
    showWeekend: true,
    showHours: true,
    mondayFirst: true,
    dayPay: 0,      // 日薪（1 工）
    otPay: 0,       // 加班時薪
  };

  /* ---------------- 狀態 ---------------- */
  let entries = {};              // { 'YYYY-MM-DD': {workDesc, workUnits, otDesc, otHours, tags, updatedAt} }
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
    tagsInput: $('tagsInput'),
    saveBtn: $('saveBtn'),
    cancelBtn: $('cancelBtn'),
    deleteBtn: $('deleteBtn'),

    // 工數（0.5 工 / 1 工）與加班時數（0.5 小時遞進）
    workUnitPicker: $('workUnitPicker'),
    workEquivalent: $('workEquivalent'),
    otHours: $('otHours'),

    drawer: $('drawer'),
    drawerBackdrop: $('drawerBackdrop'),
    drawerClose: $('drawerClose'),
    stdHours: $('stdHours'),
    dayPay: $('dayPay'),
    otPay: $('otPay'),
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

  // 本月收入：工數 × 日薪 + 加班時數 × 加班時薪
  // 未設定薪資（兩者皆為 0）時回傳 null，呼叫端據此隱藏區塊
  function incomeOfMonth(y, m) {
    const dayPay = num(settings.dayPay);
    const otPay = num(settings.otPay);
    if (dayPay <= 0 && otPay <= 0) return null;

    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);
    const workIncome = totalWork * dayPay;
    const otIncome = totalOt * otPay;
    return {
      totalWork, totalOt, dayPay, otPay, workIncome, otIncome,
      total: workIncome + otIncome,
    };
  }

  function renderIncome() {
    const y = view.getFullYear(), m = view.getMonth();
    const inc = incomeOfMonth(y, m);
    if (!inc) { el.incomeBar.hidden = true; el.incomeBar.innerHTML = ''; return; }

    const parts = [];
    if (inc.dayPay > 0) {
      parts.push(`<span class="income-part">${fmtUnits(inc.totalWork)} 工 × $${fmtMoney(inc.dayPay)}</span>`);
    }
    if (inc.otPay > 0) {
      parts.push(`<span class="income-part ot">${fmtH(inc.totalOt)} h × $${fmtMoney(inc.otPay)}</span>`);
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
    const totalWork = list.reduce((s, e) => s + num(e.workUnits), 0);      // 工
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);          // 小時
    const days = list.filter((e) => num(e.workUnits) > 0 || num(e.otHours) > 0 || e.workDesc || e.otDesc).length;

    el.monthStats.innerHTML = `
      <span class="stat-pill">工時 <b>${fmtUnits(totalWork)}</b> 工</span>
      <span class="stat-pill ot">加班 <b>${fmtH(totalOt)}</b> h</span>
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

  function cellHTML(c) {
    if (c.blank) {
      return `<div class="day is-blank" aria-hidden="true"></div>`;
    }
    const e = c.entry || {};
    const wu = num(e.workUnits);
    const oh = num(e.otHours);
    const hasWork = wu > 0 || (e.workDesc && e.workDesc.trim());
    const hasOt = oh > 0 || (e.otDesc && e.otDesc.trim());
    const hasEntry = hasWork || hasOt;

    const classes = ['day'];
    if (c.isWeekend) classes.push('is-weekend');
    if (c.isToday) classes.push('is-today');
    if (hasEntry) classes.push('has-entry');

    // 描述：工時描述與加班描述都要顯示。
    // 兩者各自獨立判斷，不再用 else if —— 同一天同時有工時與加班描述時，
    // 以前的寫法會讓加班描述被吃掉，只顯示工時描述。
    const workDesc = (e.workDesc || '').trim();
    const otDesc = (e.otDesc || '').trim();
    let descHtml = '';
    if (workDesc) {
      descHtml += `<div class="day-desc">${escapeHtml(workDesc)}</div>`;
    }
    if (otDesc) {
      descHtml += `<div class="day-desc ot-text">${escapeHtml(otDesc)}</div>`;
    }

    // 時數在後：工數一行，加班另起一行
    let unitsHtml = '';
    if (settings.showHours && hasEntry) {
      const rows = [];
      if (hasWork) {
        rows.push(`<div class="day-units"><span class="uv">${fmtUnits(wu)}<span class="u">工</span></span></div>`);
      }
      if (hasOt) {
        rows.push(`<div class="day-units ot-units"><span class="uv">+${fmtH(oh)}<span class="u">h</span></span><span class="ut">加班</span></div>`);
      }
      if (rows.length) unitsHtml = `<div class="day-units-wrap">${rows.join('')}</div>`;
    }

    let badges = '';
    if (hasEntry) {
      badges = `<div class="day-badge">
        ${hasWork ? '<i class="badge-dot"></i>' : ''}
        ${hasOt ? '<i class="badge-dot ot"></i>' : ''}
      </div>`;
    }

    const labelParts = [fmtDateLabel(new Date(c.key + 'T00:00:00'))];
    if (hasEntry) {
      if (hasWork) labelParts.push(`工時 ${fmtUnits(wu)} 工`);
      if (hasOt) labelParts.push(`加班 ${fmtH(oh)} 小時`);
    } else {
      labelParts.push('尚無記錄');
    }

    return `<div class="${classes.join(' ')}" data-key="${c.key}" role="gridcell" tabindex="0" aria-label="${escapeAttr(labelParts.join('，'))}">
      ${badges}
      <div class="day-num">${c.day}</div>
      ${descHtml}
      ${unitsHtml}
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
    el.sheetTitle.textContent = hasContent(e) ? '編輯記錄' : '新增記錄';
    el.workDesc.value = e.workDesc || '';
    el.otDesc.value = e.otDesc || '';
    el.tagsInput.value = (e.tags || []).join(', ');

    setWorkUnits(e.workUnits != null && num(e.workUnits) > 0 ? num(e.workUnits) : 1);
    el.otHours.value = e.otHours != null ? num(e.otHours) : 0;

    el.deleteBtn.hidden = !hasContent(e);

    lastFocused = document.activeElement;
    showOverlay(el.sheetBackdrop, el.sheet);
    setTimeout(() => el.workDesc.focus({ preventScroll: true }), 280);
  }

  /** 設定工數（僅 0.5 工 / 1 工 兩個選項）並更新換算提示 */
  function setWorkUnits(value) {
    const v = num(value);
    // 夾到最接近的合法選項
    const chosen = WORK_CHOICES.includes(v)
      ? v
      : WORK_CHOICES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

    el.workUnitPicker.querySelectorAll('.unit-chip').forEach((chip) => {
      const on = parseFloat(chip.dataset.value) === chosen;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    updateWorkEquivalent();
  }

  function getWorkUnits() {
    const active = el.workUnitPicker.querySelector('.unit-chip.is-active');
    return active ? round1(num(active.dataset.value)) : 0;
  }

  function getOtHours() {
    return round1(num(el.otHours.value));
  }

  /** 工數 → 小時換算提示 */
  function updateWorkEquivalent() {
    const hours = round1(getWorkUnits() * (num(settings.stdHours) || 8));
    el.workEquivalent.textContent = `＝ ${fmtH(hours)} 小時`;
  }

  function hasContent(e) {
    if (!e) return false;
    return !!(String(e.workDesc || '').trim() || String(e.otDesc || '').trim() ||
      num(e.workUnits) > 0 || num(e.otHours) > 0);
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

  /* ---------------- 儲存 / 刪除 ---------------- */
  function saveEntry() {
    if (!editingKey) return;
    const workDesc = el.workDesc.value.trim();
    const otDesc = el.otDesc.value.trim();
    const workUnits = getWorkUnits();
    const otHours = getOtHours();
    const tags = el.tagsInput.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

    const empty = !workDesc && !otDesc && workUnits === 0 && otHours === 0 && tags.length === 0;
    if (empty) {
      delete entries[editingKey];
    } else {
      entries[editingKey] = { workDesc, workUnits, otDesc, otHours, tags, updatedAt: Date.now() };
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
    el.prevMonth.addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      render();
    });
    el.nextMonth.addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      render();
    });
    el.todayBtn.addEventListener('click', () => {
      const t = new Date();
      view = new Date(t.getFullYear(), t.getMonth(), 1);
      render();
      toast('已回到本月');
    });

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

    /* ---- 工數選項（僅 0.5 工 / 1 工）---- */
    el.workUnitPicker.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.unit-chip');
      if (!chip) return;
      setWorkUnits(parseFloat(chip.dataset.value));
    });

    /* ---- 步進器（加班時數 + 抽屜設定）---- */
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
      el.stdHours.value = settings.stdHours;
      el.dayPay.value = settings.dayPay > 0 ? settings.dayPay : '';
      el.otPay.value = settings.otPay > 0 ? settings.otPay : '';
      el.optWeekend.checked = settings.showWeekend;
      el.optShowHours.checked = settings.showHours;
      el.optMondayFirst.checked = settings.mondayFirst;
      showOverlay(el.drawerBackdrop, el.drawer);
    });
    const closeDrawer = () => hideOverlay(el.drawerBackdrop, el.drawer);
    el.drawerClose.addEventListener('click', closeDrawer);
    el.drawerBackdrop.addEventListener('click', closeDrawer);

    el.stdHours.addEventListener('change', () => {
      const v = num(el.stdHours.value);
      settings.stdHours = v > 0 ? Math.min(v, 24) : 8;
      el.stdHours.value = settings.stdHours;
      saveSettings();
      renderStats();
      // 面板開著時同步更新小時換算
      if (!el.sheet.hidden) updateWorkEquivalent();
    });

    // 薪資設定：日薪與加班時薪
    // 用 input 事件即時反映（使用者邊打字邊看到收入變化），change 時寫入儲存
    const payFields = [
      [el.dayPay, 'dayPay'],
      [el.otPay, 'otPay'],
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

    /* ---- 匯出 CSV ---- */
    el.exportCsv.addEventListener('click', () => {
      const y = view.getFullYear(), m = view.getMonth();
      const prefix = `${y}-${pad(m + 1)}-`;
      const rows = [['日期', '星期', '工數(工)', '工時描述', '加班(小時)', '加班描述', '標籤']];
      Object.keys(entries).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
        const e = entries[k];
        const d = new Date(k + 'T00:00:00');
        rows.push([
          k, `週${WEEK_TC[d.getDay()]}`,
          num(e.workUnits), e.workDesc || '',
          num(e.otHours), e.otDesc || '',
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

    try {
      // A) 已有 waiting 的 SW → 請它立即接管，controllerchange 會帶動重載
      if (version.waiting) {
        version.waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => hardReload(), 3000);   // 保險：3 秒後仍未重載就手動刷新
        return;
      }

      // B) 僅偵測到版本差異 → 主動更新註冊，促使瀏覽器抓新檔
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          await new Promise((r) => setTimeout(r, 800));
          if (reg.waiting) {
            version.waiting = reg.waiting;
            version.waiting.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(() => hardReload(), 3000);
            return;
          }
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
  function init() {
    load();
    view = new Date();
    view.setDate(1);
    bind();
    render();
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
