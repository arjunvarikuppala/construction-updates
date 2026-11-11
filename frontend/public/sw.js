// Bump the version whenever caching rules change: old caches are deleted on activate.
const CACHE_NAME = 'bkr-infra-static-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/favicon-64.png',
  '/brand/bkr-logo.png',
  '/brand/bkr-logo-transparent.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: pre-cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      // Also keep the current build's main JS/CSS (named in index.html), so the app
      // opens with no signal even if it was only visited once
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (m) => m[1]);
        await cache.addAll(Array.from(new Set(assets)));
      } catch (e) {
        /* offline during install: they are cached on the next visit instead */
      }
    })
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-first for all API and authenticated calls; NEVER cache private financial API responses!
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strictly skip caching for any API endpoints, uploads, other sites (API server,
  // Cloudinary), or non-GET requests
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/uploads') ||
    event.request.method !== 'GET'
  ) {
    return; // Pass through directly to network
  }

  // Pages (HTML): network first so a new deploy is picked up immediately. A stale
  // index.html would point at JS bundles that no longer exist (blank screen).
  // The cached shell is only used when offline.
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Static assets (hashed file names): cache first, refresh in the background
  event.respondWith(
    // ignoreVary: module scripts send an Origin header that the saved copy wasn't fetched with
    caches.match(event.request, { ignoreVary: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Keep the app's own files (JS, CSS, fonts, icons) so it can open with no signal.
        // File names are content-hashed, so a cached copy is never stale.
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

// ---------------------------------------------------------------------------
// Push notifications (new messages, payment requests, reports, approvals)
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'BKR INFRA', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'BKR INFRA';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/notifications', id: data.id },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // App open and in front: it shows its own popup with sound instead
      const inFront = clients.some((c) => c.visibilityState === 'visible' && c.focused);
      if (inFront) return undefined;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.postMessage({ type: 'open-url', url: target });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
