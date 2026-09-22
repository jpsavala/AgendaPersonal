/*
 * Tabla fija de corrida entre semana (miércoles y viernes, por fecha
 * exacta) y de los domingos de carrera (checklist de fin de semana).
 * Mientras una fecha caiga dentro del rango programado, el bloque
 * correspondiente se vuelve de solo lectura (texto calculado); fuera de
 * rango, las funciones devuelven `undefined` y el bloque se queda
 * editable como antes.
 *
 * El gimnasio YA NO vive acá: se calcula con el motor de cola + puntero
 * de js/scheduleQueue.js (ver getGymResolution en js/state.js), porque
 * sigue el orden real de lo hecho en vez de una fecha fija.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  // ---------- Corrida entre semana (miércoles y viernes) ----------
  // Clave = fecha exacta. "" = ese día no hay corrida (queda vacío/
  // oculto, no "editable"); ausente = fuera del rango programado
  // (bloque editable a mano).
  const RUN_WEEKDAY_TEXT = {
    "2026-09-23": "Correr - 3km lento",
    "2026-09-25": "Correr - 2.5km lento",
    "2026-09-30": "",
    "2026-10-02": "Correr - 3km lento",
    "2026-10-07": "Correr - 4km lento + 4 rectas de 20s",
    "2026-10-09": "Correr - 3.5km lento",
    "2026-10-14": "Correr - 3km lento (descarga)",
    "2026-10-16": "Correr - 3km lento (descarga)",
    "2026-10-21": "Correr - 4.5km lento + 4 rectas de 20s",
    "2026-10-23": "Correr - 4km lento",
    "2026-10-28": "Correr - 5km lento + 4 rectas de 20s",
    "2026-10-30": "Correr - 4.5km lento",
    "2026-11-04": "Correr - 5.5km lento + 4 rectas de 20s",
    "2026-11-06": "Correr - 5km lento",
    "2026-11-11": "Correr - 5km lento + 4 rectas de 20s",
    "2026-11-13": "Correr - 5km lento",
    "2026-11-18": "Correr - 4km lento + 4 rectas de 20s",
    "2026-11-20": "Correr - 4km lento",
    "2026-11-25": "Correr - 3km lento + 4 rectas de 20s",
    "2026-11-27": "Correr - 3km muy suave",
  };

  // Bloque de corrida de la vista diaria entre semana (lunes a viernes,
  // 19:00-20:00). Lunes, martes y jueves nunca tienen corrida (siempre
  // vacío/oculto, sin depender de ningún rango). Miércoles y viernes
  // solo son de solo lectura dentro del rango de RUN_WEEKDAY_TEXT; fuera
  // de esa tabla, el bloque vuelve a ser editable a mano.
  function getRunText(dateStr) {
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (dayKey === "sat" || dayKey === "sun") return undefined; // ese bloque no existe esos días
    if (dayKey === "mon" || dayKey === "tue" || dayKey === "thu") return "";
    if (Object.prototype.hasOwnProperty.call(RUN_WEEKDAY_TEXT, dateStr)) return RUN_WEEKDAY_TEXT[dateStr];
    return undefined; // miércoles/viernes fuera del rango programado
  }

  // ---------- Domingo de carrera larga (checklist de fin de semana) ----------
  // Clave = fecha exacta del domingo.
  const RUN_SUNDAYS = {
    "2026-09-27": "3.5km lento",
    "2026-10-04": "4.5km lento",
    "2026-10-11": "5.5km lento",
    "2026-10-18": "4km lento",
    "2026-10-25": "6.5km lento",
    "2026-11-01": "7.5km lento",
    "2026-11-08": "8.5km lento",
    "2026-11-15": "10km lento (ensayo, sin parar)",
    "2026-11-22": "6.5km lento",
    "2026-11-29": "🏁 Carrera 10K",
  };

  // Texto de corrida del domingo para el checklist de fin de semana.
  // Solo aplica si la fecha misma es domingo (no cualquier día de esa
  // semana).
  function getSundayRunText(dateStr) {
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (dayKey !== "sun") return undefined;
    return RUN_SUNDAYS[dateStr];
  }

  ns.trainingSchedule = { getRunText, getSundayRunText };
})(window.Agenda);
