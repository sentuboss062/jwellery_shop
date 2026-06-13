const CACHE_VERSION = "jewellery-portal-v1.3.1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/css/print.css",
  "/assets/logo-placeholder.svg",
  "/js/app.js",
  "/js/router.js",
  "/js/db.js",
  "/js/data-service.js",
  "/js/api-client.js",
  "/js/sync-engine.js",
  "/js/helpers.js",
  "/js/security.js",
  "/js/pdf.js",
  "/js/backup.js",
  "/js/charts.js",
  "/js/storage-health.js",
  "/js/modules/dashboard.js",
  "/js/modules/audit-log.js",
  "/js/modules/billing.js",
  "/js/modules/stock.js",
  "/js/modules/customers.js",
  "/js/modules/loans.js",
  "/js/modules/exchange.js",
  "/js/modules/credits.js",
  "/js/modules/reports.js",
  "/js/modules/settings.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok || response.type === "opaque") {
          await cache.put(url, response);
        }
      } catch (error) {
        console.warn("Could not cache", url, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst("/index.html", request));
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const fallback = await cache.match("/index.html");
    if (fallback && request.headers.get("accept")?.includes("text/html")) return fallback;
    throw error;
  }
}

async function networkFirst(fallbackUrl, request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(fallbackUrl, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(fallbackUrl)) || Response.error();
  }
}
