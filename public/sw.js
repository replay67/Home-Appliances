// Einfacher Offline-Cache für HausPlan
const CACHE = 'hausplan-v2';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'shared.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Netzwerk zuerst, damit Updates sofort ankommen; offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Gemeinsame Daten nie aus dem Cache – immer live vom Server
  if (new URL(e.request.url).pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
