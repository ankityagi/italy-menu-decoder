// Cache-first service worker: after one visit on Wi-Fi, the app never touches the network.
const CACHE = 'menu-decoder-v1';
const ASSETS = [
  './', 'index.html', 'app.js', 'glossary.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png',
  'vendor/tesseract.min.js', 'vendor/worker.min.js',
  'vendor/core/tesseract-core-lstm.wasm.js', 'vendor/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js', 'vendor/lang/ita.traineddata.gz'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(async () => {
    self.skipWaiting();
    (await self.clients.matchAll()).forEach(c => c.postMessage('cached'));
  }));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
