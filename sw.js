/* =========================================================
 * Service Worker — 離線快取 + 版本更新
 *
 * 更新流程：
 *   1. 新版部署後，瀏覽器抓到新的 sw.js（位元組不同即視為更新）
 *   2. 新版 SW 進入 waiting 狀態，並通知頁面「有新版本」
 *   3. 使用者按下一鍵更新 → 頁面送 SKIP_WAITING → SW 立即接管
 *   4. controllerchange 觸發，頁面重新載入即為新版
 * ========================================================= */

const CACHE = 'worktime-calendar-v1.8.0';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './version.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/* ---------------- 安裝：預快取並回報進度 ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => precacheAll(cache))
      .then(() => notify({ type: 'INSTALLED' }))
      .catch((err) => console.warn('[SW] 預快取失敗', err))
  );
  // 注意：不在這裡呼叫 skipWaiting，改由使用者按「立即更新」觸發
});

/**
 * 預快取：逐檔以 network 模式抓取。
 * 關鍵：若用 cache.addAll()，在「舊 SW 仍在控制頁面」時，這些請求會被舊 SW
 *       的 fetch handler 攔截而回傳舊快取內容，導致新版 SW 把舊檔當新檔快取，
 *       使用者按了更新卻仍是舊版。改用 Request(cache:'reload') 強制走網路。
 */
function precacheAll(cache) {
  return Promise.all(PRECACHE.map((url) => {
    const req = new Request(url, { cache: 'reload' });
    return fetch(req).then((res) => {
      if (!res || !res.ok) throw new Error('預快取失敗: ' + url + ' ' + res.status);
      return cache.put(url, res);
    });
  }));
}

/* ---------------- 啟用：清掉舊版快取 ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => {
          console.info('[SW] 清除舊快取', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => notify({ type: 'ACTIVATED', cache: CACHE }))
  );
});

/* ---------------- 訊息通道 ---------------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};

  // 使用者按下「立即更新」→ 讓 waiting 中的 SW 立刻接管
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // 頁面主動詢問目前版本
  if (data.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', cache: CACHE };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else notify(reply);
  }
});

function notify(msg) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then((list) => list.forEach((c) => c.postMessage(msg)));
}

/* ---------------- 攔截請求 ---------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 版本檔一律走網路（避免快取導致偵測不到新版）
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 導航請求：網路優先，離線時回快取
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 靜態資源：快取優先，背景更新
  // 例外：app.js / sw.js 是判斷更新與版本的關鍵，改為網路優先，避免舊程式碼誤判
  const isCritical = /\/app\.js$/.test(url.pathname) || /\/sw\.js$/.test(url.pathname);
  if (isCritical) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
