// rainy.ie service worker: makes the app installable, keeps it working offline,
// and caches everything that doesn't change so a returning visitor (or the
// installed app) rarely downloads anything twice.
//
// Caches, each with its own version so bumping one doesn't wipe the others:
//   shell    the page and other public files (refreshed; cleared on a new build)
//   static   /_next/static: content-hashed build files, so never stale
//   vendor   third-party scripts (jsDelivr pinned, Simple Analytics), served
//            cached and refreshed in the background
//   basemap  OpenFreeMap tiles, fonts and sprites (versioned URLs), plus its
//            style and tile index (refreshed in the background)
//   rain     Met Éireann radar/forecast tiles (each URL is one frame's
//            version, so it never changes; capped, oldest dropped)
// Only `shell` is cleared when a new build is deployed (app/UpdateCheck.tsx).
const CACHES = {
  shell: "shell-v3",
  static: "static-v1",
  vendor: "vendor-v1",
  basemap: "basemap-v1",
  rain: "rain-v1",
};
// Enough for every basemap tile in the pannable area at every zoom.
const MAX_BASEMAP = 3000;
// About an hour or two of radar and forecast frames at a typical view.
const MAX_RAIN = 1500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHES.shell)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const current = new Set(Object.values(CACHES));
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !current.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

const cacheable = (res) => res.ok || res.type === "opaque";

// Save a copy, but never let caching break the response itself (e.g. when the
// storage quota is full, put() rejects).
async function save(cache, request, res, max) {
  try {
    await cache.put(request, res);
    if (max) {
      await trim(cache, max);
    }
  } catch {
    // Not cached this time; the response still goes back as normal.
  }
}

// Network first, falling back to the cache (pages: always fresh when online).
async function networkFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      event.waitUntil(save(cache, request, res.clone()));
    }
    return res;
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
  }
}

// Cache first: for URLs whose content never changes.
async function cacheFirst(event, cacheName, max) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }
  const res = await fetch(request);
  if (cacheable(res)) {
    event.waitUntil(save(cache, request, res.clone(), max));
  }
  return res;
}

// Serve the cached copy straight away (if any) and refresh it in the background.
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((res) => {
      if (cacheable(res)) {
        event.waitUntil(save(cache, event.request, res.clone()));
      }
      return res;
    })
    .catch(() => hit ?? Response.error());
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Live data and the update check: always the network.
  if (sameOrigin && url.pathname === "/buildId.json") {
    return; // app/UpdateCheck.tsx
  }
  if (url.hostname === "gdal.met.ie") {
    // Frame lists change every few minutes; tiles are one frame's version each.
    if (/^\/api\/maps\/[a-z-]+\/\d{12}\//.test(url.pathname)) {
      event.respondWith(cacheFirst(event, CACHES.rain, MAX_RAIN));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, CACHES.shell));
  } else if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, CACHES.static));
  } else if (sameOrigin && !url.searchParams.has("_rsc") && !request.headers.has("RSC")) {
    // Other public files (icons, pin, manifest); not Next.js page data.
    event.respondWith(staleWhileRevalidate(event, CACHES.shell));
  } else if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "scripts.simpleanalyticscdn.com") {
    // Loaded by plain <script> tags, so responses are opaque: we can't tell a
    // failure from a success. Serving the cached copy while refreshing it
    // means a bad response is replaced on the next load, not kept forever.
    event.respondWith(staleWhileRevalidate(event, CACHES.vendor));
  } else if (url.hostname.endsWith("openfreemap.org")) {
    // Tiles, fonts and sprites live at versioned URLs; the style and the tile
    // index (/planet) point at the current versions, so keep those fresh.
    const versioned = /\.(pbf|png|json)$/.test(url.pathname) && !/^\/(styles\/|planet$)/.test(url.pathname);
    event.respondWith(
      versioned ? cacheFirst(event, CACHES.basemap, MAX_BASEMAP) : staleWhileRevalidate(event, CACHES.basemap),
    );
  }
});
