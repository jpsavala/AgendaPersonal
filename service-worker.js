/*
 * Service worker de la Agenda Personal.
 *
 * Estrategia: "network-first" para todo lo del mismo origen (HTML, CSS,
 * JS, manifest, íconos) — siempre intenta traer la versión más nueva del
 * servidor primero; si no hay conexión (o falla la red), recién ahí usa
 * lo que haya en caché. Así una versión nueva desplegada llega sola la
 * próxima vez que haya internet, sin que nadie tenga que borrar caché a
 * mano — el caché es solo la red de contención para cuando no hay
 * conexión, nunca la fuente de verdad mientras la haya.
 *
 * CACHE_NAME: solo hace falta subirle el número si se agrega/renombra/
 * quita un archivo de PRECACHE_URLS (para que el activate limpie el
 * caché viejo con las rutas obsoletas). El contenido de cada archivo se
 * actualiza solo en cada fetch exitoso gracias al network-first de
 * abajo, así que un cambio de contenido común (editar un .js) NO
 * requiere tocar esta versión.
 */
const CACHE_NAME = "agenda-personal-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/quotes.js",
  "./js/wordOfTheDay.js",
  "./js/storage.js",
  "./js/dateUtils.js",
  "./js/scheduleDefs.js",
  "./js/palettes.js",
  "./js/userConfig.js",
  "./js/trainingSchedule.js",
  "./js/userGoal.js",
  "./js/scheduleQueue.js",
  "./js/state.js",
  "./js/aiBridge.js",
  "./js/dailyView.js",
  "./js/weeklyView.js",
  "./js/monthlyView.js",
  "./js/mealsView.js",
  "./js/yearView.js",
  "./js/app.js",
  "./js/firebaseSync.js",
  "./js/userConfigSync.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // No espera a que se cierren las demás pestañas: la próxima vez que
  // haya un fetch, este SW nuevo ya está en control (ver activate +
  // clients.claim). El aviso de "hay una actualización" lo maneja
  // index.html escuchando "controllerchange", no este skipWaiting.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        /* Si algún archivo no carga (p. ej. recién agregado y aún no desplegado), no rompe la instalación. */
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Los SDK de Firebase (gstatic.com) y cualquier otro origen quedan
  // completamente fuera de este service worker: pasan directo a la red,
  // sin cachear ni interceptar (evita respuestas "opacas" y problemas de
  // CORS, y de todos modos requieren conexión real para sincronizar).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return networkResponse;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Navegación sin conexión y sin esa página en caché: al menos
          // ofrece el shell de la app en vez de un error de red crudo.
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
