/*
 * Tabla fija de gimnasio y corrida. Mientras una fecha caiga dentro del
 * rango programado, el bloque correspondiente se vuelve de solo lectura
 * (texto calculado); fuera de rango, las funciones devuelven `undefined`
 * y el bloque se queda editable como antes.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  // ---------- Gimnasio (entre semana, se repite igual cada semana) ----------
  const GYM_LABELS = {
    mon: "Torso",
    tue: "Pierna - Glúteo/Femoral",
    wed: "Empuje",
    thu: "Pierna - Cuádriceps",
    fri: "Tracción",
  };
  const GYM_START = "2026-09-21";
  const GYM_END = "2026-10-18"; // último día del rango programado (semana de descarga incluida)
  const GYM_DESCARGA_START = "2026-10-12";

  function getGymText(dateStr) {
    if (dateStr < GYM_START || dateStr > GYM_END) return undefined;
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    const base = GYM_LABELS[dayKey];
    if (!base) return undefined; // fin de semana: no aplica a este bloque
    const isDescarga = dateStr >= GYM_DESCARGA_START;
    return isDescarga ? `${base} (descarga)` : base;
  }

  // ---------- Corrida (por semana calendario específica) ----------
  // Clave = lunes ISO de esa semana.
  const RUN_WEEKS = {
    "2026-09-21": { wed: "3km lento", fri: "2.5km lento", sun: "3.5km lento" },
    "2026-09-28": { wed: "3.5km lento", fri: "3km lento", sun: "4.5km lento" },
    "2026-10-05": { wed: "4km lento + 4 rectas de 20seg", fri: "3.5km lento", sun: "5.5km lento" },
    "2026-10-12": { wed: "3km lento", fri: "3km lento", sun: "4km lento" },
    "2026-10-19": { wed: "4.5km lento + 4 rectas de 20seg", fri: "4km lento", sun: "6.5km lento" },
    "2026-10-26": { wed: "5km lento + 4 rectas de 20seg", fri: "4.5km lento", sun: "7.5km lento" },
    "2026-11-02": { wed: "5.5km lento + 4 rectas de 20seg", fri: "5km lento", sun: "8.5km lento" },
    "2026-11-09": { wed: "5km lento + 4 rectas de 20seg", fri: "5km lento", sun: "10km lento (ensayo, sin parar)" },
    "2026-11-16": { wed: "4km lento + 4 rectas de 20seg", fri: "4km lento", sun: "6.5km lento" },
    "2026-11-23": { wed: "3km lento + 4 rectas de 20seg", fri: "3km muy suave", sun: "🏁 Carrera 10K" },
  };

  function getRunWeek(dateStr) {
    const mondayStr = ns.dateUtils.toISO(ns.dateUtils.getMonday(ns.dateUtils.fromISO(dateStr)));
    return RUN_WEEKS[mondayStr];
  }

  // Bloque de corrida de la vista diaria entre semana (lunes a viernes).
  // undefined = fuera del programa (bloque editable); "" = dentro del
  // programa pero sin corrida ese día (queda vacío/oculto); string =
  // distancia programada.
  function getRunText(dateStr) {
    const week = getRunWeek(dateStr);
    if (!week) return undefined;
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (dayKey === "wed") return week.wed;
    if (dayKey === "fri") return week.fri;
    if (dayKey === "mon" || dayKey === "tue" || dayKey === "thu") return "";
    return undefined; // sábado/domingo: ese bloque no existe en esos días
  }

  // Texto de corrida del domingo para el checklist de fin de semana.
  // Solo aplica si la fecha misma es domingo (no cualquier día de esa
  // semana).
  function getSundayRunText(dateStr) {
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (dayKey !== "sun") return undefined;
    const week = getRunWeek(dateStr);
    return week ? week.sun : undefined;
  }

  ns.trainingSchedule = { getGymText, getRunText, getSundayRunText };
})(window.Agenda);
