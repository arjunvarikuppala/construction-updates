// Bump the version whenever caching rules change: old caches are deleted on activate.
const CACHE_NAME = 'bkr-infra-static-v8';
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
// The number on the installed app's icon (where the phone / computer supports it)
function setBadge(count) {
  try {
    if (typeof count !== 'number' || !self.navigator) return;
    if (count > 0 && self.navigator.setAppBadge) self.navigator.setAppBadge(count);
    else if (count === 0 && self.navigator.clearAppBadge) self.navigator.clearAppBadge();
  } catch (e) {
    /* not supported */
  }
}

const MAX_LINES = 6;

// Chat messages stack per chat like a messaging app: one notification per chat,
// "Highland Flyover · 3 new messages" with the latest lines underneath.
async function showChat(data) {
  const tag = data.tag || 'chat';
  const existing = (await self.registration.getNotifications({ tag }))[0];
  const prev = (existing && existing.data && existing.data.lines) || [];
  const line = { sender: data.sender || '', text: data.body || '' };
  const lines = prev.concat([line]).slice(-MAX_LINES);
  const count = ((existing && existing.data && existing.data.count) || 0) + 1;

  let title;
  let body;
  if (count === 1) {
    title = data.sender || data.title || 'New message';
    body = data.chat ? `${data.chat}\n${line.text}` : line.text;
  } else {
    title = `${data.chat || 'Project chat'} · ${count} new messages`;
    body = lines.map((l) => (l.sender ? `${l.sender}: ${l.text}` : l.text)).join('\n');
  }

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag,
    renotify: true,
    timestamp: data.timestamp || Date.now(),
    vibrate: [120, 60, 120],
    data: { url: data.url || '/messages', id: data.id, lines, count, actionUrl: data.actionUrl, readToken: data.readToken },
    actions: [
      { action: 'reply', title: 'Reply' },
      ...(data.readToken && data.actionUrl ? [{ action: 'read', title: 'Mark as read' }] : []),
    ],
  };
  if (data.image) options.image = data.image;
  return self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'BKR INFRA', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      setBadge(data.badge);
      // App open and in front: it shows its own popup with sound instead
      const inFront = clients.some((c) => c.visibilityState === 'visible' && c.focused);
      if (inFront) return undefined;
      if (data.kind === 'chat') return showChat(data);
      return self.registration.showNotification(data.title || 'BKR INFRA', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        timestamp: data.timestamp || Date.now(),
        data: { url: data.url || '/notifications', id: data.id },
        vibrate: [120, 60, 120],
      });
    })
  );
});

function openUrl(url) {
  const target = new URL(url || '/', self.location.origin).href;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        client.postMessage({ type: 'open-url', url: target });
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  });
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // "Mark as read": done in the background, nothing opens
  if (event.action === 'read' && data.actionUrl && data.readToken) {
    event.waitUntil(
      fetch(data.actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.readToken }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => r && setBadge(r.badge))
        .catch(() => undefined)
    );
    return;
  }

  // "Reply": open the chat with the keyboard ready
  if (event.action === 'reply') {
    const url = data.url || '/messages';
    event.waitUntil(openUrl(url + (url.includes('?') ? '&' : '?') + 'reply=1'));
    return;
  }

  event.waitUntil(openUrl(data.url || '/'));
});

// The app tells us when a chat was read, so its phone notification goes away
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'clear-chat' && msg.projectId) {
    event.waitUntil(
      self.registration.getNotifications({ tag: `chat-${msg.projectId}` }).then((list) => list.forEach((n) => n.close()))
    );
  }
  if (msg.type === 'set-badge') setBadge(msg.count);
});
