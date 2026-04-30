// Minimal service worker — network-first for navigations and assets,
// fall back to cache so previously-loaded pages work offline.
const CACHE = 'moanyfans-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Skip API + cross-origin requests entirely (CORS + auth complications).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Cache successful GETs for offline fallback
      if (fresh.ok && fresh.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Last-resort offline fallback for navigations
      if (req.mode === 'navigate') {
        const fallback = await caches.match('/');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503 });
    }
  })());
});

// ── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Moanyfans';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        if (target) c.navigate(target).catch(() => {});
        return c.focus();
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target || '/');
  })());
});
