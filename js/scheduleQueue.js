/*
 * Motor genérico de "cola + puntero": convierte una lista ordenada de
 * sesiones (sin fecha asociada) en una proyección día por día, según un
 * puntero que solo avanza cuando se confirma que la sesión pendiente se
 * realizó. Si un día se marca como no realizado (explícita o
 * automáticamente, al congelarse una fecha pasada sin marcar), el
 * puntero no avanza y la misma sesión se corre sola al siguiente día
 * válido — así el horario sigue el orden real de lo hecho, no la fecha
 * calendario.
 *
 * No sabe nada de gimnasio ni de ningún bloque en particular: se
 * reutiliza pasándole la lista de sesiones y la función que decide qué
 * días cuentan como hábiles para esa cola (hoy: gimnasio; más adelante,
 * el mismo motor podría usarse para corrida).
 *
 * queueState = {
 *   pointer: number,          // índice de la próxima sesión pendiente
 *   seedAnchor: "YYYY-MM-DD", // desde qué fecha se simula si no hay resoluciones todavía
 *   resolutions: { [fecha]: { status: "done" | "skipped", index } },
 *   unavailable: { [fecha]: true },
 * }
 *
 * isValidDay(dateStr, idxSoFar) => boolean: si ese día cuenta como día
 * hábil para esta cola (además de no estar en `unavailable`, que ya se
 * revisa acá). Recibe el índice de la cola acumulado hasta ese punto de
 * la simulación por si el llamador necesita decidir con esa información
 * (p. ej. gimnasio solo habilita el sábado cuando hay sesiones
 * atrasadas).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { toISO, fromISO, addDays } = ns.dateUtils;

  function anchorOf(queueState) {
    const dates = Object.keys(queueState.resolutions);
    if (!dates.length) return queueState.seedAnchor;
    const last = dates.reduce((max, d) => (d > max ? d : max));
    return toISO(addDays(fromISO(last), 1));
  }

  // Simula día por día desde el ancla hasta `dateStr` y devuelve qué
  // sesión de la cola le corresponde, sin modificar nada (lectura pura).
  // null = sin datos para esa fecha (anterior al ancla semilla, o cola
  // ya agotada): el bloque debe comportarse como antes (editable manual).
  function resolve(queueState, sessions, dateStr, todayStr, isValidDay) {
    const explicit = queueState.resolutions[dateStr];
    if (explicit) {
      return { index: explicit.index, session: sessions[explicit.index], status: explicit.status };
    }

    let idx = queueState.pointer;
    let cursor = anchorOf(queueState);
    if (cursor > dateStr) return null;

    while (idx < sessions.length) {
      if (cursor > dateStr) return null;
      const valid = isValidDay(cursor, idx) && !queueState.unavailable[cursor];
      if (valid) {
        const isPast = cursor < todayStr;
        if (cursor === dateStr) {
          if (isPast) return { index: idx, session: sessions[idx], status: "skipped" };
          if (cursor === todayStr) return { index: idx, session: sessions[idx], status: "pending" };
          return { index: idx, session: sessions[idx], status: "projected" };
        }
        // Un día pasado sin resolución explícita se congela solo como no
        // realizado (no consume índice); uno futuro se proyecta
        // asumiendo que se va a cumplir, hasta que se sepa lo contrario.
        if (!isPast) idx += 1;
      }
      cursor = toISO(addDays(fromISO(cursor), 1));
    }
    return null; // cola agotada: fuera de rango, comportamiento manual
  }

  // Marca `dateStr` (debe estar "pending", es decir, ser hoy y no tener
  // ya una resolución) como realizada: guarda la resolución y avanza el
  // puntero una posición. Devuelve true si hizo el cambio.
  function markDone(queueState, sessions, dateStr, todayStr, isValidDay) {
    const r = resolve(queueState, sessions, dateStr, todayStr, isValidDay);
    if (!r || r.status !== "pending") return false;
    queueState.resolutions[dateStr] = { status: "done", index: r.index };
    queueState.pointer = r.index + 1;
    return true;
  }

  // Marca `dateStr` (debe estar "pending") como no realizada: el puntero
  // no se mueve, así que la misma sesión se corre sola al siguiente día
  // válido disponible la próxima vez que se simule.
  function markSkipped(queueState, sessions, dateStr, todayStr, isValidDay) {
    const r = resolve(queueState, sessions, dateStr, todayStr, isValidDay);
    if (!r || r.status !== "pending") return false;
    queueState.resolutions[dateStr] = { status: "skipped", index: r.index };
    return true;
  }

  function setUnavailable(queueState, dateStr, unavailable) {
    if (unavailable) queueState.unavailable[dateStr] = true;
    else delete queueState.unavailable[dateStr];
  }

  ns.scheduleQueue = { resolve, markDone, markSkipped, setUnavailable, anchorOf };
})(window.Agenda);
