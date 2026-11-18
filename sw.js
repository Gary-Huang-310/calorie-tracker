// 熱量與營養日記 Service Worker
// 策略：頁面與程式檔 (html/js/css/manifest)「網路優先、離線時用快取」，確保更新後不會新舊檔混用；
// 圖示等不常變的檔案「快取優先」。
// 跨網域請求 (例如 Gemini API) 完全不經過這裡，不會被快取。
const CACHE = 'calorie-tracker-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './theme-init.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isCode = req.mode === 'navigate' || /\.(?:js|css|webmanifest)$/.test(url.pathname);
  if (isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            const key = req.mode === 'navigate' ? './index.html' : req;
            caches.open(CACHE).then((cache) => cache.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req).then((hit) => hit || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
