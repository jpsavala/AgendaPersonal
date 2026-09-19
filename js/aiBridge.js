/*
 * Punto de conexión futuro para la IA que reacomodará la agenda a
 * partir de texto o voz. Todavía no está conectado a ninguna API ni
 * a la interfaz: es solo el lugar donde vivirá esa lógica.
 *
 * Cuando se agregue, un flujo típico sería:
 *   1. Capturar texto/voz del usuario en la UI.
 *   2. Enviarlo a un servicio de IA junto con el estado relevante
 *      (por ejemplo Agenda.state.getDay(fecha) o getWeek(lunes)).
 *   3. Traducir la respuesta de la IA en llamadas a las funciones ya
 *      existentes de Agenda.state (setHourText, addPriority,
 *      toggleDayHabit, addEvent, etc.) para que la app y el
 *      almacenamiento no cambien.
 *
 * Por eso todas las mutaciones de datos en la app pasan únicamente
 * por Agenda.state.*: esa es la API que la IA deberá usar.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  function applyAgendaChanges() {
    throw new Error("Integración de IA aún no implementada. Ver comentarios de este archivo.");
  }

  ns.aiBridge = { applyAgendaChanges };
})(window.Agenda);
