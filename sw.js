/* CellScope – offline provoz. Při nové verzi stačí zvýšit VERSION. */
const VERSION = "cellscope-1.1.1";
const FILES = ["./", "index.html", "manifest.webmanifest", "js/i18n.js", "js/parse.js", "js/console.js", "js/demo.js",
  "js/analyse.js", "js/store.js", "js/app.js", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/baterie.webp"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
/* vlastní soubory: nejdřív síť (aby se aktualizace projevila), bez sítě z mezipaměti; písma: mezipaměť */
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(x => { const c = x.clone(); caches.open(VERSION).then(k => k.put(e.request, c)); return x; })));
  }
});
