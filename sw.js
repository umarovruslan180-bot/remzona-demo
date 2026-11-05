// Ремзона: оболочка приложения работает без связи (данные -- через очередь в index.html), показ уведомлений
const CACHE = "remzona-demo-v1";
const SHELL = ["./index.html", "./manifest.webmanifest", "./logo.png", "./icon-192.png", "./icon-512.png",
  "./demo-backend.js"]; // демо: сервер имитируется в браузере

self.addEventListener("install", (e) => {
  // мимо кэша браузера -- иначе GitHub Pages может отдать прежнюю версию (кэш до 10 мин)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// оболочка -- сразу из кэша (запуск без ожидания сети), свежая версия докачивается в фоне;
// изменилась страница -- сообщить приложению (обновится при следующем открытии); запросы к базе не трогаем
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // приложение (…/remzona/, …/index.html, ?join=…) -- одна страница в кэше; прочие адреса -- как есть
  // ?check=1 -- проверка новой версии из открытого приложения (checkUpdate): как открытие страницы, сообщит «updated»
  const page = (e.request.mode === "navigate" || u.searchParams.has("check")) && /\/(index\.html)?$/.test(u.pathname), key = page ? "./index.html" : e.request;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(key, { ignoreSearch: true });
    const old = page && hit ? hit.clone() : null;   // копия -- сам hit уходит браузеру, его тело потом не прочитать
    const net = fetch(page ? u.origin + u.pathname : e.request, { cache: "no-cache" }).then(async (r) => {
      if (!r.ok || r.type !== "basic") return r;
      if (old && (await old.text()) !== (await r.clone().text())) {
        await c.put(key, r.clone());
        (await self.clients.matchAll({ type: "window" })).forEach((w) => w.postMessage({ type: "updated" }));
      } else await c.put(key, r.clone());
      return r;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match("./index.html"));
  }));
});
// Web Push от сервера (функция push): показать, даже когда приложение закрыто; одна запись -- одно уведомление (tag)
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "Ремзона",
    { body: d.body || "", icon: "icon-192.png", tag: d.tag || undefined, renotify: !!d.tag }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
