// Cache-first service worker: after one visit on Wi-Fi, the app never touches the network.
// Bump CACHE when app files change. The big OCR files (vendor/) are carried over from the
// previous cache instead of being downloaded again.
const CACHE = 'menu-decoder-v2';
const ASSETS = [
  './', 'index.html', 'app.js', 'glossary.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png',
  'vendor/tesseract.min.js', 'vendor/worker.min.js',
  'vendor/core/tesseract-core-lstm.wasm.js', 'vendor/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js', 'vendor/lang/ita.traineddata.gz'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async url => {
      const old = url.startsWith('vendor/') && await caches.match(url);
      if (old) return cache.put(url, old);
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error('fetch failed: ' + url);
      return cache.put(url, res);
    }));
    self.skipWaiting();
    (await self.clients.matchAll({ includeUncontrolled: true })).forEach(c => c.postMessage('cached'));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
