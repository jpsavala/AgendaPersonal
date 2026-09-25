/*
 * Configuración por cuenta (Etapa 1 de la conversión a multi-usuario):
 * documento separado del de agenda, en la colección "userConfigs" de
 * Firestore (agendas/{uid} sigue existiendo tal cual, sin tocar).
 *
 * Reutiliza la app de Firebase que ya inicializa js/firebaseSync.js (no
 * vuelve a llamar initializeApp) y escucha el mismo cambio de sesión de
 * forma independiente.
 *
 * Flujo al iniciar sesión:
 *   - Si el documento de configuración de este UID ya existe y está
 *     completo, se aplica: cambia el nombre/iniciales del encabezado y
 *     el horario de la Diaria/Semanal.
 *   - Si existe pero quedó a medias (se cerró el onboarding sin
 *     terminar), retoma el asistente en el paso donde quedó.
 *   - Si no existe:
 *       · la cuenta dueña de esta app (ns.userConfig.OWNER_EMAIL) migra
 *         automáticamente con sus valores actuales, sin pasar por el
 *         onboarding.
 *       · cualquier otra cuenta arranca el onboarding desde cero.
 * Sin sesión iniciada (o mientras Firebase no cargue), la app se queda
 * exactamente como está hoy: nombre y horario fijos del HTML/
 * scheduleDefs.js, sin ningún cambio.
 *
 * Requiere, del lado de Firebase Console (no se puede hacer desde
 * acá): reglas de Firestore que agreguen, junto a la de "agendas/{uid}"
 * que ya existe, una para esta colección nueva:
 *   match /userConfigs/{uid} {
 *     allow read, write: if request.auth != null && request.auth.uid == uid;
 *   }
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const COLLECTION = "userConfigs";
  const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
  const DAY_LABELS_LONG = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  let db = null;
  let uid = null;
  let overlay = null;
  let originalBadgeText = null;
  let originalNameText = null;

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

  function docRef(forUid) {
    return db.collection(COLLECTION).doc(forUid);
  }

  // ---------- Aplicar / quitar configuración en la app ----------
  function applyConfig(cfg) {
    if (!cfg) return;
    const badgeEl = document.getElementById("masthead-badge");
    const nameEl = document.getElementById("masthead-name");
    const profile = cfg.profile || {};
    if (nameEl && profile.nombre) nameEl.textContent = profile.nombre;
    if (badgeEl) badgeEl.textContent = profile.iniciales || ns.userConfig.initialsFrom(profile.nombre);
    ns.scheduleDefs.setUserSchedule(cfg.scheduleDefs || null);
    if (ns.app) ns.app.refreshActive();
  }

  function clearConfig() {
    const badgeEl = document.getElementById("masthead-badge");
    const nameEl = document.getElementById("masthead-name");
    if (badgeEl && originalBadgeText !== null) badgeEl.textContent = originalBadgeText;
    if (nameEl && originalNameText !== null) nameEl.textContent = originalNameText;
    ns.scheduleDefs.clearUserSchedule();
    closeOnboarding();
    if (ns.app) ns.app.refreshActive();
  }

  // ---------- Asistente de onboarding ----------
  // Solo formularios estructurados (texto simple, hora, botones de
  // opción): nada de texto libre para interpretar, porque no hay IA
  // conectada todavía.
  const TOTAL_STEPS = 6;

  function emptyProfile() {
    return {
      nombre: "",
      horaDespertar: "",
      horaDormir: "",
      diasTrabajo: ["mon", "tue", "wed", "thu", "fri"],
      franjasOficina: [{ inicio: "", fin: "" }],
      horaComida: "",
      tieneRutinaEjercicio: null,
      bloquesPersonales: [{ inicio: "", fin: "", etiqueta: "" }],
    };
  }

  function saveProgress(profile, step) {
    docRef(uid).set(
      { profile, onboarding: { complete: false, step }, updatedAt: Date.now() },
      { merge: true }
    );
  }

  function finishOnboarding(profile) {
    const scheduleDefsCfg = ns.userConfig.buildScheduleFromOnboarding(profile);
    const cfg = {
      profile: { ...profile, iniciales: ns.userConfig.initialsFrom(profile.nombre) },
      scheduleDefs: scheduleDefsCfg,
      onboarding: { complete: true, step: TOTAL_STEPS },
      updatedAt: Date.now(),
    };
    docRef(uid)
      .set(cfg)
      .then(() => {
        applyConfig(cfg);
        closeOnboarding();
      })
      .catch((err) => {
        console.error("No se pudo guardar la configuración inicial:", err);
        alert("No se pudo guardar tu configuración. Revisa tu conexión e intenta de nuevo.");
      });
  }

  function buildDayChips(selectedDays, onToggle) {
    const wrap = el("div", { class: "day-checkbox-group" });
    DAY_LETTERS.forEach((letter, i) => {
      const dk = ns.dateUtils.DAY_KEYS[i];
      const checkbox = el("input", {
        type: "checkbox",
        checked: selectedDays.includes(dk) ? "checked" : null,
        onchange: () => onToggle(dk),
      });
      wrap.appendChild(el("label", { class: "day-chip", title: DAY_LABELS_LONG[i] }, checkbox, letter));
    });
    return wrap;
  }

  function stepTitle(text) {
    return el("h3", null, text);
  }

  function renderStep(stepIndex, profile, goNext, goBack) {
    const body = [];
    let onNext = null; // función que valida/completa el paso; si devuelve false, no avanza

    if (stepIndex === 0) {
      body.push(stepTitle("¿Cómo te llamas?"));
      body.push(el("p", { class: "muted" }, "Se usa en el encabezado y para tus iniciales."));
      const input = el("input", {
        type: "text",
        class: "add-input",
        placeholder: "Nombre completo",
        value: profile.nombre,
      });
      body.push(input);
      onNext = () => {
        const trimmed = input.value.trim();
        if (!trimmed) {
          input.focus();
          return false;
        }
        profile.nombre = trimmed;
        return true;
      };
    } else if (stepIndex === 1) {
      body.push(stepTitle("¿A qué hora despertás y a qué hora te acostás?"));
      const wake = el("input", { type: "time", class: "add-input", value: profile.horaDespertar });
      const sleep = el("input", { type: "time", class: "add-input", value: profile.horaDormir });
      body.push(el("label", { class: "field-label" }, "Hora de despertar"), wake);
      body.push(el("label", { class: "field-label" }, "Hora de dormir"), sleep);
      onNext = () => {
        if (!wake.value || !sleep.value) return false;
        profile.horaDespertar = wake.value;
        profile.horaDormir = sleep.value;
        return true;
      };
    } else if (stepIndex === 2) {
      body.push(stepTitle("Horario de oficina/trabajo"));
      body.push(el("p", { class: "muted" }, "¿Qué días trabajás?"));
      const dayChips = buildDayChips(profile.diasTrabajo, (dk) => {
        const idx = profile.diasTrabajo.indexOf(dk);
        if (idx === -1) profile.diasTrabajo.push(dk);
        else profile.diasTrabajo.splice(idx, 1);
      });
      body.push(dayChips);

      body.push(el("p", { class: "muted" }, "¿Tu horario tiene una franja continua o dos separadas (ej. mañana y tarde)?"));
      const franjaCountGroup = el("div", { class: "toggle-group" });
      const rerenderFranjas = () => {
        overlay.replaceChildren();
        overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
      };
      [1, 2].forEach((n) => {
        franjaCountGroup.appendChild(
          el(
            "button",
            {
              class: "toggle-btn" + (profile.franjasOficina.length === n ? " active" : ""),
              onclick: () => {
                const current = profile.franjasOficina;
                profile.franjasOficina =
                  n === 1 ? [current[0] || { inicio: "", fin: "" }] : [current[0] || { inicio: "", fin: "" }, current[1] || { inicio: "", fin: "" }];
                rerenderFranjas();
              },
            },
            n === 1 ? "Una franja" : "Dos franjas"
          )
        );
      });
      body.push(franjaCountGroup);

      const franjaInputs = profile.franjasOficina.map((franja, i) => {
        const inicio = el("input", { type: "time", class: "add-input", value: franja.inicio });
        const fin = el("input", { type: "time", class: "add-input", value: franja.fin });
        body.push(el("label", { class: "field-label" }, `Franja ${i + 1}: inicio`), inicio);
        body.push(el("label", { class: "field-label" }, `Franja ${i + 1}: fin`), fin);
        return { inicio, fin };
      });

      onNext = () => {
        if (!profile.diasTrabajo.length) return false;
        for (const { inicio, fin } of franjaInputs) {
          if (!inicio.value || !fin.value) return false;
        }
        profile.franjasOficina = franjaInputs.map(({ inicio, fin }) => ({ inicio: inicio.value, fin: fin.value }));
        return true;
      };
    } else if (stepIndex === 3) {
      body.push(stepTitle("¿A qué hora comés?"));
      const input = el("input", { type: "time", class: "add-input", value: profile.horaComida });
      body.push(input);
      onNext = () => {
        if (!input.value) return false;
        profile.horaComida = input.value;
        return true;
      };
    } else if (stepIndex === 4) {
      body.push(stepTitle("¿Tenés alguna rutina de ejercicio fija?"));
      body.push(el("p", { class: "muted" }, "Por ahora solo guardamos si tenés o no — el detalle se arma en una etapa aparte."));
      const group = el("div", { class: "toggle-group" });
      [
        { value: true, label: "Sí" },
        { value: false, label: "No" },
      ].forEach((opt) => {
        group.appendChild(
          el(
            "button",
            {
              class: "toggle-btn" + (profile.tieneRutinaEjercicio === opt.value ? " active" : ""),
              onclick: () => {
                profile.tieneRutinaEjercicio = opt.value;
                overlay.replaceChildren();
                overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
              },
            },
            opt.label
          )
        );
      });
      body.push(group);
      onNext = () => profile.tieneRutinaEjercicio !== null;
    } else if (stepIndex === 5) {
      body.push(stepTitle("Bloques de tiempo libre/personal"));
      body.push(el("p", { class: "muted" }, "¿Cuántos querés definir (hasta 4)? Por ejemplo \"Lectura\" u \"Ocio\"."));
      const countGroup = el("div", { class: "toggle-group" });
      const rerenderBloques = () => {
        overlay.replaceChildren();
        overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
      };
      [1, 2, 3, 4].forEach((n) => {
        countGroup.appendChild(
          el(
            "button",
            {
              class: "toggle-btn" + (profile.bloquesPersonales.length === n ? " active" : ""),
              onclick: () => {
                const current = profile.bloquesPersonales;
                const next = [];
                for (let i = 0; i < n; i += 1) next.push(current[i] || { inicio: "", fin: "", etiqueta: "" });
                profile.bloquesPersonales = next;
                rerenderBloques();
              },
            },
            String(n)
          )
        );
      });
      body.push(countGroup);

      const bloqueInputs = profile.bloquesPersonales.map((bloque, i) => {
        const etiqueta = el("input", { type: "text", class: "add-input", placeholder: "Ej. Lectura", value: bloque.etiqueta });
        const inicio = el("input", { type: "time", class: "add-input", value: bloque.inicio });
        const fin = el("input", { type: "time", class: "add-input", value: bloque.fin });
        body.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: etiqueta`), etiqueta);
        body.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: inicio`), inicio);
        body.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: fin`), fin);
        return { etiqueta, inicio, fin };
      });

      onNext = () => {
        for (const { etiqueta, inicio, fin } of bloqueInputs) {
          if (!etiqueta.value.trim() || !inicio.value || !fin.value) return false;
        }
        profile.bloquesPersonales = bloqueInputs.map(({ etiqueta, inicio, fin }) => ({
          etiqueta: etiqueta.value.trim(),
          inicio: inicio.value,
          fin: fin.value,
        }));
        return true;
      };
    }

    const errorMsg = el("p", { class: "auth-error" });
    body.push(errorMsg);

    const isLastStep = stepIndex === TOTAL_STEPS - 1;
    const actions = el(
      "div",
      { class: "auth-actions" },
      stepIndex > 0
        ? el("button", { class: "btn-secondary", onclick: () => goBack() }, "Atrás")
        : null,
      el(
        "button",
        {
          class: "btn-primary",
          onclick: () => {
            const ok = onNext ? onNext() : true;
            if (!ok) {
              errorMsg.textContent = "Completa este paso antes de continuar.";
              return;
            }
            if (isLastStep) finishOnboarding(profile);
            else goNext();
          },
        },
        isLastStep ? "Generar mi horario" : "Siguiente"
      )
    );
    body.push(actions);
    body.push(el("p", { class: "muted" }, `Paso ${stepIndex + 1} de ${TOTAL_STEPS}`));
    return body;
  }

  function buildModal(stepIndex, profile, goNext, goBack) {
    saveProgress(profile, stepIndex);
    return el("div", { class: "modal" }, ...renderStep(stepIndex, profile, goNext, goBack));
  }

  function openOnboarding(initialProfile, initialStep) {
    if (overlay) return;
    let stepIndex = Math.min(Math.max(initialStep || 0, 0), TOTAL_STEPS - 1);
    const profile = Object.assign(emptyProfile(), initialProfile || {});

    overlay = el("div", { class: "modal-overlay" });
    function goNext() {
      stepIndex = Math.min(stepIndex + 1, TOTAL_STEPS - 1);
      overlay.replaceChildren();
      overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
    }
    function goBack() {
      stepIndex = Math.max(stepIndex - 1, 0);
      overlay.replaceChildren();
      overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
    }
    overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
    document.body.appendChild(overlay);
  }

  function closeOnboarding() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  // ---------- Carga al iniciar sesión ----------
  function handleSignedIn(user) {
    uid = user.uid;
    docRef(uid)
      .get()
      .then((snap) => {
        if (snap.exists) {
          const cfg = snap.data();
          if (cfg.onboarding && cfg.onboarding.complete) {
            closeOnboarding();
            applyConfig(cfg);
          } else {
            openOnboarding(cfg.profile, cfg.onboarding && cfg.onboarding.step);
          }
          return;
        }
        if (user.email === ns.userConfig.OWNER_EMAIL) {
          const cfg = ns.userConfig.buildMigratedOwnerConfig();
          docRef(uid)
            .set(cfg)
            .then(() => applyConfig(cfg))
            .catch((err) => console.error("No se pudo migrar la configuración de la cuenta dueña:", err));
          return;
        }
        openOnboarding(null, 0);
      })
      .catch((err) => {
        console.error("No se pudo leer la configuración de la cuenta:", err);
      });
  }

  function handleSignedOut() {
    uid = null;
    clearConfig();
  }

  function init() {
    const badgeEl = document.getElementById("masthead-badge");
    const nameEl = document.getElementById("masthead-name");
    originalBadgeText = badgeEl ? badgeEl.textContent : null;
    originalNameText = nameEl ? nameEl.textContent : null;

    if (!window.firebase) return; // sin Firebase, la app sigue con lo fijo del HTML, sin ningún cambio
    db = firebase.firestore();
    firebase.auth().onAuthStateChanged((user) => {
      if (user) handleSignedIn(user);
      else handleSignedOut();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window.Agenda);
