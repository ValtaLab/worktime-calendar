/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆；雙擊日期 → 新增/編輯 工時描述 + 加班描述
 * 儲存：localStorage（同步、離線可用），含版本號
 * ========================================================= */
(() => {
  'use strict';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  const DEFAULTS = {
    stdHours: 8,
    showWeekend: true,
    showHours: true,
    mondayFirst: true,
  };

  /* ---------------- 狀態 ---------------- */
  let entries = {};              // { 'YYYY-MM-DD': {workDesc, workHours, otDesc, otHours, tags, updatedAt} }
  let settings = { ...DEFAULTS };
  let view = new Date();         // 目前顯示月份
  let editingKey = null;         // 正在編輯的日期 key

  /* ---------------- 工具 ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => keyOf(new Date());
  const isSameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const fmtH = (n) => round1(n).toString().replace(/\.0$/, '');

  const WEEK_TC = ['日', '一', '二', '三', '四', '五', '六'];

  function fmtDateLabel(d) {
    const w = WEEK_TC[d.getDay()];
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${w}）`;
  }

  /* ---------------- 儲存 ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') entries = parsed.data || parsed;
      }
    } catch (e) { console.warn('讀取資料失敗', e); }

    try {
      const rs = localStorage.getItem(SETTINGS_KEY);
      if (rs) settings = { ...DEFAULTS, ...JSON.parse(rs) };
    } catch (e) { /* 用預設 */ }
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
    workHours: $('workHours'),
    otDesc: $('otDesc'),
    otHours: $('otHours'),
    tagsInput: $('tagsInput'),
    saveBtn: $('saveBtn'),
    cancelBtn: $('cancelBtn'),
    deleteBtn: $('deleteBtn'),

    drawer: $('drawer'),
    drawerBackdrop: $('drawerBackdrop'),
    drawerClose: $('drawerClose'),
    stdHours: $('stdHours'),
    optWeekend: $('optWeekend'),
    optShowHours: $('optShowHours'),
    optMondayFirst: $('optMondayFirst'),
    exportCsv: $('exportCsv'),
    exportJson: $('exportJson'),
    importJson: $('importJson'),
    importFile: $('importFile'),
    clearAll: $('clearAll'),
    installHint: $('installHint'),

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

  function renderStats() {
    const y = view.getFullYear(), m = view.getMonth();
    const list = entriesOfMonth(y, m);
    const totalWork = list.reduce((s, e) => s + num(e.workHours), 0);
    const totalOt = list.reduce((s, e) => s + num(e.otHours), 0);
    const days = list.filter((e) => num(e.workHours) > 0 || num(e.otHours) > 0 || e.workDesc || e.otDesc).length;

    // 本月應出勤工時：週一至週五天數 × 標準工時
    const dim = new Date(y, m + 1, 0).getDate();
    let workdays = 0;
    for (let d = 1; d <= dim; d++) {
      const dow = new Date(y, m, d).getDay();
      if (dow !== 0 && dow !== 6) workdays++;
    }
    const expected = workdays * num(settings.stdHours);
    const rate = expected > 0 ? Math.round((totalWork / expected) * 100) : 0;

    el.monthStats.innerHTML = `
      <span class="stat-pill">工時 <b>${fmtH(totalWork)}</b> h</span>
      <span class="stat-pill ot">加班 <b>${fmtH(totalOt)}</b> h</span>
      <span class="stat-pill">記錄 <b>${days}</b> 天</span>
      <span class="stat-pill">達標 <b>${rate}</b>%</span>
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
    const wh = num(e.workHours);
    const oh = num(e.otHours);
    const hasWork = wh > 0 || (e.workDesc && e.workDesc.trim());
    const hasOt = oh > 0 || (e.otDesc && e.otDesc.trim());
    const hasEntry = hasWork || hasOt;

    const classes = ['day'];
    if (c.isWeekend) classes.push('is-weekend');
    if (c.isToday) classes.push('is-today');
    if (hasEntry) classes.push('has-entry');

    let hours = '';
    if (settings.showHours && hasEntry) {
      const parts = [];
      if (wh > 0) parts.push(`${fmtH(wh)}h`);
      if (oh > 0) parts.push(`<span class="ot-part">+${fmtH(oh)}h</span>`);
      if (parts.length) hours = `<div class="day-hours">${parts.join(' ')}</div>`;
    }

    const descHtml = e.workDesc && e.workDesc.trim()
      ? `<div class="day-desc">${escapeHtml(e.workDesc.trim())}</div>`
      : e.otDesc && e.otDesc.trim()
        ? `<div class="day-desc ot-text">${escapeHtml(e.otDesc.trim())}</div>`
        : '';

    let badges = '';
    if (hasEntry) {
      badges = `<div class="day-badge">
        ${hasWork ? '<i class="badge-dot"></i>' : ''}
        ${hasOt ? '<i class="badge-dot ot"></i>' : ''}
      </div>`;
    }

    const label = `${fmtDateLabel(new Date(c.key + 'T00:00:00'))}${hasEntry ? '，已有記錄' : '，尚無記錄'}`;
    return `<div class="${classes.join(' ')}" data-key="${c.key}" role="gridcell" tabindex="0" aria-label="${escapeAttr(label)}">
      ${badges}
      <div class="day-num">${c.day}</div>
      ${hours}
      ${descHtml}
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
    el.workHours.value = e.workHours != null ? e.workHours : num(settings.stdHours);
    el.otDesc.value = e.otDesc || '';
    el.otHours.value = e.otHours != null ? e.otHours : 0;
    el.tagsInput.value = (e.tags || []).join(', ');
    el.deleteBtn.hidden = !hasContent(e);

    lastFocused = document.activeElement;
    showOverlay(el.sheetBackdrop, el.sheet);
    setTimeout(() => el.workDesc.focus({ preventScroll: true }), 280);
  }

  function hasContent(e) {
    if (!e) return false;
    return !!(String(e.workDesc || '').trim() || String(e.otDesc || '').trim() ||
      num(e.workHours) > 0 || num(e.otHours) > 0);
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
    const workHours = num(el.workHours.value);
    const otHours = num(el.otHours.value);
    const tags = el.tagsInput.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

    const empty = !workDesc && !otDesc && workHours === 0 && otHours === 0 && tags.length === 0;
    if (empty) {
      delete entries[editingKey];
    } else {
      entries[editingKey] = { workDesc, workHours, otDesc, otHours, tags, updatedAt: Date.now() };
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

    /* ---- 步進器（面板內 + 抽屜內）---- */
    document.querySelectorAll('.step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        const delta = parseFloat(btn.dataset.delta);
        const cur = parseFloat(input.value) || 0;
        let next = round1(cur + delta);
        if (next < 0) next = 0;
        if (next > 24) next = 24;
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    /* ---- 抽屜 ---- */
    el.menuBtn.addEventListener('click', () => {
      el.stdHours.value = settings.stdHours;
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
      const rows = [['日期', '星期', '工時', '工時描述', '加班時數', '加班描述', '標籤']];
      Object.keys(entries).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
        const e = entries[k];
        const d = new Date(k + 'T00:00:00');
        rows.push([
          k, `週${WEEK_TC[d.getDay()]}`,
          e.workHours || 0, e.workDesc || '',
          e.otHours || 0, e.otDesc || '',
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
        entries = { ...entries, ...data };
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

  /* ---------------- 啟動 ---------------- */
  function init() {
    load();
    view = new Date();
    view.setDate(1);
    bind();
    render();
    setupInstallHint();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 註冊失敗', e));
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
