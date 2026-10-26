const CACHE_NAME = "mahoyo-web-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Ne pas mettre en cache les requêtes externes ou les API
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        // En offline, retourner une réponse vide silencieuse
        return new Response("", { status: 503, statusText: "Offline" });
      }
    })
  );
});
