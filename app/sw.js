/* GymLog service worker — network-first for app shell, cache-first for media */
const CACHE = 'gymlog-v7';
const SHELL = ['./', 'index.html', 'style.css?v=7', 'app.js?v=7', 'data.js?v=7', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // auth/data requests: never cache
  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/');
  if (isMedia) {
    // cache-first: exercise images never change
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })
    )));
  } else {
    // network-first: shell updates propagate, offline falls back to cache
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: false })
      .then(hit => hit || caches.match('index.html'))));
  }
});
