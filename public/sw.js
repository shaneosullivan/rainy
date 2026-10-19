// rainy.ie service worker: makes the app installable and keeps the page and
// basemap working offline. Radar frames are live data, so they're never cached.
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

// Network first, falling back to the cache (pages: always fresh when online).
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
  }
}

// Cache first (immutable build assets and basemap tiles).
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") {
    cache.put(request, res.clone());
    if (max) {
      trim(cache, max);
    }
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.hostname === "gdal.met.ie") {
    return; // live radar: straight to the network
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL));
  } else if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL));
  } else if (url.hostname.endsWith("openfreemap.org")) {
    event.respondWith(cacheFirst(request, TILES, MAX_TILES));
  }
});
