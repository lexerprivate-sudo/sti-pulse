const CACHE = "sti-pulse-v24";
const CRITICAL = ["./", "offline.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
const OPTIONAL = ["schedule.json", "data.json"];
const ALL_SHELL = [...CRITICAL, ...OPTIONAL];

function isFreshEnough(response) {
  if (!response || !response.ok) return false;
  const type = response.headers.get("content-type") || "";
  return type.includes("text/html") || type.includes("application/json") || type.includes("image/svg") || type.includes("image/png");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Critical assets: install fails loudly if any are missing, so the old
      // worker stays and the live page keeps working.
      await Promise.all(CRITICAL.map((url) => cache.add(url)));
      // Optional assets: best effort, no install failure.
      await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sti-pulse-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.includes("/api/")) return;

  // Live data: stale-while-revalidate, keyed on path only (ignore query).
  if (url.pathname.endsWith("data.json") || url.pathname.endsWith("submitted.json")) {
    const key = url.origin + url.pathname;
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(key);
        const network = fetch(request).then((response) => {
          if (isFreshEnough(response) && (response.headers.get("content-type") || "").includes("application/json")) {
            cache.put(key, response.clone()).catch(() => {});
          }
          return response;
        }).catch(() => null);
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        const response = await network;
        if (response) return response;
        return new Response('{"assignments":[],"offline":true}', {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })()
    );
    return;
  }

  // Navigations: network-first with timeout, then cache, then offline page.
  if (request.mode === "navigate") {
    const key = url.origin + url.pathname;
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await fetch(request, { signal: AbortSignal.timeout(5000) });
          if (isFreshEnough(response) && (response.headers.get("content-type") || "").includes("text/html")) {
            cache.put(key, response.clone()).catch(() => {});
            return response;
          }
        } catch (error) {
          logCacheMiss(error);
        }
        return (
          (await cache.match(key)) ||
          (await cache.match("./")) ||
          (await cache.match("offline.html")) ||
          new Response("<h1>Offline</h1>", { status: 200, headers: { "content-type": "text/html" } })
        );
      })()
    );
    return;
  }

  // Static assets: cache-first with background revalidate, content-type guarded.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = url.origin + url.pathname;
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (isFreshEnough(response)) {
          cache.put(key, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        logCacheMiss(error);
        return new Response("Offline and unavailable", { status: 503, statusText: "Service Unavailable" });
      }
    })()
  );
});

function logCacheMiss(error) {
  try { console.warn("[STI Pulse SW]", error?.message || error); } catch { /* ignore */ }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const scope = self.registration.scope;
      const existing = clients.find((client) => client.url.startsWith(scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(scope);
    })
  );
});
