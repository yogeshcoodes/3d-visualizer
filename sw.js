const CACHE_NAME =
    "space-sphere-v6";


const APP_SHELL = [
    "./",
    "./index.html"
];


const CDN_ASSETS = [

    "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",

    "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/exporters/GLTFExporter.js"

];


// =========================================================
// INSTALL
// =========================================================

self.addEventListener(
    "install",
    event => {

        event.waitUntil(

            caches
                .open(
                    CACHE_NAME
                )
                .then(
                    async cache => {

                        try {

                            await cache.addAll(
                                APP_SHELL
                            );

                        }

                        catch (error) {

                            console.warn(
                                "App shell cache:",
                                error
                            );

                        }


                        await Promise.allSettled(

                            CDN_ASSETS.map(
                                async url => {

                                    try {

                                        const response =
                                            await fetch(
                                                url,
                                                {
                                                    cache:
                                                        "no-cache"
                                                }
                                            );


                                        if (
                                            response.ok
                                        ) {

                                            await cache.put(
                                                url,
                                                response
                                            );

                                        }

                                    }

                                    catch (error) {

                                        console.warn(
                                            "CDN cache:",
                                            url,
                                            error
                                        );

                                    }

                                }
                            )

                        );

                    }
                )

        );


        self.skipWaiting();

    }
);


// =========================================================
// ACTIVATE
// =========================================================

self.addEventListener(
    "activate",
    event => {

        event.waitUntil(

            caches
                .keys()
                .then(
                    keys =>
                        Promise.all(

                            keys
                                .filter(
                                    key =>
                                        key !==
                                        CACHE_NAME
                                )
                                .map(
                                    key =>
                                        caches.delete(
                                            key
                                        )
                                )

                        )
                )

        );


        self.clients.claim();

    }
);


// =========================================================
// FETCH
// =========================================================

self.addEventListener(
    "fetch",
    event => {

        const request =
            event.request;


        if (
            request.method !==
            "GET"
        ) {

            return;

        }


        const url =
            new URL(
                request.url
            );


        // =====================================================
        // CDN → CACHE FIRST
        // =====================================================

        if (
            url.hostname ===
            "cdn.jsdelivr.net"
        ) {

            event.respondWith(

                caches
                    .match(
                        request
                    )
                    .then(
                        cached => {

                            if (
                                cached
                            ) {

                                return cached;

                            }


                            return fetch(
                                request
                            )
                                .then(
                                    response => {

                                        if (
                                            response.ok
                                        ) {

                                            const clone =
                                                response.clone();


                                            caches
                                                .open(
                                                    CACHE_NAME
                                                )
                                                .then(
                                                    cache => {

                                                        cache.put(
                                                            request,
                                                            clone
                                                        );

                                                    }
                                                );

                                        }


                                        return response;

                                    }
                                );

                        }
                    )

            );


            return;

        }


        // =====================================================
        // LOCAL APP → NETWORK FIRST + CACHE FALLBACK
        // =====================================================

        if (
            url.origin ===
            self.location.origin
        ) {

            event.respondWith(

                fetch(
                    request,
                    {
                        cache:
                            "no-cache"
                    }
                )
                    .then(
                        response => {

                            if (
                                response.ok
                            ) {

                                const clone =
                                    response.clone();


                                caches
                                    .open(
                                        CACHE_NAME
                                    )
                                    .then(
                                        cache => {

                                            cache.put(
                                                request,
                                                clone
                                            );

                                        }
                                    );

                            }


                            return response;

                        }
                    )
                    .catch(
                        () => {

                            return caches.match(
                                request
                            );

                        }
                    )

            );

        }

    }
);