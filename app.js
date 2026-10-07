/* =========================================================
 * 工時月曆 PWA
 * 主介面：月曆；雙擊日期 → 新增/編輯 工時描述 + 加班描述
 * 儲存：localStorage（同步、離線可用），含版本號
 * ========================================================= */
(() => {
  'use strict';

  // 由 bump-version.sh 自動維護
  const APP_VERSION = '1.34.3';
  const APP_BUILD = '20261007-1828';

  const STORE_KEY = 'worktime-calendar:v1';
  const SETTINGS_KEY = 'worktime-calendar:settings:v1';

  // 香港公眾假期（紅日）——資料來源：1823 官方 iCal（www.1823.gov.hk）
  // 2025–2027 已由政府憲報公布；新一年公布後於年末更新此表。
  // 無資料的年份照常運作（只是不顯示假期標示）。
  // 值為 HOLIDAY_NAMES 的鍵（顯示時才依語言取名），見 i18n 區塊。
  const HK_HOLIDAYS = {
    // 2025
    '2025-01-01': 'newYear',
    '2025-01-29': 'lunarNewYear1',
    '2025-01-30': 'lunarNewYear2',
    '2025-01-31': 'lunarNewYear3',
    '2025-04-04': 'chingMing',
    '2025-04-18': 'goodFriday',
    '2025-04-19': 'goodFridayNext',
    '2025-04-21': 'easterMonday',
    '2025-05-01': 'labourDay',
    '2025-05-05': 'buddha',
    '2025-05-31': 'tsuenWan',
    '2025-07-01': 'hksar',
    '2025-10-01': 'nationalDay',
    '2025-10-07': 'midAutumnNext',
    '2025-10-29': 'chungYeung',
    '2025-12-25': 'christmas',
    '2025-12-26': 'boxingDay',
    // 2026
    '2026-01-01': 'newYear',
    '2026-02-17': 'lunarNewYear1',
    '2026-02-18': 'lunarNewYear2',
    '2026-02-19': 'lunarNewYear3',
    '2026-04-03': 'goodFriday',
    '2026-04-04': 'goodFridayNext',
    '2026-04-06': 'chingMingNext',
    '2026-04-07': 'easterMondayNext',
    '2026-05-01': 'labourDay',
    '2026-05-25': 'buddhaNext',
    '2026-06-19': 'tsuenWan',
    '2026-07-01': 'hksar',
    '2026-09-26': 'midAutumnNext',
    '2026-10-01': 'nationalDay',
    '2026-10-19': 'chungYeungNext',
    '2026-12-25': 'christmas',
    '2026-12-26': 'boxingDay',
    // 2027
    '2027-01-01': 'newYear',
    '2027-02-06': 'lunarNewYear1',
    '2027-02-08': 'lunarNewYear3',
    '2027-02-09': 'lunarNewYear4',
    '2027-03-26': 'goodFriday',
    '2027-03-27': 'goodFridayNext',
    '2027-03-29': 'easterMonday',
    '2027-04-05': 'chingMing',
    '2027-05-01': 'labourDay',
    '2027-05-13': 'buddha',
    '2027-06-09': 'tsuenWan',
    '2027-07-01': 'hksar',
    '2027-09-16': 'midAutumnNext',
    '2027-10-01': 'nationalDay',
    '2027-10-08': 'chungYeung',
    '2027-12-25': 'christmas',
    '2027-12-27': 'boxingDay',
  };

  const DEFAULTS = {
    stdHours: 8,    // 僅供舊資料遷移換算（1 工 = N 小時）；UI 已移除此設定
    theme: 'auto',  // 主題：auto＝跟隨系統光暗模式；light／dark＝固定
    lang: 'zh-Hant', // 介面語言：'zh-Hant'（繁中）| 'en'（English）
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
    cfSalt: '',     // 加密鹽（隨機 16 bytes，base64）——只存在本機與備份檔的加密內容裡
    cfWriteKey: '', // 寫入金鑰（隨機 32 bytes，base64）——有它才能覆寫／刪除雲端備份
    cfV2: false,    // 是否已經用 v2 新格式備份過（決定還要不要回頭查舊備份）
  };

  /* ===================== i18n（繁體中文 / English） =====================
     語言設定存於 settings.lang（'zh-Hant' | 'en'），在側邊選單「語言」切換。
     靜態文案在 index.html 以 data-i18n / data-i18n-ph / data-i18n-aria 標記，
     由 applyLang() 一次套用；動態文案一律走 t(key, vars)。
     假期名稱 HK_HOLIDAYS 只存鍵（HOLIDAY_NAMES 的 key），顯示時才依語言取名。 */
  const LANGS = ['zh-Hant', 'en'];

  const I18N = {
    'zh-Hant': {
      appName: '工時月曆',
      docTitle: '工時月曆｜工時、加班、兼職記錄 App',
      metaDesc: '工時月曆 — 免費的工時與加班記錄 App（PWA）。用月曆記錄每日工數、兼職時數、加班與半夜加班時數，自動計算每月收入；支援香港公眾假期、中英文介面、深色模式與離線使用，記錄只存在你的裝置。',

      // 頁尾簡介（SEO 用；同時俾第一次打開嘅人睇）
      aboutTitle: '關於工時月曆',
      aboutIntro: '工時月曆是一個免費的網頁 App（PWA），用月曆記錄每日工數、兼職時數、加班與半夜加班時數，並依你設定的日薪與時薪自動計算每月收入。雙擊任何一天即可新增記錄，支援香港公眾假期顯示、中英文介面、深色模式與離線使用；所有記錄只保存在你的裝置，可隨時匯出 CSV 或 JSON 備份。',
      aboutFaq: '常見問題',
      aboutQ1: '需要安裝嗎？',
      aboutA1: '不需要。用瀏覽器打開即可使用；想當成 App 用，可「加到主畫面」，之後即使離線也開得起來。',
      aboutQ2: '記錄會上傳到伺服器嗎？',
      aboutA2: '不會。記錄只存在你裝置的瀏覽器內。若自行開啟雲端備份，資料會以端到端加密上傳，伺服器只有密文。',
      aboutQ3: '加班與收入怎樣計算？',
      aboutA3: '加班與半夜加班以 0.5 小時為單位。在「薪資設定」填好日薪、時薪、加班時薪與半夜加班時薪後，月曆下方與每日格子會自動顯示當月與當日收入。',
      aboutQ4: '有香港公眾假期嗎？',
      aboutA4: '已內置 2025–2027 年香港公眾假期，假期日會以紅字顯示假期名稱，可在設定中關閉。',
      today: '今天',
      monthNav: '月份切換',
      prevMonth: '上一個月',
      nextMonth: '下一個月',
      menu: '更多操作',
      calendar: '月曆',
      close: '關閉',
      drawerMenu: '選單',

      // 底部提示
      hintTouch: '點一下日期可新增或編輯工時／兼職／加班／半夜記錄',
      hintMouse: '雙擊日期可新增或編輯工時／兼職／加班／半夜記錄',

      // 面板
      sheetNew: '新增記錄',
      sheetEdit: '編輯記錄',
      workSection: '工時',
      partSection: '兼職小時',
      otSection: '加班',
      nightSection: '半夜加班',
      desc: '描述',
      workUnits: '工數',
      partHours: '兼職時數',
      otHours: '加班時數',
      nightHours: '半夜加班時數',
      chipPart: '兼職時數',
      chipPartSub: '不記工數',
      chipHalf: '0.5 工',
      chipHalfSub: '半日',
      chipFull: '1 工',
      chipFullSub: '全日',
      hourWord: '小時',
      scrollHelp: '上下滑動選擇・按時薪計',
      tagsLabel: '標籤（選填）',
      tagsPlaceholder: '以逗號分隔，例：出差, 遠端',
      delete: '刪除',
      cancel: '取消',
      save: '儲存',
      hkHolidayPrefix: '香港公眾假期・',

      // 收入
      incomeLabel: '本月收入總計',
      incomeShowAria: '本月收入總計，點擊隱藏金額',
      incomeHideAria: '本月收入總計已隱藏，點擊顯示金額',
      incomeHideTip: '點擊隱藏金額',
      incomeShowTip: '點擊顯示金額',
      incomeHideWord: '隱藏',
      incomeShowWord: '顯示',

      // 統計膠囊
      statWork: '工時 ',
      statPart: '兼職 ',
      statOt: '加班 ',
      statNight: '半夜 ',
      statDays: '記錄 ',
      unitWork: '工',
      unitDays: '天',

      // 格子
      holPrefix: '公眾假期：',
      cellWork: '工時',
      cellPart: '兼職',
      cellOt: '加班',
      cellNight: '半夜加班',
      cellNoRecord: '尚無記錄',
      cellIncome: '當日收入',

      // 側邊選單
      secAppearance: '外觀',
      themeGroup: '主題模式',
      themeAuto: '跟隨系統',
      themeLight: '淺色',
      themeDark: '深色',
      themeHelp: '「跟隨系統」會自動配合手機的光暗模式設定；選淺色或深色則固定不變。',
      secLanguage: '語言',
      langHelp: '介面語言會立即切換，設定會記在此裝置。',
      secPay: '薪資設定',
      payDay: '日薪（1 工）',
      payHourly: '時薪（兼職）',
      payOt: '加班時薪',
      payNight: '半夜加班時薪',
      payHelp: '設定後，月曆下方會顯示本月收入總計（工數 × 日薪 ＋ 兼職時數 × 時薪 ＋ 加班時數 × 加班時薪 ＋ 半夜加班時數 × 半夜加班時薪）。留空或 0 則不顯示。',
      secDisplay: '顯示選項',
      optHoliday: '顯示香港公眾假期',
      optWeekend: '顯示週末',
      optHours: '月曆上顯示工數',
      optMonday: '週一為每週第一天',
      secLock: '螢幕鎖定',
      lockOn: '已啟用',
      lockOff: '未啟用',
      lockSet: '設定密碼',
      lockDisable: '關閉鎖定',
      lockHelp: '啟用後，每次開啟 App 或切回前台都需要輸入 4 位數字密碼。密碼以雜湊儲存，不會離開此裝置。',
      secData: '資料',
      exportCsv: '匯出 CSV（本月）',
      exportJson: '匯出備份 JSON',
      importJson: '匯入備份 JSON',
      clearAll: '清除全部資料',
      secCloud: '雲端備份（Cloudflare）',
      cfEndpointLabel: 'Worker 網址（可留空）',
      cfEndpointPh: '留空＝使用預設雲端',
      cfCodeLabel: '恢復碼（重裝找回資料用；留空＝自動生成）',
      cfCodePh: '留空自動生成',
      cfConnect: '連接雲端備份',
      cfConnecting: '連接中…',
      cfRestore: '從雲端還原',
      cfBackupNow: '立即備份',
      cfShowCode: '查看恢復碼',
      cfDisconnect: '斷開',
      cfDeleteCloud: '刪除雲端備份',
      cfCodeHint: '這組恢復碼是找回資料的唯一憑證，<b>請立即截圖保存</b>（傳給自己／存相簿）：',
      cfCodeHintSheet: '這組<b>恢復碼</b>是找回資料的唯一憑證，<b>請立即截圖保存</b>（傳給自己／存相簿）：',
      cfSaved: '已保存好',
      cfHelp: '連接後，每次修改會自動加密備份（伺服器只有密文）。<b>刪除 App 重裝後</b>：填回同一個 Worker 網址＋恢復碼即可自動找回資料。恢復碼務必截圖保管。',
      dataLocalHelp: '資料儲存在此裝置的瀏覽器中，離線可用。',
      secVersion: '版本',
      checkUpdate: '檢查更新',

      // 雲端備份橫幅／面板
      cfBannerText: '<b>雲端備份</b>　刪除 App 也不怕資料消失',
      cfBannerGo: '開啟／找回',
      cfAutoBackup: '自動備份',
      cfSheetTitle: '雲端備份',
      cfIntro1: '開啟後，每次修改都會<b>自動加密備份</b>到雲端（AES-GCM 端到端加密，伺服器只有密文，連站長也看不到內容）。',
      cfIntro2: '第一次使用 → 點<b>一鍵開啟</b>，會生成一組<b>恢復碼</b>，請截圖保存。',
      cfIntro3: '曾經開啟過（例如<b>刪除 App 後重裝</b>）→ 點<b>輸入恢復碼找回</b>，資料會自動回來，並<b>沿用原本的碼</b>，不需要新碼。',
      cfOneTap: '一鍵開啟自動備份',
      cfOpening: '開啟中…',
      cfHaveToggle: '我已有恢復碼，輸入找回',
      cfHaveGo: '用此碼找回並沿用',
      cfFinding: '找家中…',
      cfHaveAria: '恢復碼',
      cfDone: '已截圖保存，完成',

      // 更新橫幅
      updateTitle: '有新版本可用',
      updateDesc: '更新後即可使用最新功能',
      updateNow: '立即更新',
      updateLater: '稍後再說',

      // 鎖屏
      lockTitleUnlock: '輸入密碼',
      lockTitleSet: '設定新密碼',
      lockTitleConfirm: '再輸入一次確認',
      lockTitleOff: '關閉鎖定',
      lockPrompt4: '請輸入 4 位數字',
      lockPromptCurrent: '輸入目前密碼以確認',
      lockClear: '清除',
      lockBackspace: '刪除最後一位',
      lockWrong: '密碼錯誤，請重試',
      lockEnabled: '螢幕鎖定已啟用',
      lockDisabled: '螢幕鎖定已關閉',
      lockMismatch: '兩次輸入不一致，請重新設定',
      lockCooldown: '嘗試次數過多，{n} 秒後可再試',
      lockAria: '螢幕鎖定',

      // Toast
      toastSaved: '已儲存',
      toastCleared: '已清空此日記錄',
      toastDeleted: '已刪除記錄',
      toastBackToday: '已回到本月',
      toastStorageFull: '儲存失敗，瀏覽器空間可能已滿',
      toastExportedCsv: '已匯出 CSV',
      toastNoExport: '本月尚無記錄可匯出',
      toastExportedJson: '已匯出備份',
      toastImported: '已匯入 {n} 筆記錄',
      toastImportFail: '匯入失敗：檔案格式不正確',
      toastClearedAll: '已清除全部資料',
      toastLatest: '已是最新版本',
      toastUpdateLater: '已稍後提醒，可隨時在選單檢查更新',
      toastUpdateFound: '發現新版本，請點上方提示更新',
      toastUpdateSlow: '新版本下載中，完成後會自動提示',
      toastUpdateFail: '更新失敗，請稍後再試',
      toastCfScheme: 'Worker 網址必須是 https:// 開頭',
      toastCfRestored: '已從雲端找回資料',
      toastCfPushed: '已把本機資料備份到雲端',
      toastCfNoBackup: '這個碼在雲端沒有備份，將以本機資料開始',
      toastCfCreated: '已建立雲端備份',
      toastCfFail: '連接失敗：',
      toastCfNotConnected: '尚未連接雲端',
      toastCfBackedUp: '已備份到雲端',
      toastCfBackupFail: '備份失敗：',
      toastCfDisconnected: '已斷開雲端備份',
      toastCfDeleted: '已刪除雲端備份（本機資料不變）',
      toastCfDeleteFail: '刪除失敗：',
      toastCfOpenFail: '開啟失敗：',
      toastCfCodeInvalid: '請輸入 8 位恢復碼（格式 XXXX-XXXX）',
      toastCfCodeMissing: '雲端沒有這組恢復碼的備份，請確認有沒有打錯',
      toastCfRestoreFail: '還原失敗：',
      msgCfBadEndpoint: 'Worker 網址必須是 https://',
      msgCfPushFail: '備份失敗（{n}）',
      msgCfBadResponse: 'Worker 回應異常（{n}）',
      msgCfNoBackup: '雲端沒有這個碼的備份',
      msgCfBadFormat: '備份格式不符',
      msgCfWorkerOld: '雲端服務版本過舊，請先更新 Worker 再使用此功能',
      cfUnknownTime: '時間不明',
      cfStatusAt: '已連接・上次備份：{time}',
      cfStatusNever: '已連接・尚未備份過',

      // Confirm
      confirmDeleteEntry: '確定要刪除此日記錄嗎？',
      confirmCfConflict: '雲端已有這個碼的備份（{t}）。\n\n「確定」＝用雲端覆蓋本機\n「取消」＝把本機推上雲端',
      confirmCfConflictKeep: '雲端已有這個碼的備份（{t}）。\n\n「確定」＝用雲端覆蓋本機\n「取消」＝保留本機，把本機推上雲端',
      confirmCfRestore: '用雲端備份覆蓋本機資料？\n本機目前的記錄會被取代。',
      confirmCfDisconnect: '斷開雲端備份？\n本機資料不受影響，之後不再自動備份。\n（雲端備份會保留；若想一併移除，請先按「刪除雲端備份」）',
      confirmCfDelete: '確定刪除雲端上的這份備份？\n此動作無法復原，本機資料不受影響。',
      confirmImport: '將匯入 {n} 筆記錄，同名日期會被覆蓋。確定繼續？',
      confirmClearAll: '確定要清除全部工時記錄嗎？此操作無法復原。建議先匯出備份。',

      // 版本
      verBuildAt: '建置於 {time}',
      verChecking: '檢查中…',
      verFoundNow: '發現新版本，可立即更新',
      verFileMode: '單檔版不支援線上檢查更新',
      verOffline: '目前離線，無法檢查更新',
      verFound: '發現新版本 v{v}',
      verLatest: '已是最新版本',
      verUpdating: '更新中…',
      verSlow: '下載較慢…',
      updateBarNotes: 'v{v}：{notes}',
      updateBarVersion: '更新至 v{v}',
      updateBarDownloaded: '已下載新版本，點此套用',

      // 安裝提示
      installBefore: '此應用可安裝到主畫面：點右上角選單 → 安裝應用程式。',
      installDone: '已安裝到裝置，可離線使用。',
      installStandalone: '已以獨立應用模式執行，離線可用。',
      installIOS: 'iOS：點「分享」→「加入主畫面」即可安裝。',
      installGeneric: '可安裝為 App：瀏覽器選單 → 安裝／加到主畫面。',

      // CSV / 檔案
      csvWeekPrefix: '週',
      csvHeaders: ['日期', '星期', '工數(工)', '工時描述', '兼職(小時)', '加班(小時)', '加班描述',
        '半夜加班(小時)', '半夜加班描述', '標籤'],
      csvFilename: '工時月曆_{ym}.csv',
      jsonFilename: '工時月曆_備份_{date}.json',
    },

    en: {
      appName: 'Worktime Calendar',
      docTitle: 'Worktime Calendar — Work Hours & Overtime Tracker',
      metaDesc: 'Worktime Calendar — a free work-hours and overtime tracker (PWA). Log day units, part-time hours, overtime and late-night overtime on a calendar and let it total your monthly pay. Hong Kong public holidays, Chinese/English UI, dark mode, offline use; your records stay on your device.',

      aboutTitle: 'About Worktime Calendar',
      aboutIntro: 'Worktime Calendar is a free web app (PWA) that logs your daily work units, part-time hours, overtime and late-night overtime on a calendar, and totals your monthly pay from the day rate and hourly rates you set. Double-click any date to add a record. It shows Hong Kong public holidays, works in Chinese or English, supports dark mode and works offline; all records stay on your device and can be exported as CSV or JSON at any time.',
      aboutFaq: 'Frequently asked questions',
      aboutQ1: 'Do I need to install anything?',
      aboutA1: 'No. Just open it in a browser. To use it like an app, add it to your home screen — it then opens offline as well.',
      aboutQ2: 'Are my records uploaded to a server?',
      aboutA2: 'No. Records live in your browser on your device. If you turn on cloud backup, they are uploaded end-to-end encrypted and the server only holds ciphertext.',
      aboutQ3: 'How are overtime and pay calculated?',
      aboutA3: 'Overtime and late-night overtime are counted in 0.5-hour steps. Set your day rate, hourly rate, overtime rate and late-night rate under Pay settings, and the app totals both the month and each day for you.',
      aboutQ4: 'Does it include Hong Kong public holidays?',
      aboutA4: 'Yes — public holidays for 2025–2027 are built in, shown in red with the holiday name, and can be turned off in settings.',
      today: 'Today',
      monthNav: 'Month navigation',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      menu: 'More actions',
      calendar: 'Calendar',
      close: 'Close',
      drawerMenu: 'Menu',

      hintTouch: 'Tap a date to add or edit work, part-time, overtime or night records',
      hintMouse: 'Double-click a date to add or edit work, part-time, overtime or night records',

      sheetNew: 'New Record',
      sheetEdit: 'Edit Record',
      workSection: 'Work',
      partSection: 'Part-time Hours',
      otSection: 'Overtime',
      nightSection: 'Night Overtime',
      desc: 'Description',
      workUnits: 'Day Units',
      partHours: 'Part-time Hours',
      otHours: 'Overtime Hours',
      nightHours: 'Night Overtime Hours',
      chipPart: 'Part-time',
      chipPartSub: 'No day units',
      chipHalf: '0.5 unit',
      chipHalfSub: 'Half day',
      chipFull: '1 unit',
      chipFullSub: 'Full day',
      hourWord: 'hr',
      scrollHelp: 'Scroll to choose · paid at hourly rate',
      tagsLabel: 'Tags (optional)',
      tagsPlaceholder: 'Comma separated, e.g. trip, remote',
      delete: 'Delete',
      cancel: 'Cancel',
      save: 'Save',
      hkHolidayPrefix: 'HK public holiday · ',

      incomeLabel: 'Monthly Income',
      incomeShowAria: 'Monthly income total, tap to hide amounts',
      incomeHideAria: 'Monthly income total hidden, tap to show amounts',
      incomeHideTip: 'Tap to hide amounts',
      incomeShowTip: 'Tap to show amounts',
      incomeHideWord: 'Hide',
      incomeShowWord: 'Show',

      statWork: 'Days ',
      statPart: 'Part-time ',
      statOt: 'OT ',
      statNight: 'Night ',
      statDays: 'Records ',
      unitWork: 'd',
      unitDays: 'd',

      holPrefix: 'Public holiday: ',
      cellWork: 'Work',
      cellPart: 'Part-time',
      cellOt: 'Overtime',
      cellNight: 'Night overtime',
      cellNoRecord: 'No record',
      cellIncome: 'Daily income',

      secAppearance: 'Appearance',
      themeGroup: 'Theme',
      themeAuto: 'System',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeHelp: '“System” follows your phone’s light/dark setting; Light or Dark stays fixed.',
      secLanguage: 'Language',
      langHelp: 'The interface switches instantly. The choice is saved on this device.',
      secPay: 'Pay Settings',
      payDay: 'Daily rate (1 unit)',
      payHourly: 'Hourly rate (part-time)',
      payOt: 'Overtime hourly rate',
      payNight: 'Night overtime hourly rate',
      payHelp: 'Once set, the monthly income total appears below the calendar (day units × daily rate + part-time hours × hourly rate + overtime hours × overtime rate + night hours × night rate). Leave blank or 0 to hide.',
      secDisplay: 'Display Options',
      optHoliday: 'Show Hong Kong public holidays',
      optWeekend: 'Show weekends',
      optHours: 'Show day units on calendar',
      optMonday: 'Start week on Monday',
      secLock: 'Screen Lock',
      lockOn: 'Enabled',
      lockOff: 'Not enabled',
      lockSet: 'Set Passcode',
      lockDisable: 'Turn Off Lock',
      lockHelp: 'Once enabled, you must enter a 4-digit passcode each time you open the app or return to it. The passcode is stored only as a hash and never leaves this device.',
      secData: 'Data',
      exportCsv: 'Export CSV (this month)',
      exportJson: 'Export Backup JSON',
      importJson: 'Import Backup JSON',
      clearAll: 'Clear All Data',
      secCloud: 'Cloud Backup (Cloudflare)',
      cfEndpointLabel: 'Worker URL (optional)',
      cfEndpointPh: 'Blank = use default cloud',
      cfCodeLabel: 'Recovery code (for restoring after reinstall; blank = auto-generate)',
      cfCodePh: 'Blank = auto-generate',
      cfConnect: 'Connect Cloud Backup',
      cfConnecting: 'Connecting…',
      cfRestore: 'Restore from Cloud',
      cfBackupNow: 'Back Up Now',
      cfShowCode: 'View Recovery Code',
      cfDisconnect: 'Disconnect',
      cfDeleteCloud: 'Delete Cloud Backup',
      cfCodeHint: 'This recovery code is the only proof of ownership, <b>screenshot it now</b> (send it to yourself / keep it in Photos):',
      cfCodeHintSheet: 'This <b>recovery code</b> is the only proof of ownership, <b>screenshot it now</b> (send it to yourself / keep it in Photos):',
      cfSaved: 'Saved',
      cfHelp: 'Once connected, every change is encrypted and backed up automatically (the server only holds ciphertext). <b>After reinstalling the app</b>, enter the same Worker URL and recovery code to restore everything. Always keep a screenshot of the code.',
      dataLocalHelp: 'Data is stored in this device’s browser and works offline.',
      secVersion: 'Version',
      checkUpdate: 'Check for Updates',

      cfBannerText: '<b>Cloud backup</b>　Keep your data safe',
      cfBannerGo: 'Set up',
      cfAutoBackup: 'Auto backup',
      cfSheetTitle: 'Cloud Backup',
      cfIntro1: 'Once enabled, every change is <b>encrypted and backed up</b> automatically (AES-GCM end-to-end encryption — the server only holds ciphertext and even the developer cannot read it).',
      cfIntro2: 'First time → tap <b>Enable</b>. A <b>recovery code</b> is generated — screenshot it.',
      cfIntro3: 'Used before (e.g. <b>after reinstalling the app</b>) → tap <b>Enter recovery code</b>. Your data comes back and <b>keeps the same code</b> — no new code needed.',
      cfOneTap: 'Enable Auto Backup',
      cfOpening: 'Enabling…',
      cfHaveToggle: 'I already have a recovery code',
      cfHaveGo: 'Restore with this code',
      cfFinding: 'Searching…',
      cfHaveAria: 'Recovery code',
      cfDone: 'Saved, done',

      updateTitle: 'New version available',
      updateDesc: 'Update to get the latest features',
      updateNow: 'Update Now',
      updateLater: 'Later',

      lockTitleUnlock: 'Enter Passcode',
      lockTitleSet: 'Set New Passcode',
      lockTitleConfirm: 'Enter Again to Confirm',
      lockTitleOff: 'Turn Off Lock',
      lockPrompt4: 'Enter 4 digits',
      lockPromptCurrent: 'Enter current passcode to confirm',
      lockClear: 'Clear',
      lockBackspace: 'Delete last digit',
      lockWrong: 'Wrong passcode, try again',
      lockEnabled: 'Screen lock enabled',
      lockDisabled: 'Screen lock turned off',
      lockMismatch: 'The two entries differ, please set again',
      lockCooldown: 'Too many attempts, try again in {n}s',
      lockAria: 'Screen lock',

      toastSaved: 'Saved',
      toastCleared: 'Record cleared for this day',
      toastDeleted: 'Record deleted',
      toastBackToday: 'Back to this month',
      toastStorageFull: 'Save failed — browser storage may be full',
      toastExportedCsv: 'CSV exported',
      toastNoExport: 'No records this month to export',
      toastExportedJson: 'Backup exported',
      toastImported: 'Imported {n} records',
      toastImportFail: 'Import failed: invalid file format',
      toastClearedAll: 'All data cleared',
      toastLatest: 'You are on the latest version',
      toastUpdateLater: 'Reminder dismissed — check for updates anytime in the menu',
      toastUpdateFound: 'New version found, tap the banner above to update',
      toastUpdateSlow: 'Downloading the new version — you will be notified when it is ready',
      toastUpdateFail: 'Update failed, please try again later',
      toastCfScheme: 'Worker URL must start with https://',
      toastCfRestored: 'Data restored from the cloud',
      toastCfPushed: 'Local data backed up to the cloud',
      toastCfNoBackup: 'No cloud backup for this code — starting with your local data',
      toastCfCreated: 'Cloud backup created',
      toastCfFail: 'Connection failed: ',
      toastCfNotConnected: 'Not connected to the cloud',
      toastCfBackedUp: 'Backed up to the cloud',
      toastCfBackupFail: 'Backup failed: ',
      toastCfDisconnected: 'Cloud backup disconnected',
      toastCfDeleted: 'Cloud backup deleted (local data unchanged)',
      toastCfDeleteFail: 'Delete failed: ',
      toastCfOpenFail: 'Could not enable: ',
      toastCfCodeInvalid: 'Enter an 8-character recovery code (XXXX-XXXX)',
      toastCfCodeMissing: 'No cloud backup for this code — please check for typos',
      toastCfRestoreFail: 'Restore failed: ',
      msgCfBadEndpoint: 'Worker URL must start with https://',
      msgCfPushFail: 'Backup failed ({n})',
      msgCfBadResponse: 'Unexpected worker response ({n})',
      msgCfNoBackup: 'No cloud backup for this code',
      msgCfBadFormat: 'Backup format is invalid',
      msgCfWorkerOld: 'Cloud service is outdated — update the Worker before using this',
      cfUnknownTime: 'unknown time',
      cfStatusAt: 'Connected · last backup: {time}',
      cfStatusNever: 'Connected · no backup yet',

      confirmDeleteEntry: 'Delete this day’s record?',
      confirmCfConflict: 'A cloud backup for this code already exists ({t}).\n\nOK = overwrite this device with the cloud copy\nCancel = push this device to the cloud',
      confirmCfConflictKeep: 'A cloud backup for this code already exists ({t}).\n\nOK = overwrite this device with the cloud copy\nCancel = keep this device and push it to the cloud',
      confirmCfRestore: 'Overwrite this device with the cloud backup?\nYour current records will be replaced.',
      confirmCfDisconnect: 'Disconnect cloud backup?\nYour local data is unaffected; auto backup will stop.\n(The cloud copy is kept — tap "Delete Cloud Backup" first if you want it removed)',
      confirmCfDelete: 'Delete this backup from the cloud?\nThis cannot be undone. Data on this device is not affected.',
      confirmImport: 'Import {n} records? Existing dates with the same name will be overwritten.',
      confirmClearAll: 'Clear all work records? This cannot be undone. Export a backup first.',

      verBuildAt: 'Built {time}',
      verChecking: 'Checking…',
      verFoundNow: 'New version found — update now',
      verFileMode: 'Update check is unavailable in single-file mode',
      verOffline: 'Offline — cannot check for updates',
      verFound: 'New version v{v} found',
      verLatest: 'You are on the latest version',
      verUpdating: 'Updating…',
      verSlow: 'Still downloading…',
      updateBarNotes: 'v{v}: {notes}',
      updateBarVersion: 'Update to v{v}',
      updateBarDownloaded: 'New version downloaded, tap to apply',

      installBefore: 'This app can be installed: open the browser menu → Install app.',
      installDone: 'Installed on this device and available offline.',
      installStandalone: 'Running as a standalone app — available offline.',
      installIOS: 'iOS: tap Share → Add to Home Screen to install.',
      installGeneric: 'Install as an app: browser menu → Install / Add to Home Screen.',

      csvWeekPrefix: '',
      csvHeaders: ['Date', 'Day', 'Day Units', 'Work Description', 'Part-time (h)', 'Overtime (h)', 'Overtime Description',
        'Night OT (h)', 'Night OT Description', 'Tags'],
      csvFilename: 'worktime-calendar_{ym}.csv',
      jsonFilename: 'worktime-calendar_backup_{date}.json',
    },
  };

  /* 香港公眾假期名稱（中英對照）。HK_HOLIDAYS 只存鍵，顯示時才取名。 */
  const HOLIDAY_NAMES = {
    zh: {
      newYear: '一月一日',
      lunarNewYear1: '農曆年初一',
      lunarNewYear2: '農曆年初二',
      lunarNewYear3: '農曆年初三',
      lunarNewYear4: '農曆年初四',
      chingMing: '清明節',
      chingMingNext: '清明節翌日',
      goodFriday: '耶穌受難節',
      goodFridayNext: '耶穌受難節翌日',
      easterMonday: '復活節星期一',
      easterMondayNext: '復活節星期一翌日',
      labourDay: '勞動節',
      buddha: '佛誕',
      buddhaNext: '佛誕翌日',
      tsuenWan: '端午節',
      hksar: '香港特別行政區成立紀念日',
      nationalDay: '國慶日',
      midAutumnNext: '中秋節翌日',
      chungYeung: '重陽節',
      chungYeungNext: '重陽節翌日',
      christmas: '聖誕節',
      boxingDay: '聖誕節後第一個周日',
    },
    en: {
      newYear: 'New Year’s Day',
      lunarNewYear1: 'Lunar New Year’s Day',
      lunarNewYear2: 'The second day of Lunar New Year',
      lunarNewYear3: 'The third day of Lunar New Year',
      lunarNewYear4: 'The fourth day of Lunar New Year',
      chingMing: 'Ching Ming Festival',
      chingMingNext: 'The day following Ching Ming Festival',
      goodFriday: 'Good Friday',
      goodFridayNext: 'The day following Good Friday',
      easterMonday: 'Easter Monday',
      easterMondayNext: 'The day following Easter Monday',
      labourDay: 'Labour Day',
      buddha: 'The Birthday of the Buddha',
      buddhaNext: 'The day following the Birthday of the Buddha',
      tsuenWan: 'Tuen Ng Festival',
      hksar: 'Hong Kong Special Administrative Region Establishment Day',
      nationalDay: 'National Day',
      midAutumnNext: 'The day following the Chinese Mid-Autumn Festival',
      chungYeung: 'Chung Yeung Festival',
      chungYeungNext: 'The day following Chung Yeung Festival',
      christmas: 'Christmas Day',
      boxingDay: 'The first weekday after Christmas Day',
    },
  };

  /* 英文假期名有兩套：
     - HOLIDAY_NAMES.en  → 完整官方名稱，用於面板與 aria-label（唸出來要正確）
     - HOLIDAY_SHORT_EN  → 格子內短名，10px 小字塞不進 30 幾個字母
       兩者沒有短版的（例如 National Day）就沿用長名。 */
  const HOLIDAY_SHORT_EN = {
    nationalDay: 'National Day',
    christmas: 'Christmas',
    boxingDay: 'Boxing Day',
    hksar: 'HKSAR Day',
    newYear: 'New Year',
    lunarNewYear1: 'LNY Day 1',
    lunarNewYear2: 'LNY Day 2',
    lunarNewYear3: 'LNY Day 3',
    lunarNewYear4: 'LNY Day 4',
    chingMing: 'Ching Ming',
    chingMingNext: 'Ching Ming +1',
    goodFriday: 'Good Friday',
    goodFridayNext: 'Good Friday +1',
    easterMonday: 'Easter Mon',
    easterMondayNext: 'Easter Mon +1',
    labourDay: 'Labour Day',
    buddha: 'Buddha’s Birthday',
    buddhaNext: 'Buddha’s Birthday +1',
    tsuenWan: 'Tuen Ng',
    midAutumnNext: 'Mid-Autumn +1',
    chungYeung: 'Chung Yeung',
    chungYeungNext: 'Chung Yeung +1',
  };

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_EN_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  /* ---------------- 語言（i18n）執行環境 ----------------
     lang 為目前語言；t(key, vars) 取詞並代換 {name} 變數（{n}／{t}／{v}／{notes}）。
     缺鍵一律回退繁中、再回退鍵名本身，避免任何一處漏翻就整句空白。 */
  let lang = DEFAULTS.lang;

  function normalizeLang(v) {
    return LANGS.includes(v) ? v : DEFAULTS.lang;
  }

  function t(key, vars) {
    let s = I18N[lang] && I18N[lang][key];
    if (s === undefined) s = I18N[DEFAULTS.lang][key];
    if (s === undefined) return key;
    if (Array.isArray(s)) return s;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, (m, name) => (
        vars[name] === undefined || vars[name] === null ? m : String(vars[name])
      ));
    }
    return s;
  }

  /* 日期格式依語言：zh-Hant → 2026 年 9 月 28 日（週一）；en → September 28, 2026 (Mon) */
  const localeTag = () => (lang === 'en' ? 'en-US' : 'zh-TW');

  const fmtDateLabel = (d) => (lang === 'en'
    ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} (${WEEK_EN[d.getDay()]})`
    : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${WEEK_DOW[d.getDay()]}）`);

  /* 月份標題：zh-Hant → 2026 年 9 月；en → September 2026 */
  const fmtMonthTitle = (y, m) => (lang === 'en' ? `${MONTHS_EN[m]} ${y}` : `${y} 年 ${m + 1} 月`);

  /* 星期表頭：zh-Hant 用中文單字，en 用單字母（維持表頭寬度） */
  const weekdayLabel = (i) => (lang === 'en' ? WEEK_EN_MIN[i] : WEEK_DOW[i]);

  /* CSV 的星期欄：zh-Hant「週一」；en「Monday」 */
  const csvWeekday = (i) => (lang === 'en' ? WEEK_EN_FULL[i] : t('csvWeekPrefix') + WEEK_DOW[i]);

  /* 假期名稱：HK_HOLIDAYS 存鍵，這裡依語言取名。
     short=true 時英文改用短名（格子內小字版面用）。 */
  function holidayName(k, short) {
    const key = HK_HOLIDAYS[k];
    if (!key) return null;
    if (lang === 'en') {
      if (short && HOLIDAY_SHORT_EN[key]) return HOLIDAY_SHORT_EN[key];
      return HOLIDAY_NAMES.en[key] || key;
    }
    return HOLIDAY_NAMES.zh[key] || key;
  }

  // 金額顯示：千分位 + 最多兩位小數（有需要才顯示小數）
  const fmtMoney = (n) => {
    const v = Math.round(n * 100) / 100;
    const hasFrac = Math.abs(v % 1) > 0.0001;
    return v.toLocaleString(localeTag(), {
      minimumFractionDigits: hasFrac ? 2 : 0,
      maximumFractionDigits: 2,
    });
  };

  // 工數僅提供 0.5 工（半日）與 1 工（全日）兩個選擇
  const WORK_CHOICES = [0.5, 1];

  const WEEK_DOW = ['日', '一', '二', '三', '四', '五', '六'];
  const WEEK_EN_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
      toast(t('toastStorageFull'));
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
    const theme = settings.theme === 'light' || settings.theme === 'dark'
      ? settings.theme
      : (themeMql && themeMql.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[theme]);
    return theme;
  }

  function syncThemeSeg() {
    if (!el.themeSeg) return;
    const cur = settings.theme || 'auto';
    el.themeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.themeOpt || 'auto') === cur);
    });
  }

  /* ---------------- 語言切換 ----------------
     靜態文案在 index.html 以 data-i18n / data-i18n-ph / data-i18n-aria 標記；
     這裡一次套用。「語言」分段控制本身不翻譯（永遠顯示中文／English），
     但 aria-label 與說明文字要跟著走。 */
  function syncLangSeg() {
    if (!el.langSeg) return;
    el.langSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.langOpt || '') === lang);
    });
  }

  function applyStaticText() {
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const v = t(node.dataset.i18n);
      if (typeof v === 'string') node.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
      node.setAttribute('placeholder', t(node.dataset.i18nPh));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-content]').forEach((node) => {
      node.setAttribute('content', t(node.dataset.i18nContent));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.setAttribute('title', t(node.dataset.i18nTitle));
    });
  }

  function applyLang() {
    lang = normalizeLang(settings.lang);
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-Hant');
    // 瀏覽器／iOS 加入主畫面時會讀 title 與這些 meta
    // 分頁標題用 docTitle（帶關鍵字，方便搜尋引擎理解），
    // 加到主畫面的名稱仍用 appName（短，圖示下面放得落）。
    document.title = t('docTitle');
    const setMeta = (sel, attr, value) => {
      const m = document.head.querySelector(sel);
      if (m) m.setAttribute(attr, value);
    };
    setMeta('meta[name="apple-mobile-web-app-title"]', 'content', t('appName'));

    applyStaticText();
    syncLangSeg();
    syncThemeSeg();
    syncLockUI();
    syncCfUI();
    renderVersionInfo();
    updateHintText();
    setupInstallHint();
    render();
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
    langSeg: $('langSeg'),
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
    cfDeleteCloud: $('cfDeleteCloud'),
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

  /* 單日收入：與 incomeOfMonth 同一套費率逐項計算。
     沒有任何費率、或該日完全沒有可計價時數 → 回 null（格子不顯示）。 */
  function incomeOfDay(e) {
    if (!e) return null;
    const dayPay = num(settings.dayPay);
    const hourlyPay = num(settings.hourlyPay);
    const otPay = num(settings.otPay);
    const nightPay = num(settings.nightPay);
    if (dayPay <= 0 && hourlyPay <= 0 && otPay <= 0 && nightPay <= 0) return null;

    const wu = num(e.workUnits);
    const ph = num(e.partHours);
    const oh = num(e.otHours);
    const nh = num(e.nightHours);
    const total = wu * dayPay + ph * hourlyPay + oh * otPay + nh * nightPay;
    if (total <= 0) return null;
    return total;
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
  const CF_ITER = 600000;      // PBKDF2 迭代數（OWASP 對 PBKDF2-HMAC-SHA256 的建議值）

  /* 憑證三件組（v2）：
       tok      由恢復碼派生，送雲端「定位與讀取」用，反推恢復碼的成本極高
       wk       隨機寫入金鑰，只有持有它才能覆寫／刪除（tok 外洩也不會被毀）
       加密金鑰 由恢復碼＋隨機鹽派生，永遠不出裝置，雲端只有密文
     舊版（v1）只有一把由恢復碼直接 SHA-256 出來的金鑰，恢復碼還會出現在 URL，
     雲端因此有能力解密；v2 就是要拆開這兩件事。 */
  const deriveCache = new Map();
  // null=尚未探測 / true=Worker 支援 v2 / false=舊 Worker（自動降級走 v1）
  let cfWorkerV2 = null;

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

  /* ---------- v1 加密（舊格式，只為了讀回舊備份做遷移） ---------- */
  async function cfKeyV1(code, endpoint) {
    const raw = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${CF_APP}|${code}|${endpoint}`)
    );
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function cfEncryptV1(state, code, endpoint) {
    const key = await cfKeyV1(code, endpoint);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(state))
    );
    return { iv: cfB64(iv), data: cfB64(new Uint8Array(ct)) };
  }

  async function cfDecryptV1(enc, code, endpoint) {
    const key = await cfKeyV1(code, endpoint);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: cfUnb64(enc.iv) },
      key,
      cfUnb64(enc.data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ---------- v2 派生 ---------- */
  function cfB64u(bytes) {
    return cfB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** PBKDF2 派生，結果暫存（600k 迭代不算便宜，別每次備份都重算） */
  async function cfDerive(code, saltBytes, iter) {
    const key = `${code}|${cfB64(saltBytes)}|${iter}`;
    if (deriveCache.has(key)) return deriveCache.get(key);
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']
    );
    const p = crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' },
      base, 256
    );
    deriveCache.set(key, p);
    return p;
  }

  /** 送雲端的定位憑證：由恢復碼派生，但與加密金鑰是不同的輸出 */
  async function cfAuthTok() {
    const endpoint = cfNorm(settings.cfEndpoint);
    const bits = await cfDerive(
      settings.cfCode,
      new TextEncoder().encode(`wtc-auth|${endpoint}`),
      CF_ITER
    );
    return cfB64u(new Uint8Array(await bits));
  }

  /** 本地加密金鑰：恢復碼＋隨機鹽，鹽隨備份明碼存放（鹽不需要保密） */
  async function cfEncKey(saltB64) {
    const bits = await cfDerive(
      settings.cfCode,
      new Uint8Array(cfUnb64(saltB64)),
      CF_ITER
    );
    return crypto.subtle.importKey('raw', await bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  /** 首次啟用時產生鹽與寫入金鑰（之後固定沿用，鹽會隨備份一起上雲以便跨裝置還原） */
  function ensureCfSecrets() {
    if (!settings.cfSalt) {
      settings.cfSalt = cfB64(crypto.getRandomValues(new Uint8Array(16)));
    }
    if (!settings.cfWriteKey) {
      settings.cfWriteKey = cfB64(crypto.getRandomValues(new Uint8Array(32)));
    }
  }

  async function cfEncryptV2(state, saltB64) {
    const key = await cfEncKey(saltB64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(state))
    );
    return { iv: cfB64(iv), data: cfB64(new Uint8Array(ct)) };
  }

  async function cfDecryptV2(enc, saltB64) {
    const key = await cfEncKey(saltB64);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: cfUnb64(enc.iv) },
      key,
      cfUnb64(enc.data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // 備份內容＝全部打卡記錄＋全部設定；連接資訊、鹽、寫入金鑰與 PIN 不上雲
  // （寫入金鑰改放在頂層 wk：它只存在於加密內容裡，雲端仍看不到，
  //   但換裝置還原時才拿得回來，否則那台裝置永遠不能覆寫）
  function cfBackupPayload() {
    return {
      entries,
      settings: {
        ...settings,
        cfEndpoint: '', cfCode: '', cfAt: '', cfHash: '',
        cfSalt: '', cfWriteKey: '', pinHash: '',
      },
      wk: settings.cfWriteKey,
    };
  }

  function cfHashOfState() {
    const s = { ...settings };
    delete s.cfEndpoint; delete s.cfCode; delete s.cfAt; delete s.cfHash; delete s.pinHash;
    delete s.cfSalt; delete s.cfWriteKey; delete s.cfV2;
    const str = JSON.stringify({ entries, s });
    // FNV-1a 32 位：夠用於「內容有沒有變」的判斷
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return String(h);
  }

  /* v2：單一端點、憑證全放 body（不進 URL、不進存取日誌） */
  async function cfApiPost(body) {
    const ep = cfNorm(settings.cfEndpoint);
    const res = await fetch(`${ep}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j = null;
    try { j = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
    // 405＝舊版 Worker（不認得 POST）→ 記下來，之後自動降級走 v1
    if (res.status === 405) cfWorkerV2 = false;
    else if (res.status !== 429) cfWorkerV2 = true;
    return { status: res.status, ok: res.ok, json: j };
  }

  /* v1：舊 Worker 用的 GET/PUT（恢復碼在 URL 上，僅相容期使用） */
  async function cfApiLegacy(method, body) {
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

  /** 抓雲端備份：先問 v2；若本機還沒遷移到新格式，再回頭翻 v1 的舊備份 */
  async function cfFetchBackup() {
    let r = null;
    if (cfWorkerV2 !== false) {
      r = await cfApiPost({ op: 'get', tok: await cfAuthTok() });
      if (r.status === 200 && r.json && r.json.found) return r;
      if (r.status === 404 || r.status === 200) cfWorkerV2 = true;
    }
    // 還沒用新格式備份過 → 舊備份可能還在 v1 key 底下
    if (!settings.cfV2) {
      const legacy = await cfApiLegacy('GET');
      if (legacy.status === 200 && legacy.json && legacy.json.found) return legacy;
      if (cfWorkerV2 === false) return legacy;
    }
    return r || { status: 404, ok: false, json: { found: false } };
  }

  async function cfPush() {
    const endpoint = cfNorm(settings.cfEndpoint);
    if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.|localhost)/.test(endpoint)) {
      throw new Error(t('msgCfBadEndpoint'));
    }
    ensureCfSecrets();
    const payload = cfBackupPayload();
    let r;
    if (cfWorkerV2 !== false) {
      const enc = await cfEncryptV2(payload, settings.cfSalt);
      r = await cfApiPost({
        op: 'put', tok: await cfAuthTok(), wk: settings.cfWriteKey,
        app: CF_APP, v: 2, savedAt: new Date().toISOString(),
        kdf: { salt: settings.cfSalt, iter: CF_ITER },
        enc,
      });
      if (r.status === 405) {
        // 舊 Worker：改用 v1 格式再推一次
        const enc1 = await cfEncryptV1(payload, settings.cfCode, endpoint);
        r = await cfApiLegacy('PUT', { app: CF_APP, v: 1, savedAt: new Date().toISOString(), enc: enc1 });
      } else {
        settings.cfV2 = true;   // 已是新格式：之後不必再回頭查舊備份
      }
    } else {
      const enc1 = await cfEncryptV1(payload, settings.cfCode, endpoint);
      r = await cfApiLegacy('PUT', { app: CF_APP, v: 1, savedAt: new Date().toISOString(), enc: enc1 });
    }
    if (!r.ok) throw new Error(t('msgCfPushFail', { n: r.status }));
    settings.cfAt = new Date().toISOString();
    settings.cfHash = cfHashOfState();
    saveSettings();
  }

  /** 刪除雲端備份（需寫入金鑰；本機資料不動） */
  async function cfDeleteCloud() {
    const endpoint = cfNorm(settings.cfEndpoint);
    if (!settings.cfEndpoint || !settings.cfCode) { toast(t('toastCfNotConnected')); return; }
    if (!confirm(t('confirmCfDelete'))) return;
    if (!settings.cfWriteKey) { toast(t('msgCfWorkerOld')); return; }
    el.cfDeleteCloud.disabled = true;
    try {
      const r = await cfApiPost({ op: 'delete', tok: await cfAuthTok(), wk: settings.cfWriteKey });
      if (r.status === 405) { toast(t('msgCfWorkerOld')); return; }
      if (!r.ok) throw new Error(t('toastCfDeleteFail') + r.status);
      settings.cfAt = '';
      settings.cfHash = '';
      saveSettings();
      syncCfUI();
      toast(t('toastCfDeleted'));
    } catch (e) {
      console.error(e);
      toast(t('toastCfDeleteFail') + String(e.message || e).slice(0, 80));
    } finally {
      el.cfDeleteCloud.disabled = false;
    }
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
      const lastAt = settings.cfAt ? new Date(settings.cfAt) : null;
      el.cfStatus.textContent = lastAt
        ? t('cfStatusAt', { time: lastAt.toLocaleString(localeTag()) })
        : t('cfStatusNever');
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
      toast(t('toastCfScheme'));
      el.cfEndpoint.focus();
      return;
    }
    const typed = el.cfCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isNew = !typed;
    const code = isNew ? genRecoveryCode() : typed;

    el.cfConnect.disabled = true;
    el.cfConnect.textContent = t('cfConnecting');
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = endpoint;
      settings.cfCode = code;
      const r = await cfFetchBackup();
      if (r.status === 200 && r.json && r.json.found) {
        if (Object.keys(entries).length) {
          const cloudAt = r.json.data && r.json.data.savedAt
            ? new Date(r.json.data.savedAt).toLocaleString(localeTag()) : t('cfUnknownTime');
          const useCloud = confirm(t('confirmCfConflict', { t: cloudAt }));
          if (useCloud) {
            await cfRestore(true);
            toast(t('toastCfRestored'));
          } else {
            await cfPush();
            toast(t('toastCfPushed'));
          }
        } else {
          await cfRestore(true);   // 本機是空的：直接還原
          toast(t('toastCfRestored'));
        }
      } else if (r.status === 404) {
        if (!isNew) toast(t('toastCfNoBackup'));
        await cfPush();
        toast(t('toastCfCreated'));
      } else {
        throw new Error(t('msgCfBadResponse', { n: r.status }));
      }
      saveSettings();
      syncCfUI();
      el.cfCodeInput.value = '';
      if (isNew) showCfCode(true);   // 新碼：立即大字展示引導截圖
    } catch (e) {
      console.error(e);
      toast(t('toastCfFail') + String(e.message || e).slice(0, 80));
      settings.cfEndpoint = prev.ep;
      settings.cfCode = prev.code;
      saveSettings();
      syncCfUI();
    } finally {
      el.cfConnect.disabled = false;
      el.cfConnect.textContent = t('cfConnect');
    }
  }

  async function cfRestore(silent) {
    if (!settings.cfEndpoint || !settings.cfCode) { toast(t('toastCfNotConnected')); return; }
    if (!silent && !confirm(t('confirmCfRestore'))) return;
    const r = await cfFetchBackup();
    if (r.status !== 200 || !r.json || !r.json.found) {
      throw new Error(t('msgCfNoBackup'));
    }
    const endpoint = cfNorm(settings.cfEndpoint);
    const data = r.json.data;
    // 有 kdf 就是 v2（PBKDF2＋隨機鹽），沒有就是 v1 舊密文
    const isV2 = !!(data && data.kdf && data.kdf.salt);
    const state = isV2
      ? await cfDecryptV2(data.enc, data.kdf.salt)
      : await cfDecryptV1(data.enc, settings.cfCode, endpoint);
    if (!state || !state.entries) throw new Error(t('msgCfBadFormat'));
    entries = migrate(state.entries).data;   // migrate 回傳 { data, converted }
    if (state.settings) {
      // 連接資訊與 PIN 留本機現值，其餘設定以備份為準
      const keep = {
        cfEndpoint: settings.cfEndpoint, cfCode: settings.cfCode,
        cfAt: settings.cfAt, cfHash: settings.cfHash, pinHash: settings.pinHash,
      };
      settings = { ...DEFAULTS, ...state.settings, ...keep };
      // 寫入金鑰藏在加密內容裡：換裝置還原後才還能覆寫／刪除雲端備份
      if (state.wk) settings.cfWriteKey = state.wk;
    }
    // 鹽是明碼隨備份走的（鹽不需要保密）：沿用同一組，之後備份就不用換鹽
    if (isV2 && data.kdf && data.kdf.salt) settings.cfSalt = data.kdf.salt;
    ensureCfSecrets();
    // 讀到舊格式：立刻用新格式重推一次，完成遷移（舊資料仍留著，不會不見）
    if (!isV2) {
      try {
        ensureCfSecrets();
        await cfPush();
      } catch (e) { console.warn('[備份] 升級為新格式失敗', e); }
    }
    settings.cfHash = cfHashOfState();  // 剛還原的內容＝雲端內容，避免立刻重推
    save(); saveSettings();
    view = new Date(); view.setDate(1);
    render(); updateHintText();
    syncCfUI();
  }

  async function cfBackupNow() {
    if (!settings.cfEndpoint || !settings.cfCode) { toast(t('toastCfNotConnected')); return; }
    el.cfBackupNow.disabled = true;
    try {
      await cfPush();
      syncCfUI();
      toast(t('toastCfBackedUp'));
    } catch (e) {
      console.error(e);
      toast(t('toastCfBackupFail') + String(e.message || e).slice(0, 80));
    } finally {
      el.cfBackupNow.disabled = false;
    }
  }

  function disconnectCf() {
    if (!confirm(t('confirmCfDisconnect'))) return;
    settings.cfEndpoint = '';
    settings.cfCode = '';
    settings.cfAt = '';
    settings.cfHash = '';
    saveSettings();
    syncCfUI();
    syncCfBanner();
    toast(t('toastCfDisconnected'));
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
    el.cfSheetOpen.textContent = t('cfOpening');
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = cfNorm(settings.cfEndpoint) || CF_DEFAULT_ENDPOINT;
      settings.cfCode = genRecoveryCode();
      // 撞碼（機率約 10^-11）就換一碼重試一次
      let r = await cfFetchBackup();
      if (r.status === 200 && r.json && r.json.found) {
        settings.cfCode = genRecoveryCode();
        await cfFetchBackup();
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
      toast(t('toastCfOpenFail') + String(e.message || e).slice(0, 80));
    } finally {
      el.cfSheetOpen.disabled = false;
      el.cfSheetOpen.textContent = t('cfOneTap');
    }
  }

  /* 重裝找回：輸入已有的恢復碼 → 雲端有備份就還原並沿用此碼；
     沒有就報錯回滾，絕不悄悄換新碼。 */
  async function restoreByCode() {
    const code = (el.cfSheetHaveInput.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) {
      toast(t('toastCfCodeInvalid'));
      el.cfSheetHaveInput.focus();
      return;
    }
    el.cfSheetHaveGo.disabled = true;
    el.cfSheetHaveGo.textContent = t('cfFinding');
    const prev = { ep: settings.cfEndpoint, code: settings.cfCode };
    try {
      settings.cfEndpoint = cfNorm(settings.cfEndpoint) || CF_DEFAULT_ENDPOINT;
      settings.cfCode = code;
      const r = await cfFetchBackup();
      if (r.status === 200 && r.json && r.json.found) {
        if (Object.keys(entries).length) {
          // 本機已有資料：沿用 connectCf 的衝突選擇
          const cloudAt = r.json.data && r.json.data.savedAt
            ? new Date(r.json.data.savedAt).toLocaleString(localeTag()) : t('cfUnknownTime');
          const useCloud = confirm(t('confirmCfConflictKeep', { t: cloudAt }));
          if (useCloud) {
            await cfRestore(true);
            toast(t('toastCfRestored'));
          } else {
            await cfPush();
            toast(t('toastCfPushed'));
          }
        } else {
          await cfRestore(true);   // 本機是空的（剛重裝）：直接還原
          toast(t('toastCfRestored'));
        }
      } else if (r.status === 404) {
        throw new Error(t('toastCfCodeMissing'));
      } else {
        throw new Error(t('msgCfBadResponse', { n: r.status }));
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
      el.cfSheetHaveGo.textContent = t('cfHaveGo');
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

  /* ---------------- 觸覺回饋（震動） ----------------
     Android：navigator.vibrate（支援長短 pattern）。
     iOS：Safari 至今不提供 Vibration API，但 iOS 18.0+ 的 WebKit 會對
     <input type="checkbox" switch>（原生開關）的互動產生系統觸覺——
     放一個隱形 switch＋label，由 label.click() 間接翻轉即可觸發
     （必須經 label 轉發；用 script 直接 click input 不會震）。
     兩者都不可用時靜默略過，不影響任何功能。 */
  let hapticLabel = null;
  function haptic(pattern) {
    try {
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      } else {
        if (!hapticLabel) {
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.id = 'haptic-switch';
          input.setAttribute('switch', '');
          input.style.display = 'none';
          const label = document.createElement('label');
          label.htmlFor = 'haptic-switch';
          label.style.display = 'none';
          document.body.appendChild(input);
          document.body.appendChild(label);
          hapticLabel = label;
        }
        hapticLabel.click();
      }
    } catch (e) { /* 不支援的環境靜默略過 */ }
  }
  const HAPTIC_TAP = 12;            // 按鍵：輕點一下
  const HAPTIC_OK = [28, 45, 28];   // 成功：兩短
  const HAPTIC_ERR = [55, 45, 55];  // 錯誤：兩重

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
    if (mode === 'unlock') { el.lockTitle.textContent = t('lockTitleUnlock'); lockMsg(''); }
    else if (mode === 'set1') { el.lockTitle.textContent = t('lockTitleSet'); lockMsg(t('lockPrompt4'), true); }
    else if (mode === 'set2') { el.lockTitle.textContent = t('lockTitleConfirm'); lockMsg(''); }
    else if (mode === 'off') { el.lockTitle.textContent = t('lockTitleOff'); lockMsg(t('lockPromptCurrent'), true); }
    lockRenderDots();
  }
  function closeLock() {
    lockMode = ''; lockBuf = ''; lockTemp = '';
    haptic(HAPTIC_OK);   // 解鎖／設定成功：兩短震
    clearTimeout(lockPressTimer);
    el.lockScreen.classList.remove('pressing');
    el.lockScreen.classList.add('unlocked');
    setTimeout(() => { el.lockScreen.hidden = true; }, 300);
  }
  function lockFail(msg) {
    lockWrong++;
    haptic(HAPTIC_ERR);   // 密碼錯誤：兩重震
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
      lockMsg(t('lockCooldown', { n: left }));
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
      else lockFail(t('lockWrong'));
    } else if (lockMode === 'set1') {
      lockTemp = pin; openLock('set2');
    } else if (lockMode === 'set2') {
      if (pin === lockTemp) {
        settings.pinHash = await sha256Hex(pin);
        saveSettings(); syncLockUI();
        closeLock(); toast(t('lockEnabled'));
      } else { haptic(HAPTIC_ERR); openLock('set1'); lockMsg(t('lockMismatch')); }
    } else if (lockMode === 'off') {
      if (pin && await sha256Hex(pin) === settings.pinHash) {
        settings.pinHash = '';
        saveSettings(); syncLockUI();
        closeLock(); toast(t('lockDisabled'));
      } else lockFail(t('lockWrong'));
    }
  }
  function lockKey(k) {
    if (!lockMode || Date.now() < lockCooldown) return;
    haptic(HAPTIC_TAP);   // 每次按鍵輕震回饋
    lockPressEffect();    // 每次按鍵：介面下沉＋邊緣發光
    if (k === 'clear') lockBuf = '';
    else if (k === 'back') lockBuf = lockBuf.slice(0, -1);
    else if (lockBuf.length < LOCK_MAX) lockBuf += k;
    lockRenderDots();
    lockMsg('');
    if (lockBuf.length === LOCK_MAX) setTimeout(lockSubmit, 120);  // 輸滿自動驗證
  }
  /* 按鍵視覺回饋：鎖屏加 .pressing → 畫面邊緣內發光（::after inset shadow）。
     130ms 後自動移除；連按時先移除再重加並強制 reflow，確保每次都有完整一下。 */
  let lockPressTimer = null;
  function lockPressEffect() {
    const s = el.lockScreen;
    s.classList.remove('pressing');
    void s.offsetWidth;   // 重觸發（連按時每次都能重新播）
    s.classList.add('pressing');
    clearTimeout(lockPressTimer);
    lockPressTimer = setTimeout(() => s.classList.remove('pressing'), 130);
  }

  function syncLockUI() {
    const on = !!settings.pinHash;
    el.lockState.textContent = on ? t('lockOn') : t('lockOff');
    el.lockBtn.textContent = on ? t('lockDisable') : t('lockSet');
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
      parts.push(`<span class="income-part">${fmtUnits(inc.totalWork)} ${escapeHtml(t('unitWork'))} × ${money(inc.dayPay)}</span>`);
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
        <span>${escapeHtml(t('incomeLabel'))}</span>
        ${parts.length ? `<span class="income-formula">${parts.join(`<i>${lang === 'en' ? ' + ' : '＋'}</i>`)}</span>` : ''}
      </div>
      <button type="button" class="income-total${shown ? '' : ' is-masked'}"
              id="incomeToggle"
              aria-expanded="${shown}"
              aria-label="${escapeAttr(shown ? t('incomeShowAria') : t('incomeHideAria'))}"
              title="${escapeAttr(shown ? t('incomeHideTip') : t('incomeShowTip'))}">
        ${amount}
        <span class="income-eye" aria-hidden="true">${escapeHtml(shown ? t('incomeHideWord') : t('incomeShowWord'))}</span>
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
        ? `<span class="stat-pill"><span class="pill-label">${escapeHtml(t('statWork'))}</span><b>${fmtUnits(totalWork)}</b> ${escapeHtml(t('unitWork'))}</span>` : ''}
      ${totalPart > 0 ? `<span class="stat-pill part"><span class="pill-label">${escapeHtml(t('statPart'))}</span><b>${fmtH(totalPart)}</b> h</span>` : ''}
      <span class="stat-pill ot"><span class="pill-label">${escapeHtml(t('statOt'))}</span><b>${fmtH(totalOt)}</b> h</span>
      ${totalNight > 0 ? `<span class="stat-pill night"><span class="pill-label">${escapeHtml(t('statNight'))}</span><b>${fmtH(totalNight)}</b> h</span>` : ''}
      <span class="stat-pill"><span class="pill-label">${escapeHtml(t('statDays'))}</span><b>${days}</b> ${escapeHtml(t('unitDays'))}</span>
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
    let titleSize = parseFloat(getComputedStyle(title).fontSize);
    for (titleSize -= .5; titleSize >= 17; titleSize -= .5) {   // 三級：縮月標題
      title.style.fontSize = titleSize + 'px';
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
        return `<span class="${cls}">${weekdayLabel(i)}</span>`;
      })
      .join('');
  }

  function renderCalendar() {
    const y = view.getFullYear(), m = view.getMonth();
    el.monthTitle.textContent = fmtMonthTitle(y, m);
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
        holiday: settings.showHolidays ? holidayName(k, true) : null,
        holidayFull: settings.showHolidays ? holidayName(k) : null,
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
        rows.push(`<div class="day-units"><span class="uv">${fmtUnits(wu)}<span class="u">${escapeHtml(t('unitWork'))}</span></span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group work-group">${rows.join('')}</div>`);
    }
    if (hasPart) {
      if (showUnits) {
        groups.push(`<div class="day-group part-group"><div class="day-units part-units"><span class="uv">${fmtH(ph)}<span class="u">h</span></span><span class="ut">${escapeHtml(t('cellPart'))}</span></div></div>`);
      }
    }
    if (hasOt) {
      const rows = [];
      if (otDesc) {
        rows.push(`<div class="day-desc ot-text">${escapeHtml(otDesc)}</div>`);
      }
      if (showUnits) {
        rows.push(`<div class="day-units ot-units"><span class="uv"><span class="ot-pre">OT</span> ${fmtH(oh)}<span class="u">h</span></span><span class="ut">${escapeHtml(t('cellOt'))}</span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group ot-group">${rows.join('')}</div>`);
    }
    if (hasNight) {
      const rows = [];
      if (nightDesc) {
        rows.push(`<div class="day-desc night-text">${escapeHtml(nightDesc)}</div>`);
      }
      if (showUnits) {
        rows.push(`<div class="day-units night-units"><span class="uv"><span class="ot-pre">OT</span> ${fmtH(nh)}<span class="u">h</span></span><span class="ut">${escapeHtml(t('cellNight'))}</span></div>`);
      }
      if (rows.length) groups.push(`<div class="day-group night-group">${rows.join('')}</div>`);
    }
    const groupsHtml = groups.length ? `<div class="day-groups">${groups.join('')}</div>` : '';

    /* 每日收入（小字）：只在「已按顯示金額」且該日有可計價時數時才出現。
       未顯示金額時**整塊不渲染**（不留 ••• 佔位）——格子保持乾淨，
       避免每格都掛著三個點反而干擾閱讀；總計那顆按鈕仍保留 ••• 提示可點。 */
    const dayInc = incomeOfDay(e);
    const incHtml = (dayInc != null && incomeShown)
      ? `<div class="day-income" aria-hidden="true">$${fmtMoney(dayInc)}</div>`
      : '';

    const labelParts = [fmtDateLabel(new Date(c.key + 'T00:00:00'))];
    if (c.holiday) labelParts.push(t('holPrefix') + (c.holidayFull || c.holiday));
    if (hasEntry) {
      if (hasWork) labelParts.push(`${t('cellWork')} ${fmtUnits(wu)}`);
      if (hasPart) labelParts.push(`${t('cellPart')} ${fmtH(ph)} ${t('hourWord')}`);
      if (hasOt) labelParts.push(`${t('cellOt')} ${fmtH(oh)} ${t('hourWord')}`);
      if (hasNight) labelParts.push(`${t('cellNight')} ${fmtH(nh)} ${t('hourWord')}`);
    } else {
      labelParts.push(t('cellNoRecord'));
    }
    // 無障礙：只在金額可見時唸出每日收入（隱藏狀態不提示，維持格子靜默）
    if (dayInc != null && incomeShown) {
      labelParts.push(`${t('cellIncome')} ${fmtMoney(dayInc)}`);
    }

    // data-dow：讓 CSS 能分辨「六」與「日」。
    // 兩者都是週末（.is-weekend），但配色不同（星期六藍、星期日橘），
    // 與表頭的 六／日 一致；單靠 .is-weekend 無法區分。
    return `<div class="${classes.join(' ')}" data-key="${c.key}" data-dow="${c.dow}" role="gridcell" tabindex="0" aria-label="${escapeAttr(labelParts.join(lang === 'en' ? ', ' : '，'))}">
      <div class="day-num">${c.day}</div>
      ${c.holiday ? `<div class="day-hol">${escapeHtml(c.holiday)}</div>` : ''}
      ${groupsHtml}
      ${incHtml}
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
    const hol = settings.showHolidays ? holidayName(key) : null;
    el.sheetHol.textContent = hol ? t('hkHolidayPrefix') + hol : '';
    el.sheetHol.hidden = !hol;
    el.sheetTitle.textContent = hasContent(e) ? t('sheetEdit') : t('sheetNew');
    el.workDesc.value = e.workDesc || '';
    el.otDesc.value = e.otDesc || '';
    el.nightDesc.value = e.nightDesc || '';
    renderDescSuggestAll();   // 描述記憶：一開面板就常態顯示最近描述，不用先點輸入框
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
    el.suggestWork.hidden = true;   // 關面板統一收起描述建議
    el.suggestOt.hidden = true;
    el.suggestNight.hidden = true;
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
    wheel.setAttribute('aria-valuetext', `${fmtWheelNum(v)} ${t('hourWord')}`);
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
     面板一開啟就常態顯示最近幾條建議 chips，點一下即填入——不必先點輸入框。
     放在 settings 裡：隨一般設定持久化，也自動納入雲端備份。 */
  const DESC_HIST_MAX = 10;   // 儲存上限；面板內只顯示最近 3 條
  const DESC_SUGGEST_SHOW = 3;

  function rememberDesc(kind, text) {
    const txt = (text || '').trim();
    if (!txt) return;
    const h = (settings.descHistory = settings.descHistory || DEFAULTS.descHistory);
    const list = h[kind] = h[kind] || [];
    const i = list.indexOf(txt);
    if (i > -1) list.splice(i, 1);
    list.unshift(txt);
    if (list.length > DESC_HIST_MAX) list.length = DESC_HIST_MAX;
    saveSettings();
  }

  function renderDescSuggest(ta, box, kind) {
    const list = (settings.descHistory && settings.descHistory[kind]) || [];
    // 注意：這裡的 item 不可命名為 t——會遮蔽全域取詞函式 t()（v1.32.1 的 bug 就是這樣來的）
    const shown = list.slice(0, DESC_SUGGEST_SHOW);
    // 內容沒變就不重建（打字時若每次 input 都重建會閃）
    const sig = shown.join('\u0000');
    if (box._sig === sig) {
      // 仍要處理可見性：closeSheet 會把建議收起來，重開面板不能就這樣留著 hidden
      box.hidden = box.children.length === 0;
      updateDescChipActive(ta, box);
      return;
    }
    box._sig = sig;
    box.innerHTML = '';
    shown.forEach((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggest-chip';
      chip.textContent = item;
      chip.title = item;
      // pointerdown 在 blur 前觸發：先攔下填入，並維持原本的聚焦狀態
      // （已聚焦就繼續打字；沒聚焦就不強迫鍵盤跳出）
      chip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ta.value = item;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        updateDescChipActive(ta, box);
      });
      box.appendChild(chip);
    });
    box.hidden = box.children.length === 0;
    updateDescChipActive(ta, box);
  }

  /** 只切換「目前輸入框內容命中哪一條」的高亮，不重建 DOM */
  function updateDescChipActive(ta, box) {
    const cur = (ta.value || '').trim();
    [...box.children].forEach((chip) => {
      chip.classList.toggle('is-active', chip.textContent === cur);
    });
  }

  /** 三組描述建議一次全部更新（開面板時呼叫） */
  function renderDescSuggestAll() {
    [[el.workDesc, el.suggestWork, 'work'],
     [el.otDesc, el.suggestOt, 'ot'],
     [el.nightDesc, el.suggestNight, 'night'],
    ].forEach(([ta, box, kind]) => {
      if (ta && box) renderDescSuggest(ta, box, kind);
    });
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
    const tags = el.tagsInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);

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
    toast(empty ? t('toastCleared') : t('toastSaved'));
  }

  function deleteEntry() {
    if (!editingKey) return;
    delete entries[editingKey];
    save();
    closeSheet();
    render();
    toast(t('toastDeleted'));
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
      const now = new Date();
      view = new Date(now.getFullYear(), now.getMonth(), 1);
      render();
      toast(t('toastBackToday'));
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
      if (confirm(t('confirmDeleteEntry'))) deleteEntry();
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
      syncLangSeg();
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
    /* ---- 語言切換（中文／English）---- */
    if (el.langSeg) {
      el.langSeg.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.seg-btn');
        if (!btn) return;
        const next = normalizeLang(btn.dataset.langOpt);
        if (next === lang) return;
        settings.lang = next;
        saveSettings();
        applyLang();   // 內含 render()，整個介面立即切換
      });
    }

    if (themeMql) {
      const onSchemeChange = () => {
        if (settings.theme !== 'light' && settings.theme !== 'dark') applyTheme();
      };
      if (themeMql.addEventListener) themeMql.addEventListener('change', onSchemeChange);
      else if (themeMql.addListener) themeMql.addListener(onSchemeChange);   // 舊 Safari
    }

    /* ---- 描述記憶：常態顯示 ----
       清單在 openSheet 開啟面板時就 renderDescSuggestAll() 一次，不需要聚焦。
       這裡只補一件事：打字時更新「目前內容命中哪一條」的高亮。
       不要在 input 時重建整組 chips——會閃，而且輸入內容跟建議清單本來就無關。 */
    [[el.workDesc, el.suggestWork, 'work'],
     [el.otDesc, el.suggestOt, 'ot'],
     [el.nightDesc, el.suggestNight, 'night'],
    ].forEach(([ta, box, kind]) => {
      if (!ta || !box) return;
      ta.addEventListener('input', () => updateDescChipActive(ta, box));
    });

    /* ---- 收入金額：點一下切換顯示 / 遮蔽 ----
       按鈕本身每次 renderIncome() 都會重建，所以用委派綁在容器上。 */
    el.incomeBar.addEventListener('click', (ev) => {
      if (!ev.target.closest('#incomeToggle')) return;
      incomeShown = !incomeShown;   // 只記在記憶體：重載 App 回到預設隱藏
      renderIncome();
      renderCalendar();   // 格子底部的每日收入同步顯示／遮蔽
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
    el.cfDeleteCloud.addEventListener('click', cfDeleteCloud);
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
        toast(t('toastCfRestoreFail') + String(e.message || e).slice(0, 80));
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
      const rows = [t('csvHeaders').slice()];
      Object.keys(entries).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
        const e = entries[k];
        const d = new Date(k + 'T00:00:00');
        rows.push([
          k, csvWeekday(d.getDay()),
          num(e.workUnits), e.workDesc || '',
          num(e.partHours),
          num(e.otHours), e.otDesc || '',
          num(e.nightHours), e.nightDesc || '',
          (e.tags || []).join(' / '),
        ]);
      });
      if (rows.length === 1) { toast(t('toastNoExport')); return; }
      const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        t('csvFilename', { ym: `${y}-${pad(m + 1)}` }));
      toast(t('toastExportedCsv'));
    });

    /* ---- 匯出 JSON ---- */
    el.exportJson.addEventListener('click', () => {
      // 安全：匯出檔不帶雲端連線資訊與螢幕鎖雜湊。
      // 備份檔常被上傳到雲端硬碟或傳給別人，而 cfCode 就是雲端備份的解密依據，
      // 外洩等同把雲端資料的主鑰匙交出去（與 cfBackupPayload() 的處理一致）。
      const safeSettings = {
        ...settings,
        cfEndpoint: '', cfCode: '', cfAt: '', cfHash: '', pinHash: '',
      };
      const payload = { app: 'worktime-calendar', v: 1, exportedAt: new Date().toISOString(), settings: safeSettings, data: entries };
      download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        t('jsonFilename', { date: todayKey() }));
      toast(t('toastExportedJson'));
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
        if (!confirm(t('confirmImport', { n: incoming }))) return;
        // 舊版小時制備份也會自動轉換為「工」
        entries = { ...entries, ...migrate(data).data };
        if (parsed.settings) {
          // 安全：雲端連線資訊與螢幕鎖一律留本機現值，不讓匯入檔把它們改到別人的端點
          // （否則惡意備份檔可把後續自動備份導向攻擊者伺服器，而金鑰由 code＋endpoint 派生，對方解得開）
          const keep = {
            cfEndpoint: settings.cfEndpoint, cfCode: settings.cfCode,
            cfAt: settings.cfAt, cfHash: settings.cfHash, pinHash: settings.pinHash,
          };
          settings = { ...settings, ...parsed.settings, ...keep };
        }
        save(); saveSettings();
        closeDrawer();
        render();
        toast(t('toastImported', { n: incoming }));
      } catch (err) {
        toast(t('toastImportFail'));
        console.error(err);
      } finally {
        el.importFile.value = '';
      }
    });

    /* ---- 清除全部 ---- */
    el.clearAll.addEventListener('click', () => {
      if (!confirm(t('confirmClearAll'))) return;
      entries = {};
      save();
      closeDrawer();
      render();
      toast(t('toastClearedAll'));
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
    let s = String(v == null ? '' : v);
    // 安全：CSV 公式注入防護。描述欄是使用者自填（也可能由匯入／雲端還原帶入），
    // 若開頭是 = + - @ 或 Tab／CR，Excel／Sheets 會當公式執行（DDE、HYPERLINK 資料外洩等）。
    // 加一個前導單引號，試算表就會當純文字顯示。
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
    el.installHint.textContent = t('installBefore');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    el.installHint.textContent = t('installDone');
  });

  function setupInstallHint() {
    const isStandalone = matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isStandalone) {
      el.installHint.textContent = t('installStandalone');
    } else if (isIOS) {
      el.installHint.textContent = t('installIOS');
    } else if (!deferredPrompt) {
      el.installHint.textContent = t('installGeneric');
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
    el.verBuild.textContent = APP_BUILD ? t('verBuildAt', { time: formatBuild(APP_BUILD) }) : '';
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
    if (!silent) el.verStatus.textContent = t('verChecking');

    // 1) 已有 waiting 的新版 SW → 這是新版鐵證，直接提示
    if (version.waiting) {
      showUpdateBar(null, true);
      if (!silent) el.verStatus.textContent = t('verFoundNow');
      return 'update';
    }

    // 2) 比對 version.json
    const remote = await fetchRemoteVersion();
    if (!remote) {
      if (!silent) {
        el.verStatus.textContent = (location.protocol === 'file:')
          ? t('verFileMode')
          : t('verOffline');
      }
      return 'error';
    }
    version.remote = remote;

    if (isNewer(remote.version, APP_VERSION)) {
      showUpdateBar(remote);
      if (!silent) el.verStatus.textContent = t('verFound', { v: remote.version });
      return 'update';
    }

    if (!silent) {
      el.verStatus.textContent = t('verLatest');
      toast(t('toastLatest'));
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
      ? (info.notes ? t('updateBarNotes', { v: ver, notes: info.notes }) : t('updateBarVersion', { v: ver }))
      : t('updateBarDownloaded');

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
    btn.textContent = t('verUpdating');
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
          btn.textContent = t('verSlow');
          btn.disabled = false;
          toast(t('toastUpdateSlow'));
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
      toast(t('toastUpdateFail'));
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
      el.verStatus.textContent = t('toastUpdateLater');
    });

    el.checkUpdateBtn.addEventListener('click', async () => {
      const r = await checkForUpdate();
      if (r === 'latest') el.verStatus.textContent = t('verLatest');
      if (r === 'update') el.verStatus.textContent = t('toastUpdateFound');
    });
  }

  /* ---------------- 啟動 ---------------- */
  /** 底部提示文字：依輸入方式調整——觸控裝置單擊即開面板，滑鼠需雙擊 */
  function updateHintText() {
    const el = document.getElementById('hintText');
    if (!el) return;
    el.textContent = matchMedia('(hover: none)').matches
      ? t('hintTouch')
      : t('hintMouse');
  }

  function init() {
    load();
    lang = normalizeLang(settings.lang);   // 先定語言，後續所有字串才取得正確詞條
    applyTheme();   // 重設 meta theme-color 為目前主題（首幀由 inline script 設好）
    view = new Date();
    view.setDate(1);
    if (settings.pinHash) openLock('unlock');   // 先蓋鎖屏再渲染，內容不閃現
    bind();
    applyLang();    // 套用靜態文案＋渲染（含 updateHintText / setupInstallHint / renderVersionInfo）
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
