/*
 * Forma de los datos de configuración por usuario (Etapa 1 de la
 * conversión a multi-usuario) y las dos formas de generarla:
 *
 *   1. buildMigratedOwnerConfig(): migración de la cuenta dueña de esta
 *      app (juanpablosavala@gmail.com) — copia EXACTA de lo que hoy
 *      está fijo en scheduleDefs.js/index.html, para que su horario y
 *      apariencia no cambien ni un poco al pasar a este sistema.
 *   2. buildScheduleFromOnboarding(profile): genera el horario de una
 *      cuenta NUEVA a partir de las respuestas del asistente de
 *      onboarding (js/onboarding.js).
 *
 * El documento vive en Firestore, colección "userConfigs", separado
 * del documento de agenda ("agendas"). Ver js/userConfigSync.js.
 *
 * Los módulos avanzados (progresión de gimnasio, plan de corrida,
 * rotación de lecturas) NO se tocan en esta etapa: siguen viviendo en
 * js/trainingSchedule.js y js/scheduleQueue.js exactamente igual que
 * antes, compartidos por todas las cuentas. Por eso el horario migrado
 * del dueño conserva los ids "gimnasio" y "correr" tal cual, para que
 * esos módulos los sigan reconociendo; el horario generado por
 * onboarding simplemente no incluye esos ids (no le aplica a nadie más
 * todavía).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  // Cuenta dueña de esta app: la única que migra automáticamente con
  // sus valores actuales en vez de pasar por el onboarding.
  const OWNER_EMAIL = "juanpablosavala@gmail.com";

  // Copia exacta de scheduleDefs.js de hoy, como dato en vez de código.
  function buildMigratedOwnerConfig() {
    return {
      profile: {
        nombre: "Juan Pablo Savala",
        iniciales: "JP",
        horaDespertar: "04:00",
        horaDormir: "22:10",
        diasTrabajo: ["mon", "tue", "wed", "thu", "fri"],
        franjasOficina: [
          { inicio: "10:00", fin: "14:00" },
          { inicio: "16:30", fin: "19:00" },
        ],
        horaComida: "14:00",
        tieneRutinaEjercicio: true,
        bloquesPersonales: [
          { inicio: "09:00", fin: "10:00", etiqueta: "Bloque libre / paradas antes de oficina" },
          { inicio: "21:30", fin: "22:10", etiqueta: "Bloque libre" },
        ],
      },
      scheduleDefs: {
        fixedStart: [
          { id: "meditar", time: "04:00–05:40", label: "Meditar / leer" },
          { id: "gimnasio", time: "06:00–07:15 / 07:30", label: "Gimnasio" },
          {
            id: "previo_oficina",
            time: "09:00–10:00",
            label: "Bloque libre / paradas antes de oficina",
            highlight: true,
          },
          { id: "oficina_manana", time: "10:00–14:00", label: "Oficina", fixed: true },
        ],
        cookMidday: [
          { id: "preparar_comida", time: "14:00–15:00", label: "Comida" },
          {
            id: "comer_personal",
            time: "15:00–16:00",
            label: "Comer, lavar platos y bloque personal (lectura, guiones)",
          },
        ],
        noCookMidday: [{ id: "comer_sobras", time: "14:00–16:00", label: "Como (sobras) y descanso corto" }],
        marker: { id: "salida_oficina", time: "16:10", label: "Salir a la oficina", marker: true },
        afternoonFixed: { id: "tarde_oficina", time: "16:30–19:00", label: "Oficina", fixed: true },
        fixedEnd: [
          { id: "correr", time: "19:00–20:00", label: "Correr" },
          { id: "cena", time: "20:00–21:20", label: "Cenar y bañarme", fixed: true },
          { id: "libre_noche", time: "21:30–22:10", label: "Bloque libre" },
        ],
        weekendBlocks: [
          { id: "finde_manana", label: "Mañana" },
          { id: "finde_tarde", label: "Tarde" },
          { id: "finde_noche", label: "Noche" },
        ],
      },
      onboarding: { complete: true, step: 0 },
      updatedAt: Date.now(),
    };
  }

  // Arma el horario de una cuenta nueva a partir de las respuestas del
  // onboarding: una sola lista ordenada por hora de inicio (sin la
  // variante cocino/no cocino de la cuenta dueña, que es un hábito
  // personal suyo, no parte de las preguntas genéricas). Usa los
  // mismos ids "de sistema" (oficina_manana/tarde_oficina/
  // preparar_comida) para que el resto de la app (pendientes de
  // trabajo, selector de comida) los reconozca igual que hoy.
  function buildScheduleFromOnboarding(profile) {
    const items = [];
    const officeIds = ["oficina_manana", "tarde_oficina"];
    (profile.franjasOficina || []).slice(0, 2).forEach((franja, i) => {
      if (!franja || !franja.inicio || !franja.fin) return;
      items.push({
        id: officeIds[i],
        start: franja.inicio,
        time: `${franja.inicio}–${franja.fin}`,
        label: "Oficina",
        fixed: true,
      });
    });
    if (profile.horaComida) {
      items.push({
        id: "preparar_comida",
        start: profile.horaComida,
        time: profile.horaComida,
        label: "Comida",
      });
    }
    (profile.bloquesPersonales || []).slice(0, 4).forEach((b, i) => {
      if (!b || !b.inicio || !b.fin) return;
      items.push({
        id: `personal_${i + 1}`,
        start: b.inicio,
        time: `${b.inicio}–${b.fin}`,
        label: b.etiqueta && b.etiqueta.trim() ? b.etiqueta.trim() : "Bloque personal",
      });
    });
    items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    items.forEach((it) => delete it.start);

    return {
      flat: items,
      weekendBlocks: [
        { id: "finde_manana", label: "Mañana" },
        { id: "finde_tarde", label: "Tarde" },
        { id: "finde_noche", label: "Noche" },
      ],
    };
  }

  function defaultProfile() {
    return {
      nombre: "",
      horaDespertar: "07:00",
      horaDormir: "23:00",
      diasTrabajo: ["mon", "tue", "wed", "thu", "fri"],
      franjasOficina: [{ inicio: "09:00", fin: "17:00" }],
      horaComida: "13:00",
      tieneRutinaEjercicio: false,
      bloquesPersonales: [{ inicio: "19:00", fin: "20:00", etiqueta: "Tiempo personal" }],
    };
  }

  function initialsFrom(nombre) {
    const parts = (nombre || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  ns.userConfig = {
    OWNER_EMAIL,
    buildMigratedOwnerConfig,
    buildScheduleFromOnboarding,
    defaultProfile,
    initialsFrom,
  };
})(window.Agenda);
