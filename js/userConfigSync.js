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
  let settingsOverlay = null;
  let originalBadgeText = null;
  let originalNameText = null;
  // Última configuración aplicada (para poder abrir la pantalla de
  // Configuración en cualquier momento con los valores actuales, sin
  // tener que releerlos de Firestore cada vez).
  let currentConfig = null;

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
    currentConfig = cfg;
    const badgeEl = document.getElementById("masthead-badge");
    const nameEl = document.getElementById("masthead-name");
    const profile = cfg.profile || {};
    if (nameEl && profile.nombre) nameEl.textContent = profile.nombre;
    if (badgeEl) badgeEl.textContent = profile.iniciales || ns.userConfig.initialsFrom(profile.nombre);
    ns.scheduleDefs.setUserSchedule(cfg.scheduleDefs || null);
    ns.userGoal.setGoal(profile.meta || null);
    ns.palettes.apply(profile.palette || ns.palettes.DEFAULT_PALETTE_ID);
    if (ns.app) ns.app.refreshActive();
  }

  function clearConfig() {
    currentConfig = null;
    const badgeEl = document.getElementById("masthead-badge");
    const nameEl = document.getElementById("masthead-name");
    if (badgeEl && originalBadgeText !== null) badgeEl.textContent = originalBadgeText;
    if (nameEl && originalNameText !== null) nameEl.textContent = originalNameText;
    ns.scheduleDefs.clearUserSchedule();
    ns.userGoal.clearGoal();
    ns.palettes.reset();
    closeOnboarding();
    closeSettings();
    if (ns.app) ns.app.refreshActive();
  }

  // ---------- Asistente de onboarding ----------
  // Solo formularios estructurados (texto simple, hora, botones de
  // opción): nada de texto libre para interpretar, porque no hay IA
  // conectada todavía.
  const TOTAL_STEPS = 9;

  function emptyMeta() {
    return {
      activa: null,
      nombre: "",
      fecha: "",
      actividad: "",
      dias: ["mon", "tue", "wed", "thu", "fri"],
      horaInicio: "",
      horaFin: "",
      modo: "detiene",
    };
  }

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
      meta: emptyMeta(),
      habitos: [],
      palette: ns.palettes.DEFAULT_PALETTE_ID,
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
    // La lista de hábitos del onboarding es solo la siembra inicial (ver
    // más abajo, con state.addHabit): de ahí en más la lista real vive
    // en ns.state (unificada con la Diaria/Semanal), no en este perfil.
    const habitosIniciales = (profile.habitos || []).map((h) => h.trim()).filter(Boolean);
    const cfg = {
      profile: { ...profile, iniciales: ns.userConfig.initialsFrom(profile.nombre), habitos: [] },
      scheduleDefs: scheduleDefsCfg,
      onboarding: { complete: true, step: TOTAL_STEPS },
      updatedAt: Date.now(),
    };
    docRef(uid)
      .set(cfg)
      .then(() => {
        applyConfig(cfg);
        // La lista de hábitos arranca con los 3 de ejemplo del modelo de
        // datos (Meditar/Leer/Ejercicio, pensados para la cuenta dueña
        // original). Como esto corre una sola vez, recién creada la
        // cuenta, se reemplazan por los que haya elegido acá (o queda
        // vacía si no eligió ninguno) en vez de sumarse a esos 3.
        ns.state.getHabitsDefs().forEach((h) => ns.state.removeHabit(h.id));
        habitosIniciales.forEach((h) => ns.state.addHabit(h));
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

  // Campos de la meta/evento con fecha fija: se usan tanto en el paso 6
  // del onboarding como en la pantalla de Configuración (ver
  // buildSettingsMetaSection), por eso `rerender` queda a cargo de quien
  // llama (cada uno redibuja su propio contenedor distinto). Devuelve
  // los elementos a mostrar y un `collect()` que valida y vuelca los
  // valores de vuelta en `meta` (mutándolo), o `false` si falta algo.
  function buildMetaFields(meta, rerender) {
    const elements = [];
    const nombre = el("input", {
      type: "text",
      class: "add-input",
      placeholder: "Ej. Carrera 10K",
      value: meta.nombre,
    });
    elements.push(el("label", { class: "field-label" }, "Nombre del evento/meta"), nombre);

    const fecha = el("input", { type: "date", class: "add-input", value: meta.fecha });
    elements.push(el("label", { class: "field-label" }, "Fecha"), fecha);

    const actividad = el("input", {
      type: "text",
      class: "add-input",
      placeholder: "Ej. Correr, Estudiar",
      value: meta.actividad,
    });
    elements.push(el("label", { class: "field-label" }, "Actividad para prepararte"), actividad);

    elements.push(el("p", { class: "muted" }, "¿Qué días de la semana la vas a realizar?"));
    const dayChips = buildDayChips(meta.dias, (dk) => {
      const idx = meta.dias.indexOf(dk);
      if (idx === -1) meta.dias.push(dk);
      else meta.dias.splice(idx, 1);
    });
    elements.push(dayChips);

    const horaInicio = el("input", { type: "time", class: "add-input", value: meta.horaInicio });
    const horaFin = el("input", { type: "time", class: "add-input", value: meta.horaFin });
    elements.push(el("label", { class: "field-label" }, "Hora de inicio"), horaInicio);
    elements.push(el("label", { class: "field-label" }, "Hora de fin"), horaFin);

    elements.push(
      el("p", { class: "muted" }, "¿Quieres que se detenga el día de la meta, o que continúe indefinidamente?")
    );
    const modoGroup = el("div", { class: "toggle-group" });
    [
      { value: "detiene", label: "Se detiene el día de la meta" },
      { value: "continua", label: "Continúa indefinidamente" },
    ].forEach((opt) => {
      modoGroup.appendChild(
        el(
          "button",
          {
            class: "toggle-btn" + (meta.modo === opt.value ? " active" : ""),
            onclick: () => {
              meta.modo = opt.value;
              rerender();
            },
          },
          opt.label
        )
      );
    });
    elements.push(modoGroup);

    const collect = () => {
      if (!nombre.value.trim() || !fecha.value || !actividad.value.trim() || !meta.dias.length || !horaInicio.value || !horaFin.value) {
        return false;
      }
      meta.nombre = nombre.value.trim();
      meta.fecha = fecha.value;
      meta.actividad = actividad.value.trim();
      meta.horaInicio = horaInicio.value;
      meta.horaFin = horaFin.value;
      return true;
    };
    return { elements, collect };
  }

  // Editor de la lista de hábitos como texto libre (agregar/quitar,
  // 0 o más): se usa en el paso 7 del onboarding (arranca una lista
  // vacía, opcional) y en la pantalla de Configuración (ver
  // buildSettingsHabitsSection, que en cambio opera directo sobre
  // ns.state, ya que ahí la lista real ya existe).
  function buildHabitsDraftEditor(habitos, rerender) {
    const elements = [];
    const list = el("div", { class: "check-list" });
    habitos.forEach((texto, i) => {
      list.appendChild(
        el(
          "div",
          { class: "check-row" },
          el("input", {
            type: "text",
            class: "add-input",
            placeholder: "Ej. Meditar",
            value: texto,
            oninput: (e) => {
              habitos[i] = e.target.value;
            },
          }),
          el(
            "button",
            {
              class: "btn-remove",
              title: "Quitar",
              onclick: () => {
                habitos.splice(i, 1);
                rerender();
              },
            },
            "×"
          )
        )
      );
    });
    elements.push(list);
    elements.push(
      el(
        "button",
        {
          class: "btn-secondary",
          onclick: () => {
            habitos.push("");
            rerender();
          },
        },
        "+ Agregar otro"
      )
    );
    return elements;
  }

  // Selector de paleta de colores: tarjetas con una mini vista previa
  // (círculos con los colores reales) en vez de solo el nombre. Se usa
  // tanto en el paso de onboarding como en Configuración; siempre tiene
  // un valor válido (arranca en la paleta por defecto), así que no hace
  // falta validar al avanzar/guardar.
  function buildPaletteSelector(profile, rerender) {
    const grid = el("div", { class: "palette-grid" });
    ns.palettes.getAll().forEach((p) => {
      const swatches = el(
        "div",
        { class: "palette-swatches" },
        el("span", { class: "palette-swatch", style: `background:${p.vars.bg}` }),
        el("span", { class: "palette-swatch", style: `background:${p.vars.accentGreen}` }),
        el("span", { class: "palette-swatch", style: `background:${p.vars.accentGreenLight}` }),
        el("span", { class: "palette-swatch", style: `background:${p.vars.accentGold}` })
      );
      grid.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "palette-card" + (profile.palette === p.id ? " active" : ""),
            onclick: () => {
              profile.palette = p.id;
              rerender();
            },
          },
          swatches,
          el("span", { class: "palette-name" }, p.nombre)
        )
      );
    });
    return grid;
  }

  // Días de trabajo + franja(s) de oficina: usado por la pantalla de
  // Configuración (ver buildSettingsModal). El paso 2 del onboarding
  // tiene su propia copia de esto (no se tocó, para no arriesgar una
  // regresión en un flujo ya probado).
  function buildOfficeScheduleFields(profile, rerender) {
    const elements = [];
    elements.push(el("p", { class: "muted" }, "¿Qué días trabajás?"));
    elements.push(
      buildDayChips(profile.diasTrabajo, (dk) => {
        const idx = profile.diasTrabajo.indexOf(dk);
        if (idx === -1) profile.diasTrabajo.push(dk);
        else profile.diasTrabajo.splice(idx, 1);
      })
    );

    elements.push(el("p", { class: "muted" }, "¿Una franja continua o dos separadas (ej. mañana y tarde)?"));
    const franjaCountGroup = el("div", { class: "toggle-group" });
    [1, 2].forEach((n) => {
      franjaCountGroup.appendChild(
        el(
          "button",
          {
            class: "toggle-btn" + (profile.franjasOficina.length === n ? " active" : ""),
            onclick: () => {
              const current = profile.franjasOficina;
              profile.franjasOficina =
                n === 1
                  ? [current[0] || { inicio: "", fin: "" }]
                  : [current[0] || { inicio: "", fin: "" }, current[1] || { inicio: "", fin: "" }];
              rerender();
            },
          },
          n === 1 ? "Una franja" : "Dos franjas"
        )
      );
    });
    elements.push(franjaCountGroup);

    const franjaInputs = profile.franjasOficina.map((franja, i) => {
      const inicio = el("input", { type: "time", class: "add-input", value: franja.inicio });
      const fin = el("input", { type: "time", class: "add-input", value: franja.fin });
      elements.push(el("label", { class: "field-label" }, `Franja ${i + 1}: inicio`), inicio);
      elements.push(el("label", { class: "field-label" }, `Franja ${i + 1}: fin`), fin);
      return { inicio, fin };
    });

    const collect = () => {
      if (!profile.diasTrabajo.length) return false;
      for (const { inicio, fin } of franjaInputs) {
        if (!inicio.value || !fin.value) return false;
      }
      profile.franjasOficina = franjaInputs.map(({ inicio, fin }) => ({ inicio: inicio.value, fin: fin.value }));
      return true;
    };
    return { elements, collect };
  }

  // Bloques de tiempo libre/personal: mismo criterio que
  // buildOfficeScheduleFields (usado solo por Configuración; el paso 5
  // del onboarding conserva su propia copia).
  function buildPersonalBlocksFields(profile, rerender) {
    const elements = [];
    elements.push(el("p", { class: "muted" }, "¿Cuántos bloques personales querés definir (hasta 4)?"));
    const countGroup = el("div", { class: "toggle-group" });
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
              rerender();
            },
          },
          String(n)
        )
      );
    });
    elements.push(countGroup);

    const bloqueInputs = profile.bloquesPersonales.map((bloque, i) => {
      const etiqueta = el("input", { type: "text", class: "add-input", placeholder: "Ej. Lectura", value: bloque.etiqueta });
      const inicio = el("input", { type: "time", class: "add-input", value: bloque.inicio });
      const fin = el("input", { type: "time", class: "add-input", value: bloque.fin });
      elements.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: etiqueta`), etiqueta);
      elements.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: inicio`), inicio);
      elements.push(el("label", { class: "field-label" }, `Bloque ${i + 1}: fin`), fin);
      return { etiqueta, inicio, fin };
    });

    const collect = () => {
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
    return { elements, collect };
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
    } else if (stepIndex === 6) {
      body.push(stepTitle("¿Tienes alguna meta o evento con fecha fija?"));
      body.push(el("p", { class: "muted" }, "Ej. una carrera, un examen, un viaje, una presentación. Es opcional."));
      const rerenderMeta = () => {
        overlay.replaceChildren();
        overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
      };
      const group = el("div", { class: "toggle-group" });
      [
        { value: true, label: "Sí" },
        { value: false, label: "No" },
      ].forEach((opt) => {
        group.appendChild(
          el(
            "button",
            {
              class: "toggle-btn" + (profile.meta.activa === opt.value ? " active" : ""),
              onclick: () => {
                profile.meta.activa = opt.value;
                rerenderMeta();
              },
            },
            opt.label
          )
        );
      });
      body.push(group);

      let collectMeta = null;
      if (profile.meta.activa) {
        const { elements, collect } = buildMetaFields(profile.meta, rerenderMeta);
        body.push(...elements);
        collectMeta = collect;
      }

      onNext = () => {
        if (profile.meta.activa === null) return false;
        if (!profile.meta.activa) return true;
        return collectMeta();
      };
    } else if (stepIndex === 7) {
      body.push(stepTitle("¿Qué hábitos quieres darle seguimiento?"));
      body.push(el("p", { class: "muted" }, "Opcional: podés agregarlos después desde la vista Diaria también."));
      const rerenderHabitos = () => {
        overlay.replaceChildren();
        overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
      };
      body.push(...buildHabitsDraftEditor(profile.habitos, rerenderHabitos));
      onNext = () => true;
    } else if (stepIndex === 8) {
      body.push(stepTitle("Elegí tu paleta de colores"));
      body.push(el("p", { class: "muted" }, "Podés cambiarla después desde Configuración."));
      const rerenderPalette = () => {
        overlay.replaceChildren();
        overlay.appendChild(buildModal(stepIndex, profile, goNext, goBack));
      };
      body.push(buildPaletteSelector(profile, rerenderPalette));
      onNext = () => true;
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

  // ---------- Pantalla de Configuración (editar en cualquier momento) ----------
  // A diferencia del onboarding (un asistente paso a paso, solo para la
  // primera vez), esto muestra TODO junto en una sola pantalla para
  // corregirlo cuando sea. Reutiliza los mismos armadores de campos que
  // el onboarding (buildOfficeScheduleFields, buildPersonalBlocksFields,
  // buildMetaFields) para no duplicar esa lógica dos veces.
  function buildSettingsHabitsSection(rerenderSettings) {
    const wrap = el("div", null, el("h4", { class: "pendientes-subtitle" }, "Hábitos"));
    const list = el("div", { class: "check-list" });
    ns.state.getHabitsDefs().forEach((h) => {
      list.appendChild(
        el(
          "div",
          { class: "check-row" },
          el("span", null, h.name),
          el(
            "button",
            {
              class: "btn-remove",
              title: "Quitar",
              onclick: () => {
                ns.state.removeHabit(h.id);
                rerenderSettings();
              },
            },
            "×"
          )
        )
      );
    });
    wrap.appendChild(list);
    const input = el("input", { type: "text", class: "add-input", placeholder: "Nuevo hábito..." });
    const commit = () => {
      if (input.value.trim()) {
        ns.state.addHabit(input.value);
        rerenderSettings();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
    });
    wrap.appendChild(
      el("div", { class: "add-row" }, input, el("button", { class: "btn-primary", onclick: commit }, "Agregar"))
    );
    return wrap;
  }

  // Persiste los cambios de la pantalla de Configuración. `scheduleDefs`
  // solo se regenera para una cuenta de onboarding (horario "flat"): la
  // cuenta dueña (u otra migrada con la estructura de 4 partes) guarda
  // sus respuestas de perfil igual, pero su horario NO se toca — sigue
  // siendo su propio sistema de gimnasio/corrida con progresión, tal
  // cual estaba.
  function saveSettings(profile, isFlatSchedule) {
    const cfg = {
      profile: { ...profile, iniciales: ns.userConfig.initialsFrom(profile.nombre), habitos: [] },
      scheduleDefs: isFlatSchedule ? ns.userConfig.buildScheduleFromOnboarding(profile) : currentConfig.scheduleDefs,
      onboarding: currentConfig.onboarding || { complete: true, step: TOTAL_STEPS },
      updatedAt: Date.now(),
    };
    docRef(uid)
      .set(cfg)
      .then(() => {
        applyConfig(cfg);
        closeSettings();
      })
      .catch((err) => {
        console.error("No se pudo guardar la configuración:", err);
        alert("No se pudo guardar tu configuración. Revisa tu conexión e intenta de nuevo.");
      });
  }

  function buildSettingsBody(profileDraft, isFlatSchedule, rerenderSettings) {
    const body = [];
    body.push(el("h3", null, "Configuración"));

    body.push(el("label", { class: "field-label" }, "Nombre"));
    const nombreInput = el("input", { type: "text", class: "add-input", value: profileDraft.nombre });
    body.push(nombreInput);

    body.push(el("h4", { class: "pendientes-subtitle" }, "Paleta de colores"));
    body.push(buildPaletteSelector(profileDraft, rerenderSettings));

    let officeFields = null;
    let personalFields = null;
    let wakeInput = null;
    let sleepInput = null;
    let mealInput = null;

    if (isFlatSchedule) {
      body.push(el("label", { class: "field-label" }, "Hora de despertar"));
      wakeInput = el("input", { type: "time", class: "add-input", value: profileDraft.horaDespertar });
      body.push(wakeInput);
      body.push(el("label", { class: "field-label" }, "Hora de dormir"));
      sleepInput = el("input", { type: "time", class: "add-input", value: profileDraft.horaDormir });
      body.push(sleepInput);

      body.push(el("h4", { class: "pendientes-subtitle" }, "Horario de oficina/trabajo"));
      officeFields = buildOfficeScheduleFields(profileDraft, rerenderSettings);
      body.push(...officeFields.elements);

      body.push(el("label", { class: "field-label" }, "Hora de comida"));
      mealInput = el("input", { type: "time", class: "add-input", value: profileDraft.horaComida });
      body.push(mealInput);

      body.push(el("h4", { class: "pendientes-subtitle" }, "Bloques de tiempo libre/personal"));
      personalFields = buildPersonalBlocksFields(profileDraft, rerenderSettings);
      body.push(...personalFields.elements);
    } else {
      body.push(
        el(
          "p",
          { class: "muted" },
          "Tu horario de gimnasio/corrida con progresión es su propio sistema y no se edita desde acá."
        )
      );
    }

    body.push(el("h4", { class: "pendientes-subtitle" }, "Meta/evento con fecha"));
    const metaGroup = el("div", { class: "toggle-group" });
    [
      { value: true, label: "Sí" },
      { value: false, label: "No" },
    ].forEach((opt) => {
      metaGroup.appendChild(
        el(
          "button",
          {
            class: "toggle-btn" + (profileDraft.meta.activa === opt.value ? " active" : ""),
            onclick: () => {
              profileDraft.meta.activa = opt.value;
              rerenderSettings();
            },
          },
          opt.label
        )
      );
    });
    body.push(metaGroup);
    let collectMeta = null;
    if (profileDraft.meta.activa) {
      const metaFields = buildMetaFields(profileDraft.meta, rerenderSettings);
      body.push(...metaFields.elements);
      collectMeta = metaFields.collect;
    }

    body.push(buildSettingsHabitsSection(rerenderSettings));

    const errorMsg = el("p", { class: "auth-error" });
    body.push(errorMsg);

    const saveBtn = el(
      "button",
      {
        class: "btn-primary",
        onclick: () => {
          const nombre = nombreInput.value.trim();
          if (!nombre) {
            errorMsg.textContent = "Completa tu nombre.";
            return;
          }
          if (isFlatSchedule) {
            if (!wakeInput.value || !sleepInput.value || !mealInput.value) {
              errorMsg.textContent = "Completa horas de despertar, dormir y comida.";
              return;
            }
            if (!officeFields.collect()) {
              errorMsg.textContent = "Completa los días y horas de tu horario de oficina.";
              return;
            }
            if (!personalFields.collect()) {
              errorMsg.textContent = "Completa etiqueta y horas de cada bloque personal.";
              return;
            }
          }
          if (profileDraft.meta.activa === null) {
            errorMsg.textContent = "Elegí si tenés una meta/evento con fecha (Sí o No).";
            return;
          }
          if (profileDraft.meta.activa && !collectMeta()) {
            errorMsg.textContent = "Completa todos los datos de tu meta/evento.";
            return;
          }
          profileDraft.nombre = nombre;
          if (isFlatSchedule) {
            profileDraft.horaDespertar = wakeInput.value;
            profileDraft.horaDormir = sleepInput.value;
            profileDraft.horaComida = mealInput.value;
          }
          saveSettings(profileDraft, isFlatSchedule);
        },
      },
      "Guardar"
    );
    const cancelBtn = el("button", { class: "btn-secondary", onclick: () => closeSettings() }, "Cerrar");
    body.push(el("div", { class: "auth-actions" }, cancelBtn, saveBtn));

    return el("div", { class: "modal" }, ...body);
  }

  function openSettings() {
    if (!uid || !currentConfig) {
      if (ns.firebaseSync) ns.firebaseSync.openLogin();
      return;
    }
    if (overlay || settingsOverlay) return;
    const profileDraft = Object.assign(emptyProfile(), JSON.parse(JSON.stringify(currentConfig.profile || {})));
    if (!profileDraft.meta) profileDraft.meta = emptyMeta();
    // A diferencia del onboarding (un paso que obliga a elegir Sí/No),
    // acá una cuenta que nunca pasó por ese paso (la dueña, o una de
    // onboarding vieja de antes de esta función) no debería quedar
    // bloqueada para guardar cualquier otro cambio solo por no haber
    // tocado esta sección: sin respuesta previa, se asume "No" por
    // defecto en vez de exigir que la conteste.
    if (profileDraft.meta.activa === null || profileDraft.meta.activa === undefined) {
      profileDraft.meta.activa = false;
    }
    const isFlatSchedule = !!(currentConfig.scheduleDefs && currentConfig.scheduleDefs.flat);

    settingsOverlay = el("div", { class: "modal-overlay" });
    const rerenderSettings = () => {
      settingsOverlay.replaceChildren();
      settingsOverlay.appendChild(buildSettingsBody(profileDraft, isFlatSchedule, rerenderSettings));
    };
    settingsOverlay.appendChild(buildSettingsBody(profileDraft, isFlatSchedule, rerenderSettings));
    document.body.appendChild(settingsOverlay);
  }

  function closeSettings() {
    if (settingsOverlay && settingsOverlay.parentNode) settingsOverlay.parentNode.removeChild(settingsOverlay);
    settingsOverlay = null;
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

  ns.userConfigSync = { openSettings };
})(window.Agenda);
