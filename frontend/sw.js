const CACHE_NAME = 'palmux-v3';
const STATIC_ASSETS = [
  './app.js',
  './style.css',
  './xterm.css',
  './manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Fetch: network-first for navigation, stale-while-revalidate for static assets, skip API and WebSocket
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Skip API requests and WebSocket connections
  if (url.includes('/api/') || url.startsWith('ws://') || url.startsWith('wss://')) {
    return;
  }

  // Navigation requests (HTML) use network-first strategy.
  // index.html contains a dynamic auth token (<meta name="auth-token">),
  // so we must always fetch the latest version from the server.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for static assets (CSS, JS, icons, etc.)
  // キャッシュがあれば即座に返し、バックグラウンドで最新版を取得してキャッシュを更新する。
  // これにより、コード更新後も次回アクセスから最新版が適用される。
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      // バックグラウンドでネットワークから取得してキャッシュを更新
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      // キャッシュがあれば即座に返す（バックグラウンド更新は続行）
      // キャッシュがなければネットワークから取得して待つ
      return cached || networkFetch;
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
});
