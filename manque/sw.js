// Met l'interface en cache pour qu'elle s'ouvre même sans réseau sur le chantier.
// Les données (API GitHub) ne passent jamais par ce cache : elles sont gérées par la page.
const CACHE = 'manque-v1';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('manque-') && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Réseau d'abord (pour recevoir les mises à jour), cache en secours — fichiers de la page uniquement.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
