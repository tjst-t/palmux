const CACHE_NAME = 'palmux-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
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

// Fetch: cache-first for static assets, skip API and WebSocket
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Skip API requests and WebSocket connections
  if (url.includes('/api/') || url.startsWith('ws://') || url.startsWith('wss://')) {
    return;
  }

  // Cache-first strategy for static assets
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
