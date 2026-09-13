const CACHE_NAME = "space-sphere-v17";

const APP_SHELL = [
    "./",
    "./index.html",
    "./js/main.js",
    "./js/threeViewer.js",
    "./js/audioEngine.js",
    "./assets/Space.jpg",
    "./assets/Forest.jpg",
    "./assets/Day.jpg",
    "./assets/Hall.jpg",
    "./assets/Snow.jpg"
];

const CDN_ASSETS = [
    "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/exporters/GLTFExporter.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            try { await cache.addAll(APP_SHELL); } catch (error) { console.warn("App shell cache:", error); }
            await Promise.allSettled(
                CDN_ASSETS.map(async url => {
                    try {
                        const response = await fetch(url, { cache: "no-cache" });
                        if (response.ok) await cache.put(url, response);
                    } catch (error) { console.warn("CDN cache:", url, error); }
                })
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);

    if (url.hostname === "cdn.jsdelivr.net") {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(request, { cache: "no-cache" })
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});