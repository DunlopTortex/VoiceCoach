// Offline support: cache the app shell, serve from cache, refresh in the background.
const CACHE = 'voice-coach-v1';
const ASSETS = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/audio.js', 'js/pitch.js', 'js/analysis.js', 'js/timer.js',
  'js/pitch-view.js', 'js/games.js', 'js/runner.js', 'js/exercises.js', 'js/storage.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
