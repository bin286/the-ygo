/* Service worker: cache app shell để mở nhanh & chạy khi mất mạng.
   - Shell (cùng origin): cache-first.
   - API ygoprodeck + ảnh thẻ: network-first, có cache ảnh dự phòng.
   - Thư viện CDN (supabase, tesseract): stale-while-revalidate. */
var CACHE = "ygo-pwa-v23";
var SHELL = [
  "./", "./index.html", "./app.js", "./config.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // API dữ liệu thẻ: luôn lấy mới, không cache (giá/rarity thay đổi)
  if (url.hostname === "db.ygoprodeck.com") { e.respondWith(fetch(req).catch(function () { return new Response('{"data":[]}', { headers: { "Content-Type": "application/json" } }); })); return; }

  // TCG Republic via Cloudflare Worker proxy: luôn lấy mới (giá thay đổi)
  if (url.hostname === "ygo-proxy.tranducdung286.workers.dev") { e.respondWith(fetch(req).catch(function () { return new Response('{}', { headers: { "Content-Type": "application/json" } }); })); return; }

  // Yugipedia (mã bộ -> tên): network-first, có cache dự phòng khi mất mạng
  if (url.hostname === "yugipedia.com") {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return c.match(req); });
    })); return;
  }

  // ygoresources: index tên Nhật + dữ liệu thẻ — stale-while-revalidate (ít đổi, nặng)
  if (url.hostname === "db.ygoresources.com") {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    })); return;
  }

  // ảnh thẻ: cache-first (ít đổi)
  if (url.hostname === "images.ygoprodeck.com") {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }); });
    })); return;
  }

  // shell cùng origin: cache-first
  if (sameOrigin) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { if (res.ok) c.put(req, copy); }); return res; }).catch(function () { return caches.match("./index.html"); });
    })); return;
  }

  // CDN libs: stale-while-revalidate
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
