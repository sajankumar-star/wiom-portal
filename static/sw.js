// Wiom IT Asset Hub — minimal service worker (enables PWA install)
const CACHE = 'wiom-assets-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Network-first passthrough so the app always shows fresh data,
// falling back to cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        try {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        } catch (_) {}
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
