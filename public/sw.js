const CACHE = "sti-pulse-v23";
const SHELL = [
  "./",
  "manifest.webmanifest",
  "schedule.json",
  "submitted.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache API calls.
  if (url.pathname.includes("/api/")) return;

  // Live data (data.json / submitted.json): stale-while-revalidate.
  if (url.pathname.endsWith("data.json") || url.pathname.endsWith("submitted.json")) {
    const key = url.origin + url.pathname;
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(key);
        const network = fetch(request).then((response) => {
          if (response && response.ok) {
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
        throw new Error("offline and no data cached yet");
      })()
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return (cached || network).then((response) => response || new Response("Offline and unavailable", { status: 503, statusText: "Service Unavailable" }));
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
