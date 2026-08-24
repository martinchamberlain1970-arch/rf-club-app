const CACHE_NAME = "rack-frame-shell-v3";
const APP_ASSETS = ["/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/notification-badge.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  if (!requestUrl.pathname.startsWith("/pwa/") && !requestUrl.pathname.startsWith("/_next/static/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Rack & Frame", body: "You have a new club update.", url: "/notifications", tag: "rack-frame-update" };
  try { payload = { ...payload, ...(event.data ? event.data.json() : {}) }; } catch { /* Use the safe default payload. */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/pwa/icon-192.png",
    badge: "/pwa/notification-badge.svg",
    tag: payload.tag,
    data: { url: payload.url || "/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(() => existing.navigate(target)) : clients.openWindow(target);
  }));
});
