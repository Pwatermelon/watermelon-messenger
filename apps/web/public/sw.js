const CACHE = "wm-static-v7";
const OFFLINE_URLS = ["/home.html"];

/** JWT из приложения — без него /media/* не отдаётся (см. API). */
let authToken = null;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_URLS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isMediaRequest(url) {
  return /\/media\/[^/?#]+/.test(url.pathname);
}

function mediaFetchInit(request) {
  const headers = new Headers(request.headers);
  if (authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  return {
    method: request.method,
    headers,
    credentials: "same-origin",
    mode: request.mode,
    redirect: request.redirect,
  };
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "AUTH_TOKEN") {
    authToken = typeof event.data.token === "string" ? event.data.token : null;
  }
});

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

function navigationCacheKey(url) {
  if (url.pathname === "/") return "/home.html";
  return url.pathname;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) {
    if (isMediaRequest(url)) {
      event.respondWith(fetch(request.url, mediaFetchInit(request)));
    }
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            const cacheKey = navigationCacheKey(url);
            caches.open(CACHE).then((c) => c.put(cacheKey, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(navigationCacheKey(url)).then((r) => r || caches.match("/home.html"))
        )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/home.html")))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Watermelon", body: "Новое сообщение" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "wm-message",
      data: data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients[0]) return clients[0].focus();
      return self.clients.openWindow("/");
    })
  );
});
