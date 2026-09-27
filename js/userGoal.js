/*
 * Meta/evento con fecha fija de una cuenta de onboarding (carrera, examen,
 * viaje, presentación...): generaliza, para cuentas NUEVAS, lo que la
 * cuenta dueña tiene hardcodeado en js/trainingSchedule.js (contador
 * regresivo + racha de corrida). La cuenta dueña sigue usando ese sistema
 * fijo tal cual, sin tocar; este módulo no le aplica.
 *
 * goal = {
 *   activa: true,
 *   nombre: "Carrera 10K",
 *   fecha: "YYYY-MM-DD",
 *   actividad: "Correr",              // se usa como label del bloque
 *   dias: ["mon", "wed", ...],        // DAY_KEYS en las que aparece el bloque
 *   horaInicio: "HH:MM",
 *   horaFin: "HH:MM",
 *   modo: "detiene" | "continua",
 * } | null
 *
 * Solo vive en memoria (como scheduleDefs.userSchedule): userConfigSync.js
 * la carga con setGoal() al iniciar sesión (desde cfg.profile.meta) y la
 * limpia con clearGoal() al cerrar sesión.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const BLOCK_ID = "meta_actividad";
  let goal = null;

  function setGoal(g) {
    goal = g && g.activa ? g : null;
  }

  function clearGoal() {
    goal = null;
  }

  function getGoal() {
    return goal;
  }

  // Si el bloque de esta meta corresponde ese día: el día de la semana
  // tiene que estar elegido y, en modo "detiene", la fecha no puede ser
  // posterior a la del evento (el día del evento sigue mostrándose).
  function isScheduledOn(dateStr) {
    if (!goal) return false;
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr))];
    if (!goal.dias.includes(dayKey)) return false;
    if (goal.modo === "detiene" && dateStr > goal.fecha) return false;
    return true;
  }

  // Definición del bloque (sin texto/cumplido, eso lo agrega state.js con
  // el mismo mecanismo que cualquier bloque flexible): null si esta fecha
  // no corresponde.
  function getBlockForDate(dateStr) {
    if (!isScheduledOn(dateStr)) return null;
    return { id: BLOCK_ID, time: `${goal.horaInicio}–${goal.horaFin}`, label: goal.actividad };
  }

  // Texto del contador regresivo para "hoy": null = no mostrar nada (sin
  // meta activa, o en modo "detiene" ya pasaron más de un día del
  // evento: se apaga del todo, a diferencia del contador fijo de la
  // cuenta dueña que queda mostrando "completada" para siempre).
  function getCountdownText(todayStr) {
    if (!goal) return null;
    const diff = ns.dateUtils.daysBetween(todayStr, goal.fecha);
    if (diff > 0) return `Faltan ${diff} día${diff === 1 ? "" : "s"} para ${goal.nombre}`;
    if (diff === 0) return `¡Hoy es ${goal.nombre}!`;
    if (goal.modo === "detiene" && diff === -1) return "Meta completada";
    if (goal.modo === "detiene") return null; // ya pasó: se apaga
    return null; // "continua": pasada la fecha ya no hay cuenta regresiva, pero el bloque y la racha siguen
  }

  ns.userGoal = { BLOCK_ID, setGoal, clearGoal, getGoal, isScheduledOn, getBlockForDate, getCountdownText };
})(window.Agenda);
