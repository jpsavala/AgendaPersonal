/*
 * Service worker de la Agenda Personal.
 *
 * Estrategia: "network-first con límite de 3 s" para todo lo del mismo
 * origen (HTML, CSS, JS, manifest, íconos) — intenta traer la versión
 * más nueva del servidor primero, pero si no responde en 3 segundos (o
 * falla antes, por ejemplo sin conexión) usa de inmediato lo que haya en
 * caché, en vez de quedarse esperando a que la red falle del todo (en
 * una red móvil con problemas de ruta, eso puede tardar mucho más que 3
 * segundos y dejar la app pantalla en blanco todo ese tiempo). Si la red
 * SÍ responde después del límite, esa respuesta igual se guarda en
 * caché para la próxima vez, aunque ya no se use para pintar esta carga.
 * Así una versión nueva desplegada llega sola la próxima vez que haya
 * internet rápida, sin que nadie tenga que borrar caché a mano — el
 * caché es la red de contención para cuando no hay conexión o está
 * lenta, nunca la fuente de verdad mientras la red responda a tiempo.
 *
 * CACHE_NAME: subirle el número fuerza a todos los dispositivos a
 * descartar el caché viejo y rearmarlo (también hace falta subirlo cada
 * vez que se agrega/renombra/quita un archivo de PRECACHE_URLS, para que
 * el activate limpie las rutas obsoletas). El contenido de cada archivo
 * se actualiza solo en cada fetch exitoso gracias al network-first de
 * arriba, así que un cambio de contenido común (editar un .js) NO
 * requiere tocar esta versión — solo hace falta subirla cuando se quiere
 * forzar la actualización ya mismo en vez de esperar a la próxima visita
 * con red.
 */
const CACHE_NAME = "agenda-personal-v4";
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/vendor/firebase-compat.js",
  "./js/quotes.js",
  "./js/wordOfTheDay.js",
  "./js/wordLanguage.js",
  "./js/storage.js",
  "./js/dateUtils.js",
  "./js/scheduleDefs.js",
  "./js/palettes.js",
  "./js/userConfig.js",
  "./js/trainingSchedule.js",
  "./js/userGoal.js",
  "./js/scheduleQueue.js",
  "./js/runQueue.js",
  "./js/state.js",
  "./js/aiBridge.js",
  "./js/dailyView.js",
  "./js/weeklyView.js",
  "./js/monthlyView.js",
  "./js/mealsView.js",
  "./js/yearView.js",
  "./js/app.js",
  "./js/quickCapture.js",
  "./js/firebaseSync.js",
  "./js/userConfigSync.js",
  "./icons/icon-180.png",
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

// Carrera entre la red y un límite de tiempo: la primera en resolver
// gana. Si la red tarda más de NETWORK_TIMEOUT_MS, esta promesa se
// rechaza (aunque la petición de red siga en curso de fondo — ver
// abajo, igual se guarda en caché si termina llegando) y el fetch
// handler cae al caché de inmediato en vez de seguir esperando.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Firestore/Auth (firestore.googleapis.com, identitytoolkit, etc.) y
  // cualquier otro origen quedan completamente fuera de este service
  // worker: pasan directo a la red, sin cachear ni interceptar (evita
  // respuestas "opacas" y problemas de CORS, y de todos modos requieren
  // conexión real para sincronizar). El SDK de Firebase ya NO es uno de
  // estos casos: ahora se autoaloja (ver js/vendor/firebase-compat.js),
  // así que entra en la rama normal de abajo como cualquier otro archivo
  // propio.
  if (url.origin !== self.location.origin) return;

  const networkFetch = fetch(req).then((networkResponse) => {
    const copy = networkResponse.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
    return networkResponse;
  });

  event.respondWith(
    withTimeout(networkFetch, NETWORK_TIMEOUT_MS).catch(() =>
      caches.match(req).then((cached) => {
        if (cached) return cached;
        // Todavía no hay nada en caché para esto (primera visita sin
        // red, o archivo nuevo que nunca llegó a precachearse): como
        // último recurso, espera la respuesta de red que sigue en curso
        // de fondo, sin el límite de 3 s (mejor tarde que nunca, en vez
        // de un error crudo).
        return networkFetch.catch(() => {
          // Navegación sin conexión, sin esa página en caché ni en
          // camino: al menos ofrece el shell de la app en vez de un
          // error de red crudo.
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
      })
    )
  );
});
