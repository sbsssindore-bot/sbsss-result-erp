/* Minimal service worker: makes the app installable and shows an offline page.
   Authenticated pages and API data are NEVER cached. */
const CACHE = 'sbsss-shell-v1';
const SHELL = ['/offline.html', '/sbsss-logo.png', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/offline.html'))); return; }
  if (u.pathname.startsWith('/_next/static/') || u.pathname.startsWith('/icons/') || u.pathname === '/sbsss-logo.png') {
    e.respondWith(caches.match(r).then((c) => c || fetch(r).then((res) => { const cp = res.clone(); caches.open(CACHE).then((ca) => ca.put(r, cp)); return res; })));
  }
});
