const CACHE_NAME = 'palmux-v2';
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

// Fetch: network-first for navigation, cache-first for static assets, skip API and WebSocket
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

  // Cache-first strategy for static assets (CSS, JS, icons, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
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
