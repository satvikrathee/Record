const CACHE_NAME = 'dairy-track-v' + new Date().getTime(); // Dynamic cache version

// 1. Force installation and skip waiting
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 2. Purge old caches on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch strategy: Network-only for API, Network-first for navigation, Cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER cache API requests (always live from Render/MongoDB)
  if (url.pathname.startsWith('/api') || url.hostname.includes('onrender.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Network-First strategy for HTML navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Cache-First for static UI assets (icons, css, images) only
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
