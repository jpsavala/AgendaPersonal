/*
 * Sincronización entre dispositivos vía Firebase (Firestore + Auth
 * anónimo). Es una capa externa: state.js no sabe que esto existe, solo
 * expone getRawData()/replaceAllData()/onPersist() para que esta capa
 * lea, escriba y reaccione a cambios sin tocar la lógica de la agenda.
 *
 * Modelo: un solo documento por usuario (agendas/{uid}) con todo el
 * bloque de datos ({ payload, updatedAt }), igual de simple que el
 * localStorage actual. Gana el lado con updatedAt más reciente
 * ("last write wins"); no hay merge campo por campo.
 *
 * Requiere, del lado de Firebase Console (no se puede hacer desde aquí):
 *   1. Firestore Database creada (modo producción).
 *   2. Authentication → Sign-in method → Anonymous, habilitado.
 *   3. Reglas de Firestore que solo permitan a cada usuario leer/escribir
 *      su propio documento, ej.:
 *        rules_version = '2';
 *        service cloud.firestore {
 *          match /databases/{database}/documents {
 *            match /agendas/{uid} {
 *              allow read, write: if request.auth != null && request.auth.uid == uid;
 *            }
 *          }
 *        }
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const firebaseConfig = {
    apiKey: "AIzaSyDm-DQWoN9U8z9GTtchgO8G7WtWZXCDazI",
    authDomain: "agendapersonal-13aef.firebaseapp.com",
    projectId: "agendapersonal-13aef",
    storageBucket: "agendapersonal-13aef.firebasestorage.app",
    messagingSenderId: "839948107344",
    appId: "1:839948107344:web:5c5129d1b0b98ab99e5b55",
  };

  const LOCAL_META_KEY = "agendaPersonal_v1_syncMeta";
  const PUSH_DEBOUNCE_MS = 800;

  let db = null;
  let uid = null;
  let applyingRemote = false;
  let pushTimer = null;
  let currentStatus = "connecting";
  const statusListeners = [];

  function setStatus(status) {
    currentStatus = status;
    statusListeners.forEach((fn) => fn(status));
  }

  function getLocalUpdatedAt() {
    try {
      const raw = localStorage.getItem(LOCAL_META_KEY);
      return raw ? JSON.parse(raw).updatedAt || 0 : 0;
    } catch (e) {
      return 0;
    }
  }

  function setLocalUpdatedAt(ts) {
    try {
      localStorage.setItem(LOCAL_META_KEY, JSON.stringify({ updatedAt: ts }));
    } catch (e) {
      /* localStorage no disponible: la sincronización sigue funcionando, solo sin esta caché. */
    }
  }

  function docRef() {
    return db.collection("agendas").doc(uid);
  }

  function pushNow() {
    if (!db || !uid) return;
    const ts = Date.now();
    // Se guarda ANTES de escribir para que el eco del propio snapshot
    // (onSnapshot dispara también con la escritura local optimista) no
    // se interprete como un cambio remoto más nuevo.
    setLocalUpdatedAt(ts);
    const payload = ns.state.getRawData();
    setStatus("syncing");
    docRef()
      .set({ payload, updatedAt: ts })
      .then(() => setStatus("synced"))
      .catch((err) => {
        console.error("No se pudo guardar en Firebase:", err);
        setStatus("error");
      });
  }

  function schedulePush() {
    if (applyingRemote) return;
    setStatus("syncing");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
  }

  function applyRemote(remote) {
    applyingRemote = true;
    ns.state.replaceAllData(remote.payload);
    applyingRemote = false;
    setLocalUpdatedAt(remote.updatedAt || 0);
  }

  function listenRemote() {
    docRef().onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const remote = snap.data();
        if ((remote.updatedAt || 0) <= getLocalUpdatedAt()) return;
        applyRemote(remote);
        setStatus("synced");
      },
      (err) => {
        console.error("Error al escuchar cambios remotos de Firebase:", err);
        setStatus("error");
      }
    );
  }

  function startSync() {
    docRef()
      .get()
      .then((snap) => {
        const localTs = getLocalUpdatedAt();
        if (snap.exists) {
          const remote = snap.data();
          const remoteTs = remote.updatedAt || 0;
          if (remoteTs > localTs) {
            applyRemote(remote);
          } else if (localTs > remoteTs) {
            pushNow();
          }
        } else {
          pushNow();
        }
        listenRemote();
        ns.state.onPersist(schedulePush);
        setStatus("synced");
      })
      .catch((err) => {
        console.error("No se pudo leer el estado inicial de Firebase:", err);
        setStatus("error");
      });
  }

  function init() {
    if (!window.firebase) {
      console.error("El SDK de Firebase no cargó; la sincronización entre dispositivos no está disponible.");
      setStatus("error");
      return;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    try {
      db.enablePersistence().catch(() => {
        /* Varias pestañas abiertas u otra causa: sigue funcionando, solo sin caché offline. */
      });
    } catch (e) {
      /* enablePersistence no disponible en este navegador: no es crítico. */
    }

    firebase.auth().onAuthStateChanged((user) => {
      if (user && user.uid !== uid) {
        uid = user.uid;
        startSync();
      }
    });
    firebase.auth().signInAnonymously().catch((err) => {
      console.error("No se pudo iniciar sesión anónima en Firebase:", err);
      setStatus("error");
    });
  }

  ns.firebaseSync = {
    getStatus: () => currentStatus,
    onStatusChange: (fn) => statusListeners.push(fn),
  };

  document.addEventListener("DOMContentLoaded", init);
})(window.Agenda);
