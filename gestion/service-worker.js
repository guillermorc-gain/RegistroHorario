const CACHE_NAME = 'horas-v25';
// Detect base path dynamically so this works on GitHub Pages subdirectories
// e.g. /Registro-horario-emt/ instead of just /
const BASE_PATH = self.location.pathname.replace('service-worker.js', '');

// These files are always fetched from network (never stale)
const NETWORK_FIRST_FILES = ['', 'index.html', 'app.js'];

// These are cached and served from cache (change rarely)
const urlsToCache = [
  BASE_PATH + 'manifest.json',
  BASE_PATH + 'icons/icon-192.png',
  BASE_PATH + 'icons/icon-512.png',
  BASE_PATH + 'icons/icon.svg',
  BASE_PATH + 'icons/badge.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.map(name => name !== CACHE_NAME && caches.delete(name))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  const filename = url.pathname.split('/').pop() || 'index.html';
  const isNetworkFirst = NETWORK_FIRST_FILES.includes(filename);

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(BASE_PATH);
    })
  );
});
