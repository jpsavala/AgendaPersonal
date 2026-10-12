/*
 * Corrida como lista "semi inteligente" con puntero, mismo estilo que
 * js/scheduleQueue.js (motor de cola+puntero del gimnasio), pero con
 * reglas propias de avance: a diferencia del gimnasio (que solo corre la
 * misma sesión pendiente al siguiente día válido cuando se pierde una),
 * acá una falta puede descartar la sesión, repetirla, repetir toda la
 * semana anterior, o retroceder el puntero, según cuántos días de parón
 * haya — ver PARTE B del pedido original.
 *
 * Alcance de este motor: SOLO las 17 sesiones "deslizantes" entre el
 * miércoles 7 de octubre y el viernes 13 de noviembre de 2026 (mié/vie/
 * dom de esas semanas). El domingo 15 nov (ensayo) y todo del 18 al 29
 * de nov (incluida la carrera) quedan fijos e inamovibles — eso lo sigue
 * manejando js/trainingSchedule.js exactamente como ya estaba, sin
 * pasar por este motor en absoluto.
 *
 * Las FECHAS/ranuras nunca cambian (siempre miércoles, viernes y
 * domingo, en ese orden, del 7 oct al 13 nov): lo único que se desliza
 * es qué SESIÓN (km + tipo) le toca a cada una, según el puntero.
 *
 * queueState = { resolutions: { [fecha]: { status: "done"|"skipped",
 *   text, km, rectas, badge, baselineIndex } } }
 *
 * El estado de cada fecha es siempre "status" + una foto de la sesión
 * que le tocó en el momento de resolverse (igual que scheduleQueue.js
 * guarda {status, index}): así una fecha ya confirmada nunca cambia de
 * texto sola si algo antes se corrige — ver editResolution más abajo,
 * que detecta ese choque y lo rechaza en vez de pisarlo en silencio.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { toISO, fromISO, addDays, daysBetween } = ns.dateUtils;

  const FIRST_SLOT_DATE = "2026-10-07";
  const LAST_SLIDING_DATE = "2026-11-13";

  // Las 17 sesiones deslizantes, en el orden original del plan vigente
  // (ver la tarea de actualización del plan: mismos textos exactos).
  // "week" agrupa cada corta/corta/larga para la regla de "repetir toda
  // la semana anterior" (parón de 5-6 días) — la semana 5 (Nov 11/13)
  // queda incompleta a propósito: el domingo que le seguiría es el
  // ensayo fijo del 15 nov, fuera de este motor.
  const BASELINE = [
    { date: "2026-10-07", slot: "wed", week: 0, km: 3.5, rectas: false, text: "Correr - 3.5km lento" },
    { date: "2026-10-09", slot: "fri", week: 0, km: 3, rectas: false, text: "Correr - 3km lento" },
    { date: "2026-10-11", slot: "sun", week: 0, km: 4.5, rectas: false, text: "Correr - 4.5km lento" },
    { date: "2026-10-14", slot: "wed", week: 1, km: 4, rectas: true, text: "Correr - 4km lento + 4 rectas 20 s" },
    { date: "2026-10-16", slot: "fri", week: 1, km: 3.5, rectas: false, text: "Correr - 3.5km lento" },
    { date: "2026-10-18", slot: "sun", week: 1, km: 5.5, rectas: false, text: "Correr - 5.5km lento" },
    { date: "2026-10-21", slot: "wed", week: 2, km: 4.5, rectas: true, text: "Correr - 4.5km lento + 4 rectas 20 s" },
    { date: "2026-10-23", slot: "fri", week: 2, km: 4, rectas: false, text: "Correr - 4km lento" },
    { date: "2026-10-25", slot: "sun", week: 2, km: 6.5, rectas: false, text: "Correr - 6.5km lento" },
    { date: "2026-10-28", slot: "wed", week: 3, km: 5, rectas: true, text: "Correr - 5km lento + 4 rectas 20 s" },
    { date: "2026-10-30", slot: "fri", week: 3, km: 4.5, rectas: false, text: "Correr - 4.5km lento" },
    { date: "2026-11-01", slot: "sun", week: 3, km: 7.5, rectas: false, text: "Correr - 7.5km lento" },
    { date: "2026-11-04", slot: "wed", week: 4, km: 5.5, rectas: true, text: "Correr - 5.5km lento + 4 rectas 20 s" },
    { date: "2026-11-06", slot: "fri", week: 4, km: 5, rectas: false, text: "Correr - 5km lento" },
    { date: "2026-11-08", slot: "sun", week: 4, km: 8.5, rectas: false, text: "Correr - 8.5km lento" },
    { date: "2026-11-11", slot: "wed", week: 5, km: 5, rectas: true, text: "Correr - 5km lento + 4 rectas 20 s" },
    { date: "2026-11-13", slot: "fri", week: 5, km: 5, rectas: false, text: "Correr - 5km lento" },
  ];

  // Distancia "segura" para el último domingo deslizante (8 nov, en el
  // plan sin faltas): el salto de ahí al ensayo de 10km (15 nov) ya es
  // de +1.5km, el tope que permite la compresión. Si al terminar la
  // reproyección el último domingo deslizante queda por debajo de esto,
  // ni comprimiendo al tope se llega de forma segura al ensayo.
  const SAFE_LAST_LONG_RUN_KM = 8.5;
  const MAX_WEEKLY_JUMP_KM = 1.5;

  const BADGE_LABELS = {
    repite: "Repite sesión anterior",
    ajustada: "Ajustada por parón",
    retrocedida: "Retrocede por parón",
  };

  function slotTypeOf(dateStr) {
    const dayKey = ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(fromISO(dateStr))];
    if (dayKey === "wed" || dayKey === "fri" || dayKey === "sun") return dayKey;
    return null;
  }

  function nextDay(dateStr) {
    return toISO(addDays(fromISO(dateStr), 1));
  }

  // Intervalo normal (en días) hasta la SIGUIENTE ranura del ciclo
  // mié→vie→dom→mié..., según el tipo de la última corrida cumplida.
  function normalIntervalAfter(slotType) {
    return slotType === "sun" ? 3 : 2;
  }

  function isManagedDate(dateStr) {
    return dateStr >= FIRST_SLOT_DATE && dateStr <= LAST_SLIDING_DATE && !!slotTypeOf(dateStr);
  }

  function formatKm(km) {
    const rounded = Math.round(km * 10) / 10;
    return String(rounded);
  }

  // Sesión de relleno cuando la cola de 17 ya se agotó (muy poco común:
  // solo pasa si hubo varias semanas repetidas/retrocedidas de más).
  // Domingo: sube hasta +1.5km de la última corrida larga cumplida (o de
  // la base si no hay ninguna). Entre semana: repite sin más el último
  // texto corto conocido, sin inventar progresión.
  function compress(lastDone, slotType) {
    if (slotType === "sun") {
      const prevKm = lastDone ? lastDone.km : BASELINE[0].km;
      const km = Math.round((prevKm + MAX_WEEKLY_JUMP_KM) * 10) / 10;
      return { text: `Correr - ${formatKm(km)}km lento`, km, rectas: false };
    }
    if (lastDone) return { text: lastDone.text, km: lastDone.km, rectas: lastDone.rectas };
    return { text: BASELINE[0].text, km: BASELINE[0].km, rectas: BASELINE[0].rectas };
  }

  // Decide qué sesión le toca a la ranura `d` (sin mirar si ya tiene una
  // resolución explícita guardada: eso lo resuelve project() después).
  // Devuelve también cómo quedan cursor/insertQueue para la ranura
  // siguiente, así project() puede ir encadenando la simulación.
  function decideSession(cursor, insertQueue, lastDone, d, slotType) {
    if (insertQueue.length) {
      const [next, ...rest] = insertQueue;
      return { session: next, badge: next.badge, baselineIndex: next.baselineIndex, cursor, insertQueue: rest };
    }

    let badge = null;
    let newCursor = cursor;

    if (lastDone) {
      const gap = daysBetween(lastDone.date, d) - normalIntervalAfter(lastDone.slotType);
      if (gap >= 7) {
        // 7+ días: retrocede una semana (3 sesiones) en la progresión por
        // cada semana completa perdida — nunca repite, retrocede.
        const weeksLost = Math.floor(gap / 7);
        newCursor = Math.max(0, cursor - weeksLost * 3);
        badge = "retrocedida";
      } else if (gap >= 5) {
        // 5-6 días: repite las 3 sesiones de la semana anterior completa
        // (corta, corta, larga) antes de retomar la cola donde iba.
        const week = BASELINE[lastDone.index] ? BASELINE[lastDone.index].week : 0;
        const weekSessions = BASELINE.filter((s) => s.week === week);
        const queue = weekSessions.map((s) => ({
          text: s.text,
          km: s.km,
          rectas: s.rectas,
          badge: "ajustada",
          baselineIndex: BASELINE.indexOf(s),
        }));
        const [next, ...rest] = queue;
        return { session: next, badge: next.badge, baselineIndex: next.baselineIndex, cursor, insertQueue: rest };
      } else if (gap >= 3) {
        // 3-4 días: la siguiente salida repite la última cumplida (sin
        // rectas si esa no las tenía); lo posterior se recorre una
        // ranura, así que el cursor normal NO avanza acá.
        const session = { text: lastDone.text, km: lastDone.km, rectas: lastDone.rectas };
        return { session, badge: "repite", baselineIndex: lastDone.index, cursor, insertQueue };
      }
      // gap <= 2 (o negativo): una sola salida perdida, no se repone; se
      // descarta y sigue el flujo normal de acá abajo sin marca especial.
    }

    if (newCursor < BASELINE.length) {
      const session = BASELINE[newCursor];
      return { session, badge, baselineIndex: newCursor, cursor: newCursor + 1, insertQueue };
    }

    // Cola de 17 agotada (caso raro): comprime en vez de dejar la ranura
    // vacía; el aviso de riesgo (ver project()) se calcula aparte, mirando
    // si el último domingo deslizante quedó cerca del ensayo o no.
    const compressed = compress(lastDone, slotType);
    return { session: compressed, badge: "ajustada", baselineIndex: null, cursor: newCursor, insertQueue };
  }

  // Simula las 17 ranuras en orden desde FIRST_SLOT_DATE, usando lo ya
  // resuelto explícitamente (resolutions) tal cual quedó guardado (nunca
  // le cambia el texto solo) y calculando el resto. `todayStr` decide
  // qué ranuras sin resolver cuentan como "pending" (hoy), "skipped"
  // (pasó sin marcarse) o "projected" (todavía no llega).
  function project(resolutions, todayStr) {
    let cursor = 0;
    let insertQueue = [];
    let lastDone = null;
    const entries = [];

    let d = FIRST_SLOT_DATE;
    while (d <= LAST_SLIDING_DATE) {
      const slotType = slotTypeOf(d);
      if (slotType) {
        const decision = decideSession(cursor, insertQueue, lastDone, d, slotType);
        cursor = decision.cursor;
        insertQueue = decision.insertQueue;

        const explicit = resolutions[d];
        const isPast = d < todayStr;
        const status = explicit ? explicit.status : d === todayStr ? "pending" : isPast ? "skipped" : "projected";
        const session = explicit ? { text: explicit.text, km: explicit.km, rectas: explicit.rectas } : decision.session;
        const badge = explicit ? explicit.badge || null : decision.badge;
        const baselineIndex = explicit ? explicit.baselineIndex : decision.baselineIndex;

        // freshBaselineIndex es lo que decideSession() calcularía ACÁ
        // mismo si esta fecha no tuviera nada guardado todavía — se
        // expone aparte de "baselineIndex" (que respeta lo ya guardado)
        // para que editResolution pueda comparar, sin volver a tocar
        // nada: si corregir una fecha ANTERIOR hace que esto deje de
        // coincidir con lo guardado en una fecha POSTERIOR ya resuelta,
        // es un choque real (ver editResolution).
        entries.push({
          date: d,
          slot: slotType,
          session,
          status,
          badge,
          baselineIndex,
          freshBaselineIndex: decision.baselineIndex,
        });
        // "lastDone" en realidad es "la última ranura que cuenta como
        // punto de referencia para el parón": una confirmada (done) o
        // una que todavía no se sabe si se va a cumplir (pending/
        // projected, se asume que sí hasta que se sepa lo contrario,
        // mismo criterio que ya usa scheduleQueue.js). Solo una perdida
        // confirmada (skipped) NO cuenta, para que el parón se siga
        // midiendo desde ahí y no seguir acumulando sobre fechas futuras
        // que ni siquiera llegaron todavía.
        if (status !== "skipped") {
          lastDone = { index: baselineIndex, date: d, slotType, text: session.text, km: session.km, rectas: !!session.rectas };
        }
      }
      d = nextDay(d);
    }

    const sundayEntries = entries.filter((e) => e.slot === "sun" && e.session);
    const lastSunday = sundayEntries.length ? sundayEntries[sundayEntries.length - 1] : null;
    const risk = !lastSunday || lastSunday.session.km < SAFE_LAST_LONG_RUN_KM;

    return { entries, risk, lastSundayKm: lastSunday ? lastSunday.session.km : null };
  }

  function resolve(queueState, dateStr, todayStr) {
    if (!isManagedDate(dateStr)) return null;
    const { entries } = project(queueState.resolutions || {}, todayStr);
    return entries.find((e) => e.date === dateStr) || null;
  }

  function getProjection(queueState, todayStr) {
    return project(queueState.resolutions || {}, todayStr);
  }

  function markDoneAt(queueState, dateStr, todayStr) {
    if (!queueState.resolutions) queueState.resolutions = {};
    const entry = resolve(queueState, dateStr, todayStr);
    if (!entry || entry.status !== "pending") return false;
    queueState.resolutions[dateStr] = {
      status: "done",
      text: entry.session.text,
      km: entry.session.km,
      rectas: !!entry.session.rectas,
      badge: entry.badge,
      baselineIndex: entry.baselineIndex,
    };
    return true;
  }

  function markSkippedAt(queueState, dateStr, todayStr) {
    if (!queueState.resolutions) queueState.resolutions = {};
    const entry = resolve(queueState, dateStr, todayStr);
    if (!entry || entry.status !== "pending") return false;
    queueState.resolutions[dateStr] = {
      status: "skipped",
      text: entry.session.text,
      km: entry.session.km,
      rectas: !!entry.session.rectas,
      badge: entry.badge,
      baselineIndex: entry.baselineIndex,
    };
    return true;
  }

  // Corrige una fecha ya resuelta (igual que scheduleQueue.editResolution
  // para el gimnasio, pero comparando "qué le tocaría de verdad a cada
  // fecha posterior ya confirmada" en vez de un índice simple, porque
  // acá sí importa el historial completo de hecho/perdido para calcular
  // el parón). Deja TODO lo demás guardado tal cual (no se excluye nada:
  // sería dar por perdidas fechas posteriores que en realidad ya están
  // confirmadas) y solo cambia el status de `dateStr`; si al volver a
  // simular con ese único cambio alguna fecha posterior ya confirmada
  // terminaría necesitando otra sesión distinta a la que tiene guardada
  // (freshBaselineIndex ya no coincide con lo guardado), no se aplica
  // nada — se devuelve el choque para que la UI lo muestre y la persona
  // corrija esas fechas primero, nunca se pisa en silencio.
  function editResolution(queueState, dateStr, todayStr, newStatus) {
    if (!queueState.resolutions) queueState.resolutions = {};
    const current = resolve(queueState, dateStr, todayStr);
    if (!current || (current.status !== "done" && current.status !== "skipped")) {
      return { ok: false, reason: "not-resolved" };
    }
    if (current.status === newStatus) return { ok: true, changed: false };

    const laterDates = Object.keys(queueState.resolutions)
      .filter((d) => d > dateStr)
      .sort();

    const trialResolutions = { ...queueState.resolutions };
    trialResolutions[dateStr] = {
      status: newStatus,
      text: current.session.text,
      km: current.session.km,
      rectas: !!current.session.rectas,
      badge: current.badge,
      baselineIndex: current.baselineIndex,
    };

    const trial = project(trialResolutions, todayStr);
    const conflicts = [];
    laterDates.forEach((d) => {
      const old = queueState.resolutions[d];
      const fresh = trial.entries.find((e) => e.date === d);
      const matches = fresh && fresh.freshBaselineIndex === old.baselineIndex;
      if (!matches) {
        conflicts.push({
          date: d,
          oldSession: old.text,
          oldStatus: old.status,
          newSession: fresh ? fresh.session.text : null,
          newStatus: fresh ? fresh.status : null,
        });
      }
    });

    if (conflicts.length) return { ok: false, reason: "conflict", conflicts };

    queueState.resolutions[dateStr] = trialResolutions[dateStr];
    return { ok: true, changed: true };
  }

  ns.runQueue = {
    FIRST_SLOT_DATE,
    LAST_SLIDING_DATE,
    BASELINE,
    BADGE_LABELS,
    isManagedDate,
    getProjection,
    resolve,
    markDoneAt,
    markSkippedAt,
    editResolution,
  };
})(window.Agenda);
