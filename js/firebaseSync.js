/*
 * Sincronización entre dispositivos vía Firebase (Firestore + Auth por
 * correo/contraseña). Es una capa externa: state.js no sabe que esto
 * existe, solo expone getRawData()/replaceAllData()/onPersist() para que
 * esta capa lea, escriba y reaccione a cambios sin tocar la lógica de la
 * agenda.
 *
 * Modelo: un solo documento por usuario (agendas/{uid}) con todo el
 * bloque de datos ({ payload, updatedAt }), igual de simple que el
 * localStorage actual. Gana el lado con updatedAt más reciente
 * ("last write wins"); no hay merge campo por campo.
 *
 * Sin sesión iniciada, la app sigue funcionando normalmente con
 * localStorage (nada se bloquea); solo no hay sincronización entre
 * dispositivos hasta iniciar sesión.
 *
 * Requiere, del lado de Firebase Console (no se puede hacer desde aquí):
 *   1. Firestore Database creada (modo producción).
 *   2. Authentication → Sign-in method → Correo electrónico/contraseña,
 *      habilitado.
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
  let userEmail = null;
  let applyingRemote = false;
  let pushTimer = null;
  let currentStatus = "connecting";
  const statusListeners = [];
  let loginOverlay = null;
  let syncStarted = false;

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

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
    if (syncStarted) return;
    syncStarted = true;
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
          // Cuenta nueva o primer dispositivo: sube lo que ya hay en local.
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

  function stopSync() {
    syncStarted = false;
    clearTimeout(pushTimer);
  }

  const AUTH_ERROR_MESSAGES = {
    "auth/invalid-email": "Ese correo no es válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo. Usa \"Crear cuenta\" si es la primera vez.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Usa \"Iniciar sesión\".",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a intentar.",
    "auth/network-request-failed": "Sin conexión con el servidor. Intenta de nuevo más tarde.",
  };

  function authErrorMessage(err) {
    return AUTH_ERROR_MESSAGES[err && err.code] || "No se pudo completar la operación. Intenta de nuevo.";
  }

  function openLoginModal() {
    if (loginOverlay) return;

    const emailInput = el("input", {
      type: "email",
      class: "add-input",
      placeholder: "Correo electrónico",
      autocomplete: "email",
    });
    const passwordInput = el("input", {
      type: "password",
      class: "add-input",
      placeholder: "Contraseña",
      autocomplete: "current-password",
    });
    const errorMsg = el("p", { class: "auth-error" });

    function setBusy(busy) {
      emailInput.disabled = busy;
      passwordInput.disabled = busy;
      signInBtn.disabled = busy;
      signUpBtn.disabled = busy;
    }

    function setError(text) {
      errorMsg.textContent = text || "";
    }

    function runAuth(action) {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        setError("Completa correo y contraseña.");
        return;
      }
      if (!window.firebase) {
        setError("Sin conexión con el servidor. Intenta de nuevo más tarde.");
        return;
      }
      setError("");
      setBusy(true);
      Promise.resolve()
        .then(() => action(email, password))
        .then(() => {
          setBusy(false);
          closeLoginModal();
        })
        .catch((err) => {
          console.error("Error de autenticación con Firebase:", err);
          setBusy(false);
          setError(authErrorMessage(err));
        });
    }

    const signInBtn = el(
      "button",
      { class: "btn-primary", onclick: () => runAuth((e, p) => firebase.auth().signInWithEmailAndPassword(e, p)) },
      "Iniciar sesión"
    );
    const signUpBtn = el(
      "button",
      { class: "btn-secondary", onclick: () => runAuth((e, p) => firebase.auth().createUserWithEmailAndPassword(e, p)) },
      "Crear cuenta"
    );

    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") signInBtn.click();
    });

    const dismiss = el(
      "button",
      { class: "auth-dismiss", onclick: () => closeLoginModal() },
      "Usar sin sincronizar por ahora"
    );

    const overlay = el(
      "div",
      { class: "modal-overlay" },
      el(
        "div",
        { class: "modal" },
        el("h3", null, "Sincroniza entre dispositivos"),
        el(
          "p",
          { class: "muted" },
          "Inicia sesión con tu correo para ver tu agenda en todos tus dispositivos. Si es la primera vez, crea una cuenta."
        ),
        emailInput,
        passwordInput,
        errorMsg,
        el("div", { class: "auth-actions" }, signUpBtn, signInBtn),
        dismiss
      )
    );

    loginOverlay = overlay;
    document.body.appendChild(overlay);
    emailInput.focus();
  }

  function closeLoginModal() {
    if (loginOverlay && loginOverlay.parentNode) loginOverlay.parentNode.removeChild(loginOverlay);
    loginOverlay = null;
  }

  function handleSignOut() {
    firebase.auth().signOut();
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
      if (user) {
        uid = user.uid;
        userEmail = user.email;
        closeLoginModal();
        startSync();
      } else {
        uid = null;
        userEmail = null;
        stopSync();
        setStatus("signed-out");
      }
    });
  }

  ns.firebaseSync = {
    getStatus: () => currentStatus,
    onStatusChange: (fn) => statusListeners.push(fn),
    getUserEmail: () => userEmail,
    openLogin: openLoginModal,
    signOut: handleSignOut,
  };

  document.addEventListener("DOMContentLoaded", init);
})(window.Agenda);
