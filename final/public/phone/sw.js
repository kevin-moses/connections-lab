// Network first so edits show up immediately while developing. The cache only covers offline launches.
const CACHE = "breath-phone-v1";
const SHELL = ["/phone/", "/phone/phone.js", "/style.css", "/phone/manifest.webmanifest", "/phone/icon-192.png", "/phone/icon-512.png"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET" || url.pathname.startsWith("/socket.io/")) return;
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
});
