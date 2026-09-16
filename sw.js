const CACHE = 'worktime-calendar-v1.11.0';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 安裝：預先抓取所有資源並寫入快取。
// 用 cache: 'reload' 確保抓到的是伺服器上的最新版本，
// 而不是瀏覽器 HTTP 快取裡的舊檔（否則更新後仍會拿到上一版的 CSS/JS）。
async function precacheAll() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    PRECACHE.map((url) =>
      fetch(new Request(url, { cache: 'reload' }))
        .then((res) => (res && res.ok ? cache.put(url, res) : null))
        .catch(() => null)
    )
  );
}

self.addEventListener('install', (event) => {
  // 刻意不呼叫 skipWaiting()：等使用者按下「立即更新」再切換，
  // 避免他正在輸入時頁面被新版接管而中斷。
  event.waitUntil(precacheAll());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // version.json 一律走網路：這是版本偵測的來源，
  // 快取住就永遠比對不出新版本。
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(new Request(req, { cache: 'no-store' })).catch(() => caches.match(req)));
    return;
  }

  // 導覽請求：網路優先，離線時退回快取的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // app.js / sw.js：網路優先。這兩個檔案是程式邏輯本體，
  // 一旦快取優先，使用者會在新版發布後仍跑舊程式碼。
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/sw.js')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其他靜態資源：快取優先，背景再驗證一次
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res));
          })
          .catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

// 讓頁面可以主動要求跳過等待（一鍵更新時使用）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
