// Service worker de Aguiteks LifeOS.
// Solo guarda los archivos de la propia app (para abrirla sin red). Nunca intercepta Firestore,
// Auth ni la API (otros orígenes): los datos personales y financieros no se guardan en la caché.
const CACHE = 'lifeos-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png']);
      try {
        const files = await (await fetch('/precache.json', { cache: 'no-store' })).json();
        await Promise.all(files.map((f) => c.add(`/${f}`).catch(() => undefined)));
      } catch {
        /* sin lista: se guardan al usarse */
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Red primero (versión nueva); sin red, la app guardada.
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  // Archivos con hash: inmutables, caché primero.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && url.pathname.startsWith('/assets/')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })));
});
