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
    // Plan actualizado (5 oct - 29 nov 2026): reemplaza por completo lo
    // que había de acá en adelante. Semana 16-22 nov = "baja carga",
    // semana 23-29 nov = "taper" (sufijo entre paréntesis en cada sesión
    // de esa semana, mismo criterio que ya se usaba para "(descarga)").
    "2026-10-07": "Correr - 3.5km lento",
    "2026-10-09": "Correr - 3km lento",
    "2026-10-14": "Correr - 4km lento + 4 rectas de 20s",
    "2026-10-16": "Correr - 3.5km lento",
    "2026-10-21": "Correr - 4.5km lento + 4 rectas de 20s",
    "2026-10-23": "Correr - 4km lento",
    "2026-10-28": "Correr - 5km lento + 4 rectas de 20s",
    "2026-10-30": "Correr - 4.5km lento",
    "2026-11-04": "Correr - 5.5km lento + 4 rectas de 20s",
    "2026-11-06": "Correr - 5km lento",
    "2026-11-11": "Correr - 5km lento + 4 rectas de 20s",
    "2026-11-13": "Correr - 5km lento",
    "2026-11-18": "Correr - 4km lento + 4 rectas de 20s (baja carga)",
    "2026-11-20": "Correr - 4km lento (baja carga)",
    "2026-11-25": "Correr - 3km lento + 4 rectas de 20s (taper)",
    "2026-11-27": "Correr - 3km muy suave (taper)",
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
    // Plan actualizado (5 oct - 29 nov 2026), igual que RUN_WEEKDAY_TEXT:
    // el 15 nov es el ensayo (fecha fija) y el 29 nov es la carrera
    // (fecha fija), ambos marcados en el texto para que se vean igual en
    // cualquier vista que use getSundayRunText.
    "2026-10-11": "4.5km lento",
    "2026-10-18": "5.5km lento",
    "2026-10-25": "6.5km lento",
    "2026-11-01": "7.5km lento",
    "2026-11-08": "8.5km lento",
    "2026-11-15": "10km lento (ENSAYO)",
    "2026-11-22": "6.5km lento (baja carga)",
    "2026-11-29": "🏁 CARRERA 10K",
  };

  // Texto de corrida del domingo para el checklist de fin de semana.
  // Solo aplica si la fecha misma es domingo (no cualquier día de esa
  // semana).
  function getSundayRunText(dateStr) {
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (dayKey !== "sun") return undefined;
    return RUN_SUNDAYS[dateStr];
  }

  // ---------- Excepción: corrida de mañana del 30 de septiembre ----------
  // Único día de todo el plan en el que la corrida NO va en el bloque de
  // la tarde (19:00, queda vacío/oculto vía RUN_WEEKDAY_TEXT arriba, en
  // ""): esa semana el gimnasio corrido hizo que ese miércoles quedara
  // mejor justo después del gimnasio, a la mañana. Es un bloque fijo más
  // en la línea de tiempo (mismo id "correr", así que comparte la
  // casilla de "hecho" y entra en la racha con getProgrammedRunDates
  // como cualquier otro día con corrida), inyectado aparte en
  // state.getDayBlocks porque no encaja en la grilla fija de horarios de
  // siempre. Ningún otro día usa este bloque especial de mañana.
  const SPECIAL_MORNING_RUN = {
    "2026-09-30": "Correr - 3.5km lento",
  };

  function getSpecialMorningRunText(dateStr) {
    return SPECIAL_MORNING_RUN[dateStr];
  }

  // ---------- Contador regresivo a la carrera ----------
  const RACE_DATE = "2026-11-29";

  function getRaceCountdownInfo(todayStr) {
    const diff = ns.dateUtils.daysBetween(todayStr, RACE_DATE);
    if (diff > 0) return { text: `Faltan ${diff} día${diff === 1 ? "" : "s"} para tu 10K`, state: "upcoming" };
    if (diff === 0) return { text: "¡Hoy es tu carrera! 🏁", state: "today" };
    return { text: "Carrera completada 🎉", state: "done" };
  }

  // ---------- Fechas con corrida programada (para la racha) ----------
  // Junta los miércoles/viernes entre semana que sí tienen corrida (no
  // los vacíos) con los domingos de carrera larga, hasta "uptoStr"
  // inclusive, en orden cronológico. state.js la recorre para calcular
  // la racha sin tener que conocer estas dos tablas.
  function getProgrammedRunDates(uptoStr) {
    const weekdayDates = Object.keys(RUN_WEEKDAY_TEXT).filter((d) => RUN_WEEKDAY_TEXT[d]);
    const sundayDates = Object.keys(RUN_SUNDAYS);
    const specialDates = Object.keys(SPECIAL_MORNING_RUN);
    return weekdayDates
      .concat(sundayDates)
      .concat(specialDates)
      .filter((d) => d <= uptoStr)
      .sort();
  }

  ns.trainingSchedule = {
    getRunText,
    getSundayRunText,
    getSpecialMorningRunText,
    getRaceCountdownInfo,
    getProgrammedRunDates,
  };
})(window.Agenda);
