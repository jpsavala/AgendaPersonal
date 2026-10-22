/*
 * Estado central de la aplicación y API de datos.
 *
 * Punto de extensión para el futuro: cuando se conecte una IA que
 * reacomode la agenda por texto/voz, esa capa debe llamar a estas
 * mismas funciones (Agenda.state.*) en vez de tocar el DOM o
 * localStorage directamente. Así la UI y la lógica de datos ya
 * quedan desacopladas desde ahora.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { storage } = ns;
  const { toISO } = ns.dateUtils;
  const QUOTES = ns.quotes.QUOTES;
  const WORDS = ns.wordOfTheDay.WORDS;

  // Sin sesión iniciada, se lee/escribe la clave genérica de siempre
  // (storage.STORAGE_KEY); al iniciar/cerrar sesión, firebaseSync llama
  // a switchStorageKey para pasar a la clave propia de esa cuenta (o de
  // vuelta a la genérica), así que cada una tiene su respaldo local
  // separado en el mismo dispositivo.
  let activeStorageKey = storage.STORAGE_KEY;
  let data = storage.load(activeStorageKey);
  const listeners = [];
  const persistListeners = [];

  function persist() {
    storage.save(data, activeStorageKey);
    persistListeners.forEach((fn) => fn());
  }

  function getWeekdayKey(dateStr) {
    const date = ns.dateUtils.fromISO(dateStr);
    return ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(date)];
  }

  function getMondayKey(dateStr) {
    return ns.dateUtils.toISO(ns.dateUtils.getMonday(ns.dateUtils.fromISO(dateStr)));
  }

  // Inversa de getWeekdayKey: la fecha exacta de ese día de la semana
  // (lunes = ese mondayStr mismo) dentro de la semana que empieza en
  // mondayStr.
  function dateForWeekday(mondayStr, dayKey) {
    const idx = ns.dateUtils.DAY_KEYS.indexOf(dayKey);
    return toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), idx));
  }

  // El texto de los bloques vive por SEMANA ESPECÍFICA (identificada por
  // el lunes de esa semana) + día de la semana. Cada semana nueva
  // arranca vacía: no hereda nada de otras semanas por default.
  function getWeekBlockTemplate(mondayStr, dayKey) {
    if (!data.weekBlocks) data.weekBlocks = {};
    if (!data.weekBlocks[mondayStr]) data.weekBlocks[mondayStr] = {};
    if (!data.weekBlocks[mondayStr][dayKey]) data.weekBlocks[mondayStr][dayKey] = {};
    return data.weekBlocks[mondayStr][dayKey];
  }

  // Migra el modelo viejo (texto duplicado por fecha en la vista diaria
  // y por semana específica en la vista semanal, versión anterior) a una
  // sola plantilla de texto por día de la semana GLOBAL. Es segura de
  // correr en cada carga: una vez migrado un dato, se elimina de su
  // lugar viejo, así que no vuelve a aplicarse en la siguiente carga.
  // Las casillas de cumplido (blocks.done, hábitos, prioridades) nunca
  // se tocan aquí.
  function migrateToWeekdayTemplates() {
    if (!data.weekdayTemplates) data.weekdayTemplates = {};
    ns.dateUtils.DAY_KEYS.forEach((k) => {
      if (!data.weekdayTemplates[k]) data.weekdayTemplates[k] = {};
    });

    const fieldToBlockIds = {
      manana: ["meditar"],
      gimnasio: ["gimnasio"],
      oficina: ["oficina_manana", "tarde_oficina"],
      comida: ["comer_personal", "comer_sobras"],
      tarde: ["tarde_personal", "tarde_oficina"],
      diplomado: ["meditar"],
      corrida: ["correr"],
    };

    // 1) La vista semanal (modelo viejo) es la plantilla base.
    Object.keys(data.weeks || {})
      .sort()
      .forEach((mondayStr) => {
        const week = data.weeks[mondayStr];
        if (!week || !week.blocks) return;
        ns.dateUtils.DAY_KEYS.forEach((dayKey) => {
          const fields = week.blocks[dayKey];
          if (!fields) return;
          Object.entries(fields).forEach(([field, text]) => {
            if (!text) return;
            const targets = fieldToBlockIds[field];
            if (!targets) return;
            const template = data.weekdayTemplates[dayKey];
            targets.forEach((blockId) => {
              if (!template[blockId]) template[blockId] = text;
            });
          });
        });
        delete week.blocks;
      });

    // 2) Rellena huecos con lo que ya hubiera en la vista diaria (mismo id de bloque).
    Object.keys(data.days || {})
      .sort()
      .forEach((dateStr) => {
        const day = data.days[dateStr];
        if (!day || !day.blocks) return;
        const template = data.weekdayTemplates[getWeekdayKey(dateStr)];
        Object.entries(day.blocks).forEach(([blockId, val]) => {
          if (val && val.text) {
            if (!template[blockId]) template[blockId] = val.text;
            delete val.text;
          }
        });
      });
  }

  // El texto por día de la semana GLOBAL (versión anterior) se convierte
  // en contenido inicial de la semana activa al momento de esta
  // migración, para no perder lo ya capturado. El resto de las semanas
  // (pasadas o futuras) arrancan vacías, como corresponde al nuevo
  // modelo por semana específica.
  function migrateWeekdayTemplatesToCurrentWeek() {
    if (!data.weekdayTemplates) return;
    const currentMonday = ns.dateUtils.toISO(ns.dateUtils.getMonday(new Date()));
    ns.dateUtils.DAY_KEYS.forEach((dayKey) => {
      const oldTemplate = data.weekdayTemplates[dayKey];
      if (!oldTemplate) return;
      Object.entries(oldTemplate).forEach(([blockId, text]) => {
        if (!text) return;
        const weekTemplate = getWeekBlockTemplate(currentMonday, dayKey);
        if (!weekTemplate[blockId]) weekTemplate[blockId] = text;
      });
    });
    delete data.weekdayTemplates;
  }

  // Bloques que pasaron a ser fijos ("Oficina", sin texto libre): se
  // descarta cualquier texto que hubiera quedado guardado para ellos,
  // en cualquier semana.
  function purgeFixedBlockText() {
    const FIXED_BLOCK_IDS = ["oficina_manana", "tarde_oficina", "tarde_personal"];
    Object.values(data.weekBlocks || {}).forEach((week) => {
      Object.values(week).forEach((dayFields) => {
        FIXED_BLOCK_IDS.forEach((blockId) => delete dayFields[blockId]);
      });
    });
  }

  // El bloque único de las 20:00 en adelante ("noche") se dividió en un
  // bloque fijo "Cenar y bañarme" (sin texto) y un bloque nuevo editable
  // "libre_noche" (21:30-22:10). El texto que hubiera quedado bajo
  // "noche" se conserva como contenido inicial de ese bloque nuevo.
  function migrateNocheBlockSplit() {
    Object.values(data.weekBlocks || {}).forEach((week) => {
      Object.values(week).forEach((dayFields) => {
        if (dayFields.noche !== undefined) {
          if (!dayFields.libre_noche) dayFields.libre_noche = dayFields.noche;
          delete dayFields.noche;
        }
      });
    });
  }

  // ---------- Gimnasio: cola de 20 sesiones (sin fecha) + puntero ----------
  // Reemplaza el horario fijo por fecha (ver js/trainingSchedule.js,
  // ahora solo para corrida): las mismas 20 sesiones de antes (3 semanas
  // normales + 1 de descarga), pero en una lista ordenada sin fecha
  // asociada. El motor genérico vive en js/scheduleQueue.js.
  const GYM_ROUND = ["Torso", "Pierna - Glúteo/Femoral", "Empuje", "Pierna - Cuádriceps", "Tracción"];
  // El número de semana va pegado al nombre de la sesión (p. ej. "Tracción
  // S2"), no mostrado aparte, para que se vea igual en la Diaria y en la
  // Semanal sin que cada vista tenga que recalcularlo. La semana de
  // descarga (S4) agrega el sufijo "(descarga)" después del número.
  const GYM_QUEUE_SESSIONS = [1, 2, 3, 4].flatMap((week) =>
    GYM_ROUND.map((s) => (week === 4 ? `${s} S${week} (descarga)` : `${s} S${week}`))
  );

  // Migración única: convierte el horario fijo anterior en el puntero
  // inicial, contando cuántas sesiones (lunes a viernes) ya habrían
  // pasado entre el inicio de ese horario y "hoy" (el día en que carga
  // esta versión), para no perder continuidad. Es segura de correr en
  // cada carga: si ya existe data.gymQueue, no hace nada.
  function migrateGymQueue() {
    if (data.gymQueue) return;
    const LEGACY_GYM_START = "2026-09-21"; // lunes de la semana 1 del horario fijo anterior
    const todayStr = toISO(new Date());
    const startStr = todayStr < LEGACY_GYM_START ? LEGACY_GYM_START : todayStr;
    let pointer = 0;
    let cursor = ns.dateUtils.fromISO(LEGACY_GYM_START);
    while (toISO(cursor) < startStr && pointer < GYM_QUEUE_SESSIONS.length) {
      if (ns.dateUtils.isoWeekday(cursor) <= 4) pointer += 1; // lunes(0)...viernes(4)
      cursor = ns.dateUtils.addDays(cursor, 1);
    }
    const seeded = Math.min(pointer, GYM_QUEUE_SESSIONS.length);
    data.gymQueue = {
      pointer: seeded,
      pointerAtSeed: seeded,
      seedAnchor: startStr,
      resolutions: {},
      unavailable: {},
    };
  }

  // Corrección puntual (una sola vez): el calendario real terminó
  // corriéndose respecto al que había calculado la migración anterior
  // (el usuario confirmó por fuera de la app en qué sesión va cada
  // fecha real). En vez de tratar de reconstruir el historial exacto de
  // clics, se fuerza la cola a esta tabla de fechas → índice de sesión,
  // confirmada como fuente de verdad. Sirve para cualquier "hoy" en el
  // que cargue esta versión: busca la primera fecha de la tabla que sea
  // hoy o futura (esa sesión queda pendiente) y ancla la simulación ahí;
  // todo lo anterior a esa fecha se da por hecho, sin necesidad de
  // inventar resoluciones día por día. Después de la última fecha de la
  // tabla, la cola sigue su curso normal (cascada / sábado comodín) tal
  // cual venía funcionando.
  const GYM_CALENDAR_CORRECTION = [
    ["2026-09-22", 3], // Día 4 — Pierna - Cuádriceps
    ["2026-09-23", 4], // Día 5 — Tracción
    ["2026-09-24", 5], // Semana 2 — Día 1 — Torso
    ["2026-09-25", 6], // Día 2 — Pierna - Glúteo/Femoral
    ["2026-09-28", 7], // Día 3 — Empuje
    ["2026-09-29", 8], // Día 4 — Pierna - Cuádriceps
    ["2026-09-30", 9], // Día 5 — Tracción
    ["2026-10-01", 10], // Semana 3 — Día 1 — Torso
    ["2026-10-02", 11], // Día 2 — Pierna - Glúteo/Femoral
    ["2026-10-05", 12], // Día 3 — Empuje
    ["2026-10-06", 13], // Día 4 — Pierna - Cuádriceps
    ["2026-10-07", 14], // Día 5 — Tracción
    ["2026-10-08", 15], // Semana 4 (descarga) — Día 1 — Torso (descarga)
    ["2026-10-09", 16], // Día 2 — Pierna - Glúteo/Femoral (descarga)
    ["2026-10-12", 17], // Día 3 — Empuje (descarga)
    ["2026-10-13", 18], // Día 4 — Pierna - Cuádriceps (descarga)
    ["2026-10-14", 19], // Día 5 — Tracción (descarga): cierre del Bloque 5
  ];

  function migrateGymQueueCorrection() {
    if (data.gymQueueCorrectionApplied) return;
    data.gymQueueCorrectionApplied = true;
    const todayStr = toISO(new Date());
    // Las fechas de la tabla anteriores a "hoy" quedan como resueltas
    // ("done"), para que se sigan viendo bien aunque esta corrección
    // recién se cargue varios días después de alguna de ellas. La
    // primera fecha de la tabla es el ancla de respaldo por si "hoy"
    // todavía no llega ni a esa primera fecha.
    const resolutions = {};
    const baseIndex = GYM_CALENDAR_CORRECTION.length ? GYM_CALENDAR_CORRECTION[0][1] : GYM_QUEUE_SESSIONS.length;
    let pointer = baseIndex;
    GYM_CALENDAR_CORRECTION.forEach(([d, idx]) => {
      if (d < todayStr) {
        resolutions[d] = { status: "done", index: idx };
        pointer = idx + 1;
      }
    });
    data.gymQueue = {
      pointer: Math.min(pointer, GYM_QUEUE_SESSIONS.length),
      // A diferencia de `pointer` (que sí avanza con las resoluciones de
      // arriba), este queda fijo en el índice que tenía la cola justo en
      // `seedAnchor`: es la base para calcular el atraso real de días
      // hábiles a partir de ahí (ver makeIsValidGymDay), sin que las
      // resoluciones ya aplicadas la desalineen.
      pointerAtSeed: baseIndex,
      seedAnchor: GYM_CALENDAR_CORRECTION.length ? GYM_CALENDAR_CORRECTION[0][0] : todayStr,
      resolutions,
      unavailable: {},
    };
  }

  // Segunda corrección puntual (una sola vez): el lunes 21 de septiembre
  // no se fue al gimnasio, y el resto de esa semana quedó por debajo de
  // lo que la corrección anterior asumía — el usuario confirmó que, en
  // los hechos, el sábado 26 de septiembre le toca "Empuje" (índice 2) y
  // el lunes 28 "Pierna - Cuádriceps" (índice 3), cascada en adelante.
  // En vez de reconstruir a mano cuál de esos días se hizo y cuál no
  // (no hace falta: solo importa el total), se reancla la cola en el
  // lunes 21 (inicio real de esa semana) con el puntero de esa fecha en
  // cero, y se deja el puntero actual en 2. Así el atraso real (3
  // sesiones en 5 días hábiles) queda registrado para que el comodín del
  // sábado lo siga descontando de a una por vez hasta emparejarse, en
  // vez de asumir que ya se puso al día de una sola vez.
  function migrateGymQueueCorrection2() {
    if (data.gymQueueCorrection2Applied) return;
    data.gymQueueCorrection2Applied = true;
    data.gymQueue = {
      pointer: 2,
      pointerAtSeed: 0,
      seedAnchor: "2026-09-21",
      resolutions: {},
      unavailable: {},
    };
  }

  // Tercera corrección puntual (una sola vez): el usuario confirmó el
  // calendario real vigente desde el martes 29 de septiembre en
  // adelante (fuente de verdad, provista fuera de la app). A diferencia
  // de las dos correcciones anteriores, esta NO pisa a ciegas la cola:
  // antes de tocar nada, se fija con qué índice de sesión resuelve HOY
  // (y cada fecha de la tabla) la cola tal cual está, usando la misma
  // lógica de siempre (getGymResolution). Si ya coincide con la tabla —
  // es decir, si lo que el usuario ya vino marcando con Sí/No dio
  // exactamente esta secuencia — no se cambia nada. Solo si hay un
  // desvío se reancla la cola en la primera fecha de la tabla,
  // conservando cualquier resolución ya guardada para fechas anteriores
  // a esa (no se pierde historial) y respetando el sí/no ya elegido ese
  // mismo día si lo hubiera (solo se corrige a qué sesión correspondía).
  const GYM_CALENDAR_CORRECTION_2 = [
    ["2026-09-29", 9], // Día 5 — Tracción (cierra Semana 2)
    ["2026-09-30", 10], // Día 1 — Torso (arranca Semana 3)
    ["2026-10-01", 11], // Día 2 — Pierna - Glúteo/Femoral
    ["2026-10-02", 12], // Día 3 — Empuje
    ["2026-10-05", 13], // Día 4 — Pierna - Cuádriceps
    ["2026-10-06", 14], // Día 5 — Tracción (cierra Semana 3)
    ["2026-10-07", 15], // Día 1 — Torso (descarga) (arranca Semana 4)
    ["2026-10-08", 16], // Día 2 — Pierna - Glúteo/Femoral (descarga)
    ["2026-10-09", 17], // Día 3 — Empuje (descarga)
    ["2026-10-12", 18], // Día 4 — Pierna - Cuádriceps (descarga)
    ["2026-10-13", 19], // Día 5 — Tracción (descarga): cierre del Bloque 5
  ];

  function migrateGymQueueCorrection3() {
    if (data.gymQueueCorrection3Applied) return;
    data.gymQueueCorrection3Applied = true;
    if (!data.gymQueue) return;
    const todayStr = toISO(new Date());

    const alreadyMatches = GYM_CALENDAR_CORRECTION_2.every(([d, idx]) => {
      const r = getGymResolution(d);
      return r && r.index === idx;
    });
    if (alreadyMatches) return;

    const resolutions = { ...data.gymQueue.resolutions };
    const baseIndex = GYM_CALENDAR_CORRECTION_2[0][1];
    GYM_CALENDAR_CORRECTION_2.forEach(([d, idx]) => {
      if (d > todayStr) return;
      if (d === todayStr) {
        // Hoy: si ya se había elegido sí/no, se respeta esa elección
        // (solo se corrige a qué sesión correspondía). Si todavía no se
        // contestó, no se agrega nada — se deja "pendiente" de verdad,
        // en vez de forzarlo a "hecho" antes de que el usuario responda.
        if (resolutions[d]) resolutions[d] = { status: resolutions[d].status, index: idx };
        return;
      }
      // Fechas anteriores a hoy (solo pueden darse si esta corrección
      // recién se carga días después del despliegue): se respeta lo ya
      // guardado, o se da por hecho si no había nada, igual que la
      // corrección anterior.
      const existingStatus = resolutions[d] ? resolutions[d].status : "done";
      resolutions[d] = { status: existingStatus, index: idx };
    });
    let pointer = baseIndex;
    Object.values(resolutions).forEach((r) => {
      if (r.status === "done" && r.index + 1 > pointer) pointer = r.index + 1;
    });

    data.gymQueue = {
      pointer: Math.min(pointer, GYM_QUEUE_SESSIONS.length),
      pointerAtSeed: baseIndex,
      seedAnchor: GYM_CALENDAR_CORRECTION_2[0][0],
      resolutions,
      unavailable: data.gymQueue.unavailable || {},
    };
  }

  // Quinta corrección puntual (una sola vez): la corrección anterior
  // había asumido que la semana del 29 sep - 6 oct se había cumplido
  // sesión por sesión sin saltos. En los hechos, el usuario confirmó que
  // lo último realmente hecho fue el Día 4 — Cuádriceps S2, el lunes 28
  // de septiembre (esa fecha NO se toca); el Día 5 — Tracción S2 nunca
  // se hizo (el sábado que entrenó solo pecho no cuenta como Empuje, y
  // no corresponde a Tracción de ningún modo), así que el calendario
  // anterior se había adelantado una sesión de más desde el 29 sep.
  //
  // Mismo criterio de siempre: primero verifica si la cola ya calcula
  // sola la secuencia confirmada (6-20 oct); si ya coincide, no toca
  // nada. Si no, conserva intacta cualquier resolución del 28 de
  // septiembre hacia atrás (no se pierde ese historial), descarta lo que
  // haya quedado de la corrección anterior en la ventana con el error (29
  // sep - 5 oct — esos días vuelven a comportarse como "no registrados/no
  // cumplidos", igual que cualquier día pasado sin marcar) y reancla la
  // cola en el 6 de octubre con el Día 5 — Tracción S2 pendiente.
  const GYM_LAST_KNOWN_GOOD_DATE = "2026-09-28";
  const GYM_CALENDAR_CORRECTION_3 = [
    ["2026-10-06", 9], // Día 5 — Tracción S2 (pendiente)
    ["2026-10-07", 10], // Día 1 — Torso S3
    ["2026-10-08", 11], // Día 2 — Pierna - Glúteo/Femoral S3
    ["2026-10-09", 12], // Día 3 — Empuje S3
    ["2026-10-12", 13], // Día 4 — Pierna - Cuádriceps S3
    ["2026-10-13", 14], // Día 5 — Tracción S3
    ["2026-10-14", 15], // Día 1 — Torso S4 (descarga)
    ["2026-10-15", 16], // Día 2 — Pierna - Glúteo/Femoral S4 (descarga)
    ["2026-10-16", 17], // Día 3 — Empuje S4 (descarga)
    ["2026-10-19", 18], // Día 4 — Pierna - Cuádriceps S4 (descarga)
    ["2026-10-20", 19], // Día 5 — Tracción S4 (descarga): cierre del Bloque 5
  ];

  function migrateGymQueueCorrection4() {
    if (data.gymQueueCorrection4Applied) return;
    data.gymQueueCorrection4Applied = true;
    if (!data.gymQueue) return;
    const todayStr = toISO(new Date());

    const alreadyMatches = GYM_CALENDAR_CORRECTION_3.every(([d, idx]) => {
      const r = getGymResolution(d);
      return r && r.index === idx;
    });
    if (alreadyMatches) return;

    // Arranca solo con lo resuelto hasta el 28 de septiembre inclusive
    // (último hecho real, confirmado): cualquier resolución posterior a
    // esa fecha que no esté en la tabla nueva de abajo (el tramo erróneo
    // del 29 sep al 5 oct) se descarta acá, antes de aplicar la tabla.
    const resolutions = {};
    Object.keys(data.gymQueue.resolutions).forEach((d) => {
      if (d <= GYM_LAST_KNOWN_GOOD_DATE) resolutions[d] = data.gymQueue.resolutions[d];
    });

    const baseIndex = GYM_CALENDAR_CORRECTION_3[0][1];
    GYM_CALENDAR_CORRECTION_3.forEach(([d, idx]) => {
      if (d > todayStr) return;
      if (d === todayStr) {
        // Hoy: si ya se había elegido sí/no, se respeta esa elección
        // (solo se corrige a qué sesión correspondía).
        const existing = data.gymQueue.resolutions[d];
        if (existing) resolutions[d] = { status: existing.status, index: idx };
        return;
      }
      const existing = data.gymQueue.resolutions[d];
      const existingStatus = existing ? existing.status : "done";
      resolutions[d] = { status: existingStatus, index: idx };
    });

    let pointer = baseIndex;
    Object.values(resolutions).forEach((r) => {
      if (r.status === "done" && r.index + 1 > pointer) pointer = r.index + 1;
    });

    data.gymQueue = {
      pointer: Math.min(pointer, GYM_QUEUE_SESSIONS.length),
      pointerAtSeed: baseIndex,
      seedAnchor: GYM_CALENDAR_CORRECTION_3[0][0],
      resolutions,
      unavailable: data.gymQueue.unavailable || {},
    };
  }

  // ---------- Bloque 6: cola propia con nuevo orden de días ----------
  // Hasta el Bloque 5 (arriba), toda la app usaba un solo data.gymQueue.
  // A partir de acá puede haber más de un bloque a la vez en el tiempo
  // (uno que se cierra, otro que arranca): data.gymBlocks reemplaza a
  // data.gymQueue con una colección por número de bloque, cada uno con
  // su propio rango de fechas [startDate, endDate] y su propio estado
  // de cola + puntero (los mismos campos pointer/pointerAtSeed/
  // seedAnchor/resolutions/unavailable de siempre, un juego por bloque
  // en vez de uno global) — el motor genérico de scheduleQueue.js no
  // cambia en nada, solo se lo llama una vez por bloque según a cuál le
  // corresponda la fecha consultada (ver findGymBlockForDate). El
  // Bloque 5 cierra el 19 de octubre de 2026 sin su Semana 4 de
  // descarga (esas sesiones quedan tal cual, sin realizar); el 20 de
  // octubre arranca el Bloque 6 desde cero con su propio orden de cola
  // (Torso, Empuje, Glúteo/Femoral, Tracción, Cuádriceps).
  const GYM_BLOCK_5_END_DATE = "2026-10-19";
  const GYM_BLOCK_6_START_DATE = "2026-10-20";
  const GYM_BLOCK_6_END_DATE = "2026-11-16"; // después de esta fecha, edición manual como antes
  const GYM_BLOCK_6_ROUND = ["Torso", "Empuje", "Glúteo/Femoral", "Tracción", "Cuádriceps"];
  const GYM_BLOCK_6_SESSIONS = [1, 2, 3, 4].flatMap((week) =>
    GYM_BLOCK_6_ROUND.map((s) => (week === 4 ? `${s} S${week} (descarga)` : `${s} S${week}`))
  );

  // Migración única: envuelve el data.gymQueue de siempre (ya resuelto
  // por todas las correcciones de arriba) como Bloque 5 cerrado, y crea
  // el Bloque 6 vacío desde el 20 de octubre. Cualquier resolución que
  // hubiera quedado fechada el 20 de octubre o después (no debería
  // haber ninguna a esta altura) se descarta del Bloque 5 al envolverlo,
  // para que "cierra sin su Semana 4" se cumpla incluso si algo llegó a
  // marcarse ese día antes de esta migración.
  function migrateGymBlocksStructure() {
    if (data.gymBlocksMigrated) return;
    data.gymBlocksMigrated = true;
    const oldQueue =
      data.gymQueue || { pointer: 0, pointerAtSeed: 0, seedAnchor: GYM_BLOCK_6_START_DATE, resolutions: {}, unavailable: {} };
    const block5Resolutions = {};
    Object.keys(oldQueue.resolutions).forEach((d) => {
      if (d <= GYM_BLOCK_5_END_DATE) block5Resolutions[d] = oldQueue.resolutions[d];
    });
    const block5Unavailable = {};
    Object.keys(oldQueue.unavailable || {}).forEach((d) => {
      if (d <= GYM_BLOCK_5_END_DATE) block5Unavailable[d] = true;
    });
    data.gymBlocks = {
      5: {
        number: 5,
        sessions: GYM_QUEUE_SESSIONS,
        startDate: oldQueue.seedAnchor,
        endDate: GYM_BLOCK_5_END_DATE,
        pointer: oldQueue.pointer,
        pointerAtSeed: oldQueue.pointerAtSeed,
        seedAnchor: oldQueue.seedAnchor,
        resolutions: block5Resolutions,
        unavailable: block5Unavailable,
      },
      6: {
        number: 6,
        sessions: GYM_BLOCK_6_SESSIONS,
        startDate: GYM_BLOCK_6_START_DATE,
        endDate: GYM_BLOCK_6_END_DATE,
        pointer: 0,
        pointerAtSeed: 0,
        seedAnchor: GYM_BLOCK_6_START_DATE,
        resolutions: {},
        unavailable: {},
      },
    };
  }

  // Migración única: carga, como semilla, la rutina/reglas/progresión y
  // el historial ya conocido de cada bloque (ver js/gymRoutines.js) en
  // su data.gymBlocks correspondiente — corre después de
  // migrateGymBlocksStructure (necesita que los bloques ya existan). De
  // ahí en más todo se edita desde la cuenta; esta función no vuelve a
  // tocar nada una vez que corrió.
  function migrateGymRoutinesSeed() {
    if (data.gymRoutinesSeeded) return;
    data.gymRoutinesSeeded = true;
    if (!data.gymBlocks || !ns.gymRoutines) return;
    const seeds = ns.gymRoutines.BLOCK_SEEDS;
    Object.keys(seeds).forEach((num) => {
      const block = data.gymBlocks[num];
      const seed = seeds[num];
      if (!block || !seed) return;
      block.label = seed.label;
      block.dayNames = seed.dayNames;
      block.rules = seed.rules;
      block.progression = seed.progression;
      block.routine = JSON.parse(JSON.stringify(seed.routine));
      block.weeks = JSON.parse(JSON.stringify(seed.weeks));
    });
  }

  // Bloque (de data.gymBlocks) al que le corresponde esta fecha, o null
  // si cae antes/después de todos los rangos conocidos (comportamiento
  // manual, igual que "cola agotada" de siempre).
  function findGymBlockForDate(dateStr) {
    if (!data.gymBlocks) return null;
    const blocks = Object.values(data.gymBlocks).sort((a, b) => a.number - b.number);
    return blocks.find((b) => dateStr >= b.startDate && dateStr <= b.endDate) || null;
  }

  // Cuenta cuántos días hábiles (lunes a viernes) hay entre dos fechas,
  // ambas incluidas. Cálculo puramente de calendario, sin mirar
  // resoluciones.
  function countWeekdaysBetween(fromStr, throughStr) {
    if (fromStr > throughStr) return 0;
    let count = 0;
    let cursor = ns.dateUtils.fromISO(fromStr);
    const through = ns.dateUtils.fromISO(throughStr);
    while (cursor <= through) {
      if (ns.dateUtils.isoWeekday(cursor) < 5) count += 1;
      cursor = ns.dateUtils.addDays(cursor, 1);
    }
    return count;
  }

  // Días hábiles para la cola de gimnasio: lunes a viernes siempre;
  // sábado solo si, para cuando la simulación llega a él, todavía hay
  // menos sesiones consumidas (idxSoFar) que días hábiles "deberían"
  // haber pasado en total desde que arrancó este sistema (es decir, hay
  // atraso que recuperar, sin importar de qué semana venga). El punto de
  // partida de ese conteo NO es cero: es pointerAtSeed, el índice que ya
  // tenía la cola en seedAnchor (por la migración o por una corrección
  // puntual) — si se arrancara en cero acá pero el puntero ya venía
  // adelantado, cualquier comparación quedaría desalineada y activaría
  // sábados de más (o de menos). Se genera una función nueva por cada
  // simulación: arranca su contador ya con pointerAtSeed más los días
  // hábiles previos al punto donde retoma la simulación (ver
  // scheduleQueue.anchorOf), y de ahí en adelante lo va sumando día a
  // día en el mismo orden en que los recorre resolve().
  function makeIsValidGymDayForBlock(block) {
    const anchor = ns.scheduleQueue.anchorOf(block);
    const dayBeforeAnchor = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(anchor), -1));
    const pointerAtSeed = block.pointerAtSeed || 0;
    let weekdaysSoFar = pointerAtSeed + countWeekdaysBetween(block.seedAnchor, dayBeforeAnchor);
    return function (dateStr, idxSoFar) {
      const wd = ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr));
      if (wd === 6) return false; // domingo: descanso siempre
      if (wd < 5) {
        weekdaysSoFar += 1;
        return true; // lunes a viernes: siempre hábil
      }
      return idxSoFar < weekdaysSoFar; // sábado: solo si hay atraso
    };
  }

  // dayNumber: posición 1-5 dentro de la ronda de 5 días del bloque que
  // le corresponda (Torso/Empuje/... según el bloque), para el formato
  // "Día X - Nombre SN" de la Diaria (ver getDayBlocks/
  // buildSaturdayGymBlock) — independiente de qué bloque sea, siempre
  // son grupos de 5 sesiones por semana.
  function getGymResolution(dateStr) {
    const block = findGymBlockForDate(dateStr);
    if (!block) return null;
    const todayStr = toISO(new Date());
    const r = ns.scheduleQueue.resolve(block, block.sessions, dateStr, todayStr, makeIsValidGymDayForBlock(block));
    if (!r) return null;
    return { ...r, blockNumber: block.number, dayNumber: (r.index % 5) + 1 };
  }

  function markGymDone(dateStr) {
    const block = findGymBlockForDate(dateStr);
    if (!block) return;
    const todayStr = toISO(new Date());
    if (ns.scheduleQueue.markDone(block, block.sessions, dateStr, todayStr, makeIsValidGymDayForBlock(block))) notify();
  }

  function markGymSkipped(dateStr) {
    const block = findGymBlockForDate(dateStr);
    if (!block) return;
    const todayStr = toISO(new Date());
    if (ns.scheduleQueue.markSkipped(block, block.sessions, dateStr, todayStr, makeIsValidGymDayForBlock(block))) notify();
  }

  // Corrige una respuesta de "¿Entrenaste hoy?" ya guardada (de
  // cualquier fecha pasada, no solo la más reciente; incluye una fecha
  // que se haya congelado sola sin marcar nunca). Si el cambio entra en
  // conflicto con una fecha posterior que ya tiene su propia respuesta
  // guardada, no cambia nada: devuelve el conflicto para que la UI lo
  // muestre antes de decidir. Sigue funcionando igual para fechas del
  // Bloque 5 (cerrado) y del Bloque 6 (vigente): cada una corrige contra
  // el bloque al que le corresponde su propia fecha.
  function editGymDay(dateStr, done) {
    const block = findGymBlockForDate(dateStr);
    if (!block) return { ok: false, reason: "not-resolved" };
    const todayStr = toISO(new Date());
    const result = ns.scheduleQueue.editResolution(
      block,
      block.sessions,
      dateStr,
      todayStr,
      makeIsValidGymDayForBlock(block),
      done ? "done" : "skipped"
    );
    if (result.ok && result.changed) notify();
    return result;
  }

  function isGymUnavailable(dateStr) {
    const block = findGymBlockForDate(dateStr);
    return !!(block && block.unavailable[dateStr]);
  }

  // Solo tiene sentido marcar fechas futuras (ver UI): no valida acá para
  // no acoplar esta capa de datos con "hoy" más de lo necesario.
  function setGymUnavailable(dateStr, unavailable) {
    const block = findGymBlockForDate(dateStr);
    if (!block) return;
    ns.scheduleQueue.setUnavailable(block, dateStr, unavailable);
    notify();
  }

  // Igual que getSundayRunText: refleja de solo lectura, en el pendiente
  // "Gimnasio" del checklist de fin de semana, la sesión atrasada que le
  // tocaría a este sábado (si hay alguna). undefined si no es sábado o si
  // no hay atraso ese sábado (se deja el texto manual de siempre).
  function getSaturdayGymResolution(dateStr) {
    if (ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr)) !== 5) return undefined;
    return getGymResolution(dateStr) || undefined;
  }

  // ---------- Registro de gimnasio: peso, repeticiones y RIR ----------
  // Independiente por completo de la cola + puntero de arriba (nunca
  // leen gymStatus/pointer/resolutions, ni los tocan): registrar series
  // no marca la sesión como cumplida, ni al revés (ver el pedido
  // original, parte B.5). Vive dentro de cada data.gymBlocks[number],
  // en tres campos nuevos junto a los de la cola:
  // - dayNames: los 5 nombres de día de ESTE bloque, en su propio orden
  //   de cola (Torso/Empuje/... — puede diferir de otro bloque).
  // - routine: { [día 1-5]: [ {id, name, target, mode, order}, ... ] },
  //   la rutina editable de cada día (ver las funciones de edición más
  //   abajo). "mode" es "sets" (series con peso/reps/RIR) o "simple"
  //   (una sola casilla "hecho" + nota, para ejercicios sin peso).
  // - weeks: { [semana 1-4]: { [día 1-5]: { dayNote, exercises: {
  //   [exerciseId]: { note, sets: [...], done? } } } } } — solo existen
  //   las semanas/días/ejercicios que ya se tocaron (no se crean vacíos
  //   solo por mirarlos, ver getGymWeekDay).
  const GYM_SET_UNITS = {
    total: "lb totales",
    perSide: "lb por lado",
    perSideBar: "lb por lado + barra",
    bodyweight: "peso corporal",
    none: "sin peso",
  };

  function getGymBlockNumbers() {
    if (!data.gymBlocks) return [];
    return Object.values(data.gymBlocks)
      .map((b) => b.number)
      .sort((a, b) => a - b);
  }

  function getGymBlockMeta(blockNumber) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block) return null;
    return {
      number: block.number,
      label: block.label || `Bloque ${block.number}`,
      dayNames: block.dayNames || [],
      rules: block.rules || "",
      progression: block.progression || "",
      startDate: block.startDate,
      endDate: block.endDate,
    };
  }

  // El bloque + semana + día que le corresponde HOY, para abrir la
  // pestaña Gimnasio ya posicionada ahí (ver ns.app.openGymSession). Se
  // deriva de getGymResolution de la fecha que se pida (no solo "hoy"):
  // la semana es 1 + cuántos grupos de 5 sesiones (índice de la cola)
  // ya pasaron.
  function getGymSessionLocation(dateStr) {
    const r = getGymResolution(dateStr);
    if (!r) return null;
    return { blockNumber: r.blockNumber, week: Math.floor(r.index / 5) + 1, day: r.dayNumber };
  }

  function getGymRoutineDay(blockNumber, day) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block || !block.routine) return [];
    return (block.routine[day] || []).slice().sort((a, b) => a.order - b.order);
  }

  // Lectura pura: no crea nada en los datos solo por consultar una
  // semana/día que todavía no se tocó (para no dejar semanas "vacías"
  // guardadas de más, mismo criterio que getWeekIfExists).
  function getGymWeekDay(blockNumber, week, day) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    const weekLog = block && block.weeks && block.weeks[week];
    return (weekLog && weekLog[day]) || { dayNote: "", exercises: {} };
  }

  // Crea (si hace falta) y devuelve la semana/día/ejercicio exactos
  // donde escribir — a diferencia de getGymWeekDay, esta sí persiste la
  // estructura mínima para poder guardar algo adentro.
  function ensureGymExerciseLog(blockNumber, week, day, exerciseId) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block) return null;
    if (!block.weeks) block.weeks = {};
    if (!block.weeks[week]) block.weeks[week] = {};
    if (!block.weeks[week][day]) block.weeks[week][day] = { dayNote: "", exercises: {} };
    if (!block.weeks[week][day].exercises[exerciseId]) {
      block.weeks[week][day].exercises[exerciseId] = { note: "", sets: [] };
    }
    return block.weeks[week][day].exercises[exerciseId];
  }

  // Igual que setBlockText (ver más abajo): guarda con persist(), no con
  // notify(), a propósito — es texto libre que se escribe tecla por
  // tecla desde js/gymView.js, y notify() dispara el re-render de toda
  // la vista (ver ns.state.onChange en js/app.js), que en un campo de
  // texto activo le hace perder el foco al input en cada tecla. persist()
  // guarda igual (localStorage + sincroniza con Firebase, ver
  // js/firebaseSync.js: onPersist) sin redibujar nada.
  function setGymDayNote(blockNumber, week, day, text) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block) return;
    if (!block.weeks) block.weeks = {};
    if (!block.weeks[week]) block.weeks[week] = {};
    if (!block.weeks[week][day]) block.weeks[week][day] = { dayNote: "", exercises: {} };
    block.weeks[week][day].dayNote = text;
    persist();
  }

  function setGymExerciseNote(blockNumber, week, day, exerciseId, text) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    log.note = text;
    persist();
  }

  function blankGymSet() {
    return { id: uid("gset"), weight: null, unit: "total", barWeight: null, reps: "", rir: "", note: "" };
  }

  function addGymSet(blockNumber, week, day, exerciseId) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    log.sets.push(blankGymSet());
    notify();
  }

  // "Copiar serie anterior": mismo peso/unidad/barra/reps/RIR que la
  // última serie ya cargada, sin la nota (una nota de la serie anterior
  // casi nunca aplica también a la nueva).
  function copyLastGymSet(blockNumber, week, day, exerciseId) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    const last = log.sets[log.sets.length - 1];
    log.sets.push({
      id: uid("gset"),
      weight: last ? last.weight : null,
      unit: last ? last.unit : "total",
      barWeight: last ? last.barWeight : null,
      reps: last ? last.reps : "",
      rir: last ? last.rir : "",
      note: "",
    });
    notify();
  }

  // persist(), no notify() — ver la nota de setGymDayNote/
  // setGymExerciseNote de arriba: peso/reps/RIR se escriben tecla por
  // tecla, así que esta función no puede disparar un re-render.
  function updateGymSet(blockNumber, week, day, exerciseId, setId, fields) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    const set = log.sets.find((s) => s.id === setId);
    if (!set) return;
    Object.assign(set, fields);
    persist();
  }

  function removeGymSet(blockNumber, week, day, exerciseId, setId) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    log.sets = log.sets.filter((s) => s.id !== setId);
    notify();
  }

  // Ejercicios "simple" (sin peso): una sola casilla "hecho" + nota, sin
  // series. Vive en el mismo exerciseLog que los demás (campo `done`),
  // para que la referencia de la semana anterior (ver más abajo) los
  // trate de forma uniforme.
  function setGymSimpleDone(blockNumber, week, day, exerciseId, done) {
    const log = ensureGymExerciseLog(blockNumber, week, day, exerciseId);
    if (!log) return;
    log.done = done;
    notify();
  }

  // ---------- Rutina editable (agregar/editar/reordenar/eliminar) ----------
  function addGymExercise(blockNumber, day, { name, target, mode }) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    if (!block.routine) block.routine = {};
    if (!block.routine[day]) block.routine[day] = [];
    const order = block.routine[day].length;
    block.routine[day].push({
      id: uid(`b${blockNumber}d${day}e`),
      name: trimmed,
      target: (target || "").trim() || null,
      mode: mode === "simple" ? "simple" : "sets",
      order,
    });
    notify();
  }

  function updateGymExercise(blockNumber, day, exerciseId, fields) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    const list = block && block.routine && block.routine[day];
    const exercise = list && list.find((e) => e.id === exerciseId);
    if (!exercise) return;
    if (fields.name !== undefined) exercise.name = fields.name.trim() || exercise.name;
    if (fields.target !== undefined) exercise.target = fields.target.trim() || null;
    if (fields.mode !== undefined) exercise.mode = fields.mode === "simple" ? "simple" : "sets";
    notify();
  }

  function removeGymExercise(blockNumber, day, exerciseId) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    const list = block && block.routine && block.routine[day];
    if (!list) return;
    block.routine[day] = list.filter((e) => e.id !== exerciseId);
    notify();
  }

  // orderedIds: todos los ids de ese día, en el orden final deseado.
  function reorderGymExercises(blockNumber, day, orderedIds) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    const list = block && block.routine && block.routine[day];
    if (!list) return;
    orderedIds.forEach((id, i) => {
      const exercise = list.find((e) => e.id === id);
      if (exercise) exercise.order = i;
    });
    notify();
  }

  function moveGymExercise(blockNumber, day, exerciseId, delta) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    const list = block && block.routine && block.routine[day];
    if (!list) return;
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((e) => e.id === exerciseId);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= sorted.length) return;
    const [item] = sorted.splice(idx, 1);
    sorted.splice(target, 0, item);
    reorderGymExercises(blockNumber, day, sorted.map((e) => e.id));
  }

  // ---------- Referencia de la semana anterior ----------
  function formatGymSetWeight(set) {
    if (set.unit === "bodyweight") return "Peso corporal";
    if (set.unit === "none" || set.weight === null || set.weight === undefined) return "Sin peso";
    if (set.unit === "perSide") return `${set.weight} lb/lado`;
    if (set.unit === "perSideBar") return `${set.weight} lb/lado + barra${set.barWeight ? ` ${set.barWeight} kg` : ""}`;
    return `${set.weight} lb`;
  }

  function formatGymReference(exLog) {
    if (!exLog) return null;
    if (exLog.sets && exLog.sets.length) {
      const set = exLog.sets[0];
      const reps = set.reps || "?";
      const rir = set.rir ? ` @ ${set.rir} RIR` : "";
      return `${formatGymSetWeight(set)} x ${reps}${rir}`;
    }
    if (exLog.done) return exLog.note || "Hecho";
    return null;
  }

  // "Peso x reps @ RIR" de lo que se hizo en el mismo día y ejercicio la
  // semana anterior (ver el pedido original, parte B.4). Semana > 1:
  // misma fecha de bloque, semana-1, mismo id de ejercicio. Semana 1:
  // la última semana CON DATOS del bloque anterior (bloque número - 1,
  // si existe), buscando el día por NOMBRE (el orden de días puede
  // diferir entre bloques) y el ejercicio por NOMBRE (los ids son
  // propios de cada bloque) — si no hay bloque anterior, o no hay
  // ningún día/ejercicio con ese nombre ahí, no muestra nada (nunca
  // adivina una equivalencia).
  function getGymPreviousReference(blockNumber, week, day, exerciseId) {
    const block = data.gymBlocks && data.gymBlocks[blockNumber];
    if (!block) return null;
    if (week > 1) {
      const prevDayLog = block.weeks && block.weeks[week - 1] && block.weeks[week - 1][day];
      return formatGymReference(prevDayLog && prevDayLog.exercises[exerciseId]);
    }
    const prevBlock = data.gymBlocks[blockNumber - 1];
    if (!prevBlock) return null;
    const dayName = (block.dayNames || [])[day - 1];
    const prevDay = (prevBlock.dayNames || []).indexOf(dayName) + 1;
    if (prevDay <= 0) return null;
    const exercise = (getGymRoutineDay(blockNumber, day) || []).find((e) => e.id === exerciseId);
    if (!exercise) return null;
    const prevWeeks = Object.keys(prevBlock.weeks || {})
      .map(Number)
      .sort((a, b) => b - a);
    for (const w of prevWeeks) {
      const prevDayLog = prevBlock.weeks[w][prevDay];
      if (!prevDayLog) continue;
      const prevExercise = (prevBlock.routine[prevDay] || []).find((e) => e.name === exercise.name);
      if (!prevExercise) continue;
      const ref = formatGymReference(prevDayLog.exercises[prevExercise.id]);
      if (ref) return ref;
    }
    return null;
  }

  // ---------- Corrida: contador a la carrera y racha ----------
  function getRaceCountdown() {
    return ns.trainingSchedule.getRaceCountdownInfo(toISO(new Date()));
  }

  // "Hecho" de un día con corrida programada: entre semana, y ahora
  // también el domingo de carrera larga (desde que tiene su propio
  // bloque fijo unificado, ver buildWeekendRunBlock), usa la casilla
  // simple del bloque (day.blocks.correr.done). Solo si ese domingo NO
  // tiene corrida programada en el plan (fuera de RUN_SUNDAYS) se sigue
  // leyendo el pendiente "Correr" del checklist de fin de semana, para
  // no cambiar nada en esos días sin plan.
  function isRunDayDone(dateStr) {
    const day = data.days[dateStr];
    if (!day) return false;
    if (getWeekdayKey(dateStr) === "sun" && ns.trainingSchedule.getSundayRunText(dateStr) === undefined) {
      const item = (day.weekendChecklist || []).find(
        (i) => i.key === "correr" || (i.key === undefined && i.text === "Correr")
      );
      return !!(item && item.done);
    }
    return !!(day.blocks && day.blocks.correr && day.blocks.correr.done);
  }

  function getRunStreak() {
    const todayStr = toISO(new Date());
    const dates = ns.trainingSchedule.getProgrammedRunDates(todayStr);
    let streak = 0;
    for (let i = dates.length - 1; i >= 0; i -= 1) {
      const d = dates[i];
      const done = isRunDayDone(d);
      if (d === todayStr && !done) continue; // hoy, todavía sin marcar: no cuenta ni rompe
      if (done) streak += 1;
      else break;
    }
    const text =
      streak > 0
        ? `Llevas ${streak} salida${streak === 1 ? "" : "s"} seguida${streak === 1 ? "" : "s"} sin fallar`
        : "Empieza tu racha hoy";
    return { count: streak, text };
  }

  // "Hecho" de cualquier bloque flexible en una fecha, de solo lectura
  // (no usa getDay/toggleBlockDone para no crear el día solo por
  // consultarlo, ver getWeekIfExists por la misma razón).
  function isBlockDone(dateStr, blockId) {
    const day = data.days[dateStr];
    return !!(day && day.blocks && day.blocks[blockId] && day.blocks[blockId].done);
  }

  // ---------- Meta genérica (cuentas de onboarding): contador y racha ----------
  // Mismo criterio que getRunStreak, pero caminando día por día hacia
  // atrás (en vez de una tabla fija de fechas programadas): la meta
  // genérica no tiene una lista de fechas precalculada, solo la regla
  // "día de la semana elegido, y no pasarse de la fecha si es 'detiene'"
  // (ver ns.userGoal.isScheduledOn). Se corta a los 400 días por las
  // dudas, aunque en la práctica se frena solo en el primer día sin
  // marcar.
  function getGoalStreak(todayStr) {
    let streak = 0;
    let cursor = todayStr;
    let isToday = true;
    for (let i = 0; i < 400; i += 1) {
      if (ns.userGoal.isScheduledOn(cursor)) {
        const done = isBlockDone(cursor, ns.userGoal.BLOCK_ID);
        if (isToday && !done) {
          // hoy, todavía sin marcar: no cuenta ni rompe
        } else if (done) {
          streak += 1;
        } else {
          break;
        }
      }
      isToday = false;
      cursor = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(cursor), -1));
    }
    const text =
      streak > 0
        ? `Llevas ${streak} día${streak === 1 ? "" : "s"} seguido${streak === 1 ? "" : "s"} sin fallar`
        : "Empieza tu racha hoy";
    return { count: streak, text };
  }

  // Banner de contador + racha de la vista Diaria/Semanal: para la
  // cuenta dueña (o sin sesión iniciada) es siempre el sistema fijo de
  // su carrera (ver js/trainingSchedule.js), sin cambios; para una
  // cuenta de onboarding es la meta genérica que haya configurado (ver
  // js/userGoal.js), si configuró alguna. null = no mostrar nada.
  function getMotivationBanner() {
    if (!ns.scheduleDefs.isOnboardingSchedule()) {
      return { countdownText: getRaceCountdown().text, streakText: getRunStreak().text };
    }
    if (!ns.userGoal.getGoal()) return null;
    const todayStr = toISO(new Date());
    const countdownText = ns.userGoal.getCountdownText(todayStr);
    const streakText = getGoalStreak(todayStr).text;
    // En modo "detiene", más de un día después del evento se apaga del
    // todo (ni contador ni racha): countdownText ya da null ahí.
    if (countdownText === null && ns.userGoal.getGoal().modo === "detiene") return null;
    return { countdownText, streakText };
  }

  // "Prioridades del trabajo" (vista Diaria) tenía su propia lista por
  // fecha (day.priorities); ahora es la MISMA lista que "Pendientes de
  // la semana: Trabajo" de la vista Semanal. Cada prioridad existente
  // se migra a un pendiente de esa semana, asignado al día de la semana
  // de esa fecha y al bloque de oficina 10:00-14:00 por defecto (el
  // usuario puede cambiarlo después desde la vista Semanal). No usa
  // getWeek()/OFFICE_BLOCK_IDS a propósito: esta función corre antes de
  // que esas constantes se definan más abajo en el archivo.
  function migratePrioritiesToWeekTrabajo() {
    Object.keys(data.days || {})
      .sort()
      .forEach((dateStr) => {
        const day = data.days[dateStr];
        if (!day || !day.priorities || !day.priorities.length) return;
        const mondayStr = getMondayKey(dateStr);
        const dayKey = getWeekdayKey(dateStr);
        if (!data.weeks[mondayStr]) {
          data.weeks[mondayStr] = {
            metaSemana: "",
            revisionViernes: { cumplido: "", ajuste: "" },
            pendientesTrabajo: [],
            pendientesPersonal: [],
          };
        }
        if (!data.weeks[mondayStr].pendientesTrabajo) data.weeks[mondayStr].pendientesTrabajo = [];
        day.priorities.forEach((p) => {
          data.weeks[mondayStr].pendientesTrabajo.push({
            id: p.id,
            text: p.text,
            done: !!p.done,
            dayKeys: [dayKey],
            blockId: "oficina_manana",
          });
        });
        day.priorities = [];
      });
  }

  // Unifica el "Seguimiento de hábitos" de la Semanal (que tenía su
  // propio estado por semana+día, week.habits[habitId][dayKey]) con la
  // casilla de la Diaria (day.habits[habitId]): a partir de ahora es el
  // mismo dato (ver toggleWeekHabit). Traslada cualquier casilla ya
  // marcada en el sistema viejo a la fecha exacta que le corresponde
  // antes de descartarlo, para no perder lo que ya se hubiera tildado.
  function migrateWeekHabitsToDayHabits() {
    if (data.weekHabitsMigrated) return;
    data.weekHabitsMigrated = true;
    Object.keys(data.weeks || {}).forEach((mondayStr) => {
      const week = data.weeks[mondayStr];
      if (!week || !week.habits) return;
      Object.keys(week.habits).forEach((habitId) => {
        Object.entries(week.habits[habitId] || {}).forEach(([dayKey, done]) => {
          if (!done) return;
          const idx = ns.dateUtils.DAY_KEYS.indexOf(dayKey);
          if (idx === -1) return;
          const dateStr = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), idx));
          getDay(dateStr).habits[habitId] = true;
        });
      });
      delete week.habits;
    });
  }

  // La corrida larga del domingo pasó de marcarse "hecho" en el ítem
  // "Correr" del checklist de fin de semana (day.weekendChecklist) a
  // marcarse en day.blocks.correr.done, igual que entre semana (ver
  // buildWeekendRunBlock e isRunDayDone). Traslada una sola vez cualquier
  // "hecho" ya guardado de esa forma vieja, para no perder marcas ya
  // hechas (p.ej. domingos ya corridos) ni afectar la racha/contador.
  function migrateWeekendRunDoneToBlocks() {
    if (data.weekendRunDoneMigrated) return;
    data.weekendRunDoneMigrated = true;
    Object.keys(data.days || {}).forEach((dateStr) => {
      const day = data.days[dateStr];
      if (!day || !day.weekendChecklist) return;
      const item = day.weekendChecklist.find(
        (i) => i.key === "correr" || (i.key === undefined && i.text === "Correr")
      );
      if (!item || !item.done) return;
      if (!day.blocks) day.blocks = {};
      if (!day.blocks.correr) day.blocks.correr = {};
      day.blocks.correr.done = true;
    });
  }

  // Siembra data.runQueue (una sola vez: si ya existe, no hace nada,
  // para no pisar correcciones ya hechas con "Corregir" del nuevo
  // sistema). El 7, 9 y 11 de octubre ya habían pasado antes de que
  // existiera este motor de cola+puntero: se traducen de solo lectura
  // desde day.blocks.correr.done (sin cambiar ese valor en absoluto, ver
  // "NO TOQUES... ni fechas anteriores a hoy") para que el puntero
  // arranque en el lugar correcto y las reglas de parón tengan el
  // historial real desde el principio del plan, en vez de arrancar en
  // blanco como si nada hubiera pasado todavía esa primera semana.
  function migrateRunQueueSeed() {
    if (data.runQueue) return;
    data.runQueue = { resolutions: {} };
    ["2026-10-07", "2026-10-09", "2026-10-11"].forEach((d) => {
      if (isBlockDone(d, "correr")) ns.runQueue.markDoneAt(data.runQueue, d, d);
      else ns.runQueue.markSkippedAt(data.runQueue, d, d);
    });
  }

  // Migra, una sola vez, el texto libre que ya hubiera en el bloque
  // "previo_oficina" (de cualquier semana ya guardada, lunes a viernes)
  // al modelo nuevo de Sí/No + lista de paradas: cada fecha con texto
  // ahí pasa a "Sí", con ese texto como primera parada (conservando si
  // esa fecha ya estaba marcada cumplida), para no perder nada. Una
  // fecha sin texto en ese bloque simplemente queda sin responder
  // (pregunta visible), como corresponde.
  function migratePrevioOficinaToParadas() {
    if (data.previoOficinaMigrated) return;
    data.previoOficinaMigrated = true;
    const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];
    Object.keys(data.weekBlocks || {}).forEach((mondayStr) => {
      const weekBlocks = data.weekBlocks[mondayStr];
      WEEKDAY_KEYS.forEach((dayKey) => {
        const text = weekBlocks[dayKey] && weekBlocks[dayKey].previo_oficina;
        if (!text) return;
        const dateStr = dateForWeekday(mondayStr, dayKey);
        const day = getDay(dateStr);
        if (day.previoOficinaRespuesta) return; // ya tiene respuesta explícita: no debería pasar en esta migración, pero por las dudas no la pisa
        day.previoOficinaRespuesta = "si";
        const wasDone = !!(day.blocks.previo_oficina && day.blocks.previo_oficina.done);
        getWeek(mondayStr).paradasAntesOficina.push({
          id: uid("po"),
          text,
          done: wasDone,
          dayKeys: [dayKey],
        });
      });
    });
  }

  // Todas estas migraciones son idempotentes (cada una revisa su propia
  // bandera y no hace nada si ya corrió). Además de correr una vez al
  // cargar la app, se vuelven a correr cada vez que llega un estado
  // nuevo desde afuera (ver replaceAllData más abajo): si no fuera así,
  // cuando la sincronización con Firebase trae un documento remoto más
  // viejo (guardado antes de que existiera una corrección puntual como
  // migrateGymQueueCorrection2), ese estado viejo pisaría el corregido
  // sin que la corrección tuviera nunca la oportunidad de aplicarse.
  function runMigrations() {
    migrateToWeekdayTemplates();
    migrateWeekdayTemplatesToCurrentWeek();
    purgeFixedBlockText();
    migrateNocheBlockSplit();
    migrateGymQueue();
    migrateGymQueueCorrection();
    migrateGymQueueCorrection2();
    migrateGymQueueCorrection3();
    migrateGymQueueCorrection4();
    migrateGymBlocksStructure();
    migrateGymRoutinesSeed();
    migratePrioritiesToWeekTrabajo();
    migrateWeekHabitsToDayHabits();
    migrateWeekendRunDoneToBlocks();
    migrateRunQueueSeed();
    migratePrevioOficinaToParadas();
  }
  runMigrations();
  persist();

  function onChange(fn) {
    listeners.push(fn);
  }

  // Se dispara con CADA cambio guardado (incluye los que solo llaman a
  // persist() sin notify(), como el texto de los bloques). Pensado para
  // una capa externa de sincronización (ver js/firebaseSync.js): no
  // dispara un re-render de la UI, solo avisa "hay algo nuevo que subir".
  function onPersist(fn) {
    persistListeners.push(fn);
  }

  function notify() {
    persist();
    listeners.forEach((fn) => fn());
  }

  // Punto de conexión para sincronización externa (ver
  // js/firebaseSync.js): lee y reemplaza el bloque de datos completo,
  // sin que el resto de la app necesite saber que existe.
  function getRawData() {
    return data;
  }

  function replaceAllData(newData) {
    data = newData;
    runMigrations();
    notify();
  }

  // Cambia a qué respaldo local (ver js/storage.js) lee y escribe esta
  // sesión de ahora en más, y recarga `data` desde esa clave (en blanco
  // si es la primera vez que se usa). Lo llama firebaseSync en cada
  // inicio/cierre de sesión: evita que la agenda de una cuenta se mezcle
  // con la de otra, o con lo que hubiera sin sesión iniciada, en el
  // mismo dispositivo.
  function switchStorageKey(key) {
    activeStorageKey = key;
    data = storage.load(key);
    runMigrations();
    notify();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  // ---------- Hábitos (definiciones globales) ----------
  function getHabitsDefs() {
    return data.habitsDefs;
  }

  function addHabit(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    data.habitsDefs.push({ id: uid("h"), name: trimmed });
    notify();
  }

  function removeHabit(id) {
    data.habitsDefs = data.habitsDefs.filter((h) => h.id !== id);
    notify();
  }

  // ---------- Librería de comidas (catálogo permanente, sin fecha) ----------
  function getMealLibrary() {
    return data.mealLibrary;
  }

  // Agrega una comida si no existe ya una con el mismo nombre (sin
  // distinguir mayúsculas/minúsculas) y devuelve la comida resultante.
  function addMeal(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = data.mealLibrary.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const meal = { id: uid("m"), name: trimmed };
    data.mealLibrary.push(meal);
    notify();
    return meal;
  }

  // ---------- Comida (14:00-15:00, bloque "preparar_comida") ----------
  // Antes de elegir la comida del día, pregunta si se repite la de ayer
  // o si hoy se cocina algo (elegido del selector de siempre). La
  // respuesta vive por fecha (day.comidaRespuesta: "repite" | "cocino" |
  // "pending") y es independiente del toggle "día que cocino" (day.cocina,
  // ver setDayCocina): ninguna de las funciones de acá abajo lo lee ni
  // lo toca.
  //
  // "pending" es el resultado de tocar "Cambiar" (ver clearComidaAnswer):
  // vuelve a mostrar la pregunta aunque el bloque ya tenga una comida
  // guardada de antes (que no se borra, por si se vuelve a elegir sin
  // cambiarla). Sin ninguna de las tres guardada todavía, se trata como
  // "Cocino" ya respondido si YA había una comida elegida de antes de
  // que existiera esta pregunta (compatibilidad: no hace falta migrar
  // nada, se detecta sola con el texto que ya hubiera).
  const MEAL_BLOCK_ID = "preparar_comida";

  function getComidaAnswer(dateStr) {
    const day = data.days[dateStr];
    if (day && day.comidaRespuesta === "pending") return undefined;
    if (day && day.comidaRespuesta) return day.comidaRespuesta;
    if (getBlockText(dateStr, MEAL_BLOCK_ID)) return "cocino";
    return undefined;
  }

  function setComidaCocino(dateStr) {
    getDay(dateStr).comidaRespuesta = "cocino";
    notify();
  }

  // "Se repite": copia el VALOR (no vincula los días) de la comida del
  // día natural anterior. Devuelve true si copió algo; false si ayer no
  // tenía nada elegido (en ese caso igual queda en "Cocino", para que la
  // vista muestre el selector normal en vez de quedarse sin salida).
  function repeatYesterdayComida(dateStr) {
    const prevDateStr = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(dateStr), -1));
    const prevMeal = getBlockText(prevDateStr, MEAL_BLOCK_ID);
    if (!prevMeal) {
      getDay(dateStr).comidaRespuesta = "cocino";
      notify();
      return false;
    }
    setBlockText(dateStr, MEAL_BLOCK_ID, prevMeal);
    getDay(dateStr).comidaRespuesta = "repite";
    notify();
    return true;
  }

  // Enlace "Cambiar": vuelve a la pregunta sin responder.
  function clearComidaAnswer(dateStr) {
    getDay(dateStr).comidaRespuesta = "pending";
    notify();
  }

  function updateMeal(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const meal = data.mealLibrary.find((m) => m.id === id);
    if (meal) meal.name = trimmed;
    persist();
  }

  function removeMeal(id) {
    data.mealLibrary = data.mealLibrary.filter((m) => m.id !== id);
    notify();
  }

  // ---------- Frase del día ----------
  function shuffledIndices(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function ensureQuoteBag() {
    if (!data.quoteBag || !Array.isArray(data.quoteBag.order) || data.quoteBag.order.length !== QUOTES.length) {
      data.quoteBag = { order: shuffledIndices(QUOTES.length), pointer: 0 };
    }
  }

  function getQuoteForDay(dateStr) {
    const day = getDay(dateStr);
    if (typeof day.quoteIndex !== "number") {
      ensureQuoteBag();
      if (data.quoteBag.pointer >= data.quoteBag.order.length) {
        data.quoteBag = { order: shuffledIndices(QUOTES.length), pointer: 0 };
      }
      day.quoteIndex = data.quoteBag.order[data.quoteBag.pointer];
      data.quoteBag.pointer += 1;
      persist();
    }
    return QUOTES[day.quoteIndex] || QUOTES[0];
  }

  function ensureWordBag() {
    if (!data.wordBag || !Array.isArray(data.wordBag.order) || data.wordBag.order.length !== WORDS.length) {
      data.wordBag = { order: shuffledIndices(WORDS.length), pointer: 0 };
    }
  }

  function getWordForDay(dateStr) {
    const day = getDay(dateStr);
    if (typeof day.wordIndex !== "number") {
      ensureWordBag();
      if (data.wordBag.pointer >= data.wordBag.order.length) {
        data.wordBag = { order: shuffledIndices(WORDS.length), pointer: 0 };
      }
      day.wordIndex = data.wordBag.order[data.wordBag.pointer];
      data.wordBag.pointer += 1;
      persist();
    }
    return WORDS[day.wordIndex] || WORDS[0];
  }

  // ---------- Días ----------
  const WEEKEND_CHECKLIST_DEFAULTS = [
    "Diplomado",
    "Gimnasio (solo si falté algún día entre semana)",
    "Lavar ropa",
    "Limpiar departamento",
    "Crear contenido",
    "Editar video",
    "Escribir guiones",
    "Generar ideas de contenido",
    "Correr",
    "Lectura",
    "Oficina (ocasional)",
    "Comida",
  ];

  function defaultWeekendChecklist() {
    return WEEKEND_CHECKLIST_DEFAULTS.map((text) => ({
      id: uid("w"),
      text,
      done: false,
      key: text === "Correr" ? "correr" : null,
    }));
  }

  function isWeekendDate(dateStr) {
    return ns.dateUtils.isWeekend(ns.dateUtils.fromISO(dateStr));
  }

  function defaultDay() {
    return { cocina: true, blocks: {}, habits: {}, weekendChecklist: [] };
  }

  function getDay(dateStr) {
    if (!data.days[dateStr]) {
      data.days[dateStr] = defaultDay();
      // Los pendientes del fin de semana se precargan solo al crear el
      // día por primera vez, para que el usuario los pueda editar o
      // quitar después sin que reaparezcan.
      if (isWeekendDate(dateStr)) {
        data.days[dateStr].weekendChecklist = defaultWeekendChecklist();
      }
    }
    const day = data.days[dateStr];
    // Compatibilidad con días guardados antes del rediseño del horario.
    if (typeof day.cocina !== "boolean") day.cocina = true;
    if (!day.blocks) day.blocks = {};
    if (!day.weekendChecklist) day.weekendChecklist = [];
    delete day.hours;
    // "Prioridades del trabajo" dejó de ser una lista propia por fecha:
    // ahora es la misma lista que "Pendientes de la semana: Trabajo"
    // (ver migratePrioritiesToWeekTrabajo y getWorkPriorities).
    delete day.priorities;
    return day;
  }

  function getBlockText(dateStr, blockId) {
    return getWeekBlockTemplate(getMondayKey(dateStr), getWeekdayKey(dateStr))[blockId] || "";
  }

  // Corrida entre semana: mientras la fecha caiga dentro del rango
  // programado en trainingSchedule.js, el bloque se vuelve de solo
  // lectura con el texto calculado; fuera de rango, se comporta como
  // antes (editable, texto por plantilla semanal). El gimnasio tiene su
  // propia resolución vía la cola + puntero (ver getGymResolution).
  function getAutoBlockOverride(def, dateStr) {
    if (def.id === "correr") return ns.trainingSchedule.getRunText(dateStr);
    return undefined;
  }

  // Bloque de gimnasio del sábado: mismo tratamiento que entre semana
  // (mismo control "¿Entrenaste hoy?"), pero solo aparece si la cuenta
  // tiene gimnasio configurado (por ahora, solo la cuenta migrada — ver
  // js/userConfig.js; una cuenta de onboarding sin gimnasio no ve nada
  // acá, consistente con que esos módulos avanzados no le aplican
  // todavía). El sábado es comodín: si no hay ninguna sesión atrasada
  // de esa semana, se muestra como "Descanso", de solo lectura.
  function buildSaturdayGymBlock(dateStr) {
    const weekdayGymDef = ns.scheduleDefs.getBlocks(true).find((d) => d.id === "gimnasio");
    if (!weekdayGymDef) return null;
    if (isGymUnavailable(dateStr)) {
      return { ...weekdayGymDef, fixed: true, text: "No disponible", done: false, gymStatus: "unavailable" };
    }
    const r = getGymResolution(dateStr);
    if (r) {
      return {
        ...weekdayGymDef,
        fixed: true,
        text: r.session,
        gymDiariaText: `Día ${r.dayNumber} - ${r.session}`,
        done: r.status === "done",
        gymStatus: r.status,
        gymBlockNumber: r.blockNumber,
      };
    }
    return { ...weekdayGymDef, fixed: true, text: "Descanso", done: false, gymStatus: "rest" };
  }

  // Fechas fijas e inamovibles del plan (ver js/runQueue.js): el ensayo y
  // la carrera nunca se mueven ni se recalculan por la cola, pero si el
  // plan quedó "en riesgo" para el ensayo (ver getRunRisk) y la persona
  // acepta el ajuste propuesto (ver setRunRiskAccepted), estas dos
  // fechas cambian su texto por la meta reducida — de forma pegajosa:
  // una vez aceptada, el texto ajustado queda aunque después se alcance
  // el ritmo original, para no ir cambiando la meta de un lado a otro.
  const RUN_RISK_ENSAYO_DATE = "2026-11-15";
  const RUN_RISK_CARRERA_DATE = "2026-11-29";
  const RUN_RISK_ENSAYO_TEXT = "Correr - 10km (9 min corriendo / 1 min caminando)";
  const RUN_RISK_CARRERA_TEXT = "Carrera - 10km (9 min corriendo / 1 min caminando)";

  // Corrida larga de fin de semana (sábado o domingo, según lo que
  // traiga el plan). Dos fuentes, según la fecha:
  // - Dentro del tramo deslizante (ver runQueue.isManagedDate): la cola
  //   con puntero, igual que entre semana (ver getDayBlocks).
  // - Fuera de ese tramo (fijo: ensayo, semanas ancladas y carrera):
  //   sigue viniendo de trainingSchedule.getSundayRunText como antes, de
  //   solo lectura con la casilla simple de siempre
  //   (day.blocks.correr.done). La carrera usa "Carrera - " en vez de
  //   "Correr - " (formato del plan, ver PARTE D), y tanto ella como el
  //   ensayo pueden mostrar la meta ajustada si se aceptó el aviso de
  //   riesgo.
  // Mismo tratamiento visual en los dos casos: "Mañana" como franja en
  // vez de un horario inventado (el plan no fija hora los fines de
  // semana). null si esta fecha no tiene corrida programada en el plan.
  function buildWeekendRunBlock(dateStr) {
    if (ns.runQueue.isManagedDate(dateStr)) {
      const r = getRunResolution(dateStr);
      if (!r) return null;
      return {
        id: "correr",
        time: "Mañana",
        label: "Correr",
        fixed: true,
        text: r.session.text,
        done: r.status === "done",
        runStatus: r.status,
        runBadge: r.badge,
      };
    }

    if (dateStr === RUN_RISK_CARRERA_DATE) {
      const text = isRunRiskAccepted() ? RUN_RISK_CARRERA_TEXT : "Carrera - 10km";
      return { id: "correr", time: "Mañana", label: "Correr", fixed: true, text, done: isBlockDone(dateStr, "correr") };
    }

    const runText = ns.trainingSchedule.getSundayRunText(dateStr);
    if (runText === undefined) return null;
    const text =
      dateStr === RUN_RISK_ENSAYO_DATE && isRunRiskAccepted() ? RUN_RISK_ENSAYO_TEXT : `Correr - ${runText}`;
    return { id: "correr", time: "Mañana", label: "Correr", fixed: true, text, done: isBlockDone(dateStr, "correr") };
  }

  // ---------- Corrida: cola con puntero (ver js/runQueue.js) ----------
  function getRunResolution(dateStr) {
    if (!data.runQueue || !ns.runQueue.isManagedDate(dateStr)) return null;
    const todayStr = toISO(new Date());
    return ns.runQueue.resolve(data.runQueue, dateStr, todayStr);
  }

  function markRunDone(dateStr) {
    if (!data.runQueue) return;
    const todayStr = toISO(new Date());
    if (ns.runQueue.markDoneAt(data.runQueue, dateStr, todayStr)) notify();
  }

  function markRunSkipped(dateStr) {
    if (!data.runQueue) return;
    const todayStr = toISO(new Date());
    if (ns.runQueue.markSkippedAt(data.runQueue, dateStr, todayStr)) notify();
  }

  // Corrige una respuesta de corrida ya guardada (igual que editGymDay):
  // si el cambio choca con una fecha posterior ya confirmada, no cambia
  // nada y devuelve el conflicto para que la UI lo muestre.
  function editRunDay(dateStr, done) {
    if (!data.runQueue) return { ok: false, reason: "not-resolved" };
    const todayStr = toISO(new Date());
    const result = ns.runQueue.editResolution(data.runQueue, dateStr, todayStr, done ? "done" : "skipped");
    if (result.ok && result.changed) notify();
    return result;
  }

  // true si, con el historial real hasta ahora, la reproyección no
  // llega de forma segura al ensayo del 15 nov ni comprimiendo al tope
  // permitido (ver PARTE C del pedido original / runQueue.js).
  function getRunRisk() {
    if (!data.runQueue) return false;
    const todayStr = toISO(new Date());
    return ns.runQueue.getProjection(data.runQueue, todayStr).risk;
  }

  function isRunRiskAccepted() {
    return !!data.runRiskAccepted;
  }

  function setRunRiskAccepted(accepted) {
    data.runRiskAccepted = !!accepted;
    notify();
  }

  function getDayBlocks(dateStr) {
    const day = getDay(dateStr);
    const isWeekend = isWeekendDate(dateStr);
    const defs = isWeekend ? ns.scheduleDefs.getWeekendBlocks() : ns.scheduleDefs.getBlocks(day.cocina);
    const blocks = defs.map((def) => {
      const done = !!(day.blocks[def.id] && day.blocks[def.id].done);
      if (def.marker) return { ...def, text: "", done };

      if (def.id === "gimnasio") {
        if (isGymUnavailable(dateStr)) {
          return { ...def, fixed: true, text: "No disponible", done: false, gymStatus: "unavailable" };
        }
        const r = getGymResolution(dateStr);
        if (r) {
          return {
            ...def,
            fixed: true,
            text: r.session,
            gymDiariaText: `Día ${r.dayNumber} - ${r.session}`,
            done: r.status === "done",
            gymStatus: r.status,
            gymBlockNumber: r.blockNumber,
          };
        }
        // Sin datos (antes de que arrancara este sistema, o cola ya
        // agotada): sigue igual que antes, editable manual.
      }

      if (def.id === "correr" && ns.runQueue.isManagedDate(dateStr)) {
        const r = getRunResolution(dateStr);
        if (r) {
          return {
            ...def,
            fixed: true,
            text: r.session.text,
            done: r.status === "done",
            runStatus: r.status,
            runBadge: r.badge,
          };
        }
      }

      // Pregunta "¿Habrá paradas antes de la oficina?" (ver PARTE 1-3
      // del pedido): reemplaza por completo el texto libre de siempre de
      // este bloque. "done" no aplica más acá (antes era una casilla
      // simple del bloque; ahora el cumplido vive por parada, o no
      // aplica en absoluto si la respuesta es "No").
      if (def.id === "previo_oficina") {
        return { ...def, fixed: true, text: "", done: false, previoOficinaAnswer: getPrevioOficinaAnswer(dateStr) || null };
      }

      // Con "No", la oficina de la mañana se corre a 09:00-14:00; con
      // "Sí" o sin responder todavía, sigue 10:00-14:00 de siempre (cae
      // al tratamiento genérico de más abajo, sin tocar nada).
      if (def.id === "oficina_manana" && getPrevioOficinaAnswer(dateStr) === "no") {
        return { ...def, time: "09:00–14:00", fixed: true, text: "", done, previoOficinaMerged: true };
      }

      const override = getAutoBlockOverride(def, dateStr);
      if (override !== undefined) {
        return { ...def, fixed: true, text: override, done };
      }

      return {
        ...def,
        text: def.fixed ? "" : getBlockText(dateStr, def.id),
        done,
      };
    });

    let result = blocks;
    if (isWeekend && ns.dateUtils.isoWeekday(ns.dateUtils.fromISO(dateStr)) === 5) {
      const satGym = buildSaturdayGymBlock(dateStr);
      if (satGym) result = [satGym, ...result];
    }

    if (isWeekend) {
      const weekendRun = buildWeekendRunBlock(dateStr);
      if (weekendRun) result = [weekendRun, ...result];
    }

    // Excepción puntual de la cuenta dueña (ver
    // trainingSchedule.getSpecialMorningRunText): el único día de todo
    // el plan donde la corrida va a la mañana, justo después del
    // gimnasio, en vez de en el bloque de la tarde de siempre (que ese
    // día queda vacío vía RUN_WEEKDAY_TEXT). No le aplica en absoluto a
    // una cuenta de onboarding (nunca tiene bloque "gimnasio").
    if (!ns.scheduleDefs.isOnboardingSchedule()) {
      const specialRunText = ns.trainingSchedule.getSpecialMorningRunText(dateStr);
      if (specialRunText) {
        const morningRunBlock = {
          id: "correr",
          time: "07:00–07:30",
          label: "Correr",
          fixed: true,
          text: specialRunText,
          done: isBlockDone(dateStr, "correr"),
        };
        const gymIdx = result.findIndex((b) => b.id === "gimnasio");
        const insertAt = gymIdx === -1 ? 0 : gymIdx + 1;
        result = [...result.slice(0, insertAt), morningRunBlock, ...result.slice(insertAt)];
      }
    }

    // Bloque de la meta genérica (cuentas de onboarding, ver
    // js/userGoal.js): igual que cualquier bloque flexible (label fijo,
    // texto y cumplido editables día por día), solo que aparece nada más
    // en los días/fecha que le correspondan.
    const goalDef = ns.userGoal.getBlockForDate(dateStr);
    if (goalDef) {
      const goalBlock = { ...goalDef, text: getBlockText(dateStr, goalDef.id), done: isBlockDone(dateStr, goalDef.id) };
      result = isWeekend ? [goalBlock, ...result] : insertBlockByTime(result, goalBlock);
    }

    // Bloques personales de onboarding/Configuración (ver
    // js/userConfig.js: normalizePersonalBlock): cada uno decide, para
    // esta fecha puntual, si aplica (según el día de la semana), con qué
    // horario (único o el específico de ese día) y si tiene o no campo
    // de comentario libre (`fixed: true` = no, mismo tratamiento visual
    // que un bloque fijo tipo "Oficina": solo etiqueta + casilla). No le
    // aplica a la cuenta dueña ni a ninguna migrada con horario propio
    // (getPersonalBlocksForDate devuelve [] si no hay `personalBlocks`).
    const personalBlocks = ns.scheduleDefs.getPersonalBlocksForDate(dateStr).map((def) => ({
      ...def,
      text: def.fixed ? "" : getBlockText(dateStr, def.id),
      done: isBlockDone(dateStr, def.id),
    }));
    if (isWeekend) {
      result = [...personalBlocks, ...result];
    } else {
      personalBlocks.forEach((personalBlock) => {
        result = insertBlockByTime(result, personalBlock);
      });
    }
    return result;
  }

  // Inserta un bloque en la posición que le toca por hora de inicio
  // ("HH:MM" o "HH:MM–HH:MM..."), para intercalarlo en la lista plana ya
  // ordenada de una cuenta de onboarding sin tener que reordenar todo.
  function insertBlockByTime(blocks, block) {
    const startOf = (b) => (b.time || "").split(/[–-]/)[0].trim();
    const start = startOf(block);
    const idx = blocks.findIndex((b) => startOf(b) > start);
    const copy = blocks.slice();
    if (idx === -1) copy.push(block);
    else copy.splice(idx, 0, block);
    return copy;
  }

  // El ítem "Correr" del checklist de fin de semana YA NO se usa para
  // mostrar la corrida programada: cuando la fecha cae dentro del plan
  // (trainingSchedule.getSundayRunText), esa sesión ahora tiene su propio
  // bloque fijo unificado en la línea de tiempo (ver buildWeekendRunBlock
  // más arriba), igual que entre semana. Por eso se lo saca por completo
  // de este checklist en esas fechas, para no duplicarla ni mostrarla
  // nunca como texto libre. Fuera del plan (sábados, o domingos sin
  // sesión programada) el ítem sigue intacto, exactamente como antes.
  //
  // El atraso de gimnasio del sábado YA NO vive acá: ahora es un bloque
  // propio en la línea de tiempo de la Diaria (ver buildSaturdayGymBlock
  // más abajo), con el mismo control "¿Entrenaste hoy?" que entre
  // semana, en vez de una fila más de este checklist.
  function getWeekendChecklist(dateStr) {
    const items = getDay(dateStr).weekendChecklist;
    const hasPlannedRun = ns.trainingSchedule.getSundayRunText(dateStr) !== undefined;
    return items.filter((item) => {
      const isCorrerItem = item.key === "correr" || (item.key === undefined && item.text === "Correr");
      return !(isCorrerItem && hasPlannedRun);
    });
  }

  function addWeekendItem(dateStr, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    getDay(dateStr).weekendChecklist.push({ id: uid("w"), text: trimmed, done: false });
    notify();
  }

  function removeWeekendItem(dateStr, id) {
    const day = getDay(dateStr);
    day.weekendChecklist = day.weekendChecklist.filter((item) => item.id !== id);
    notify();
  }

  function toggleWeekendItem(dateStr, id) {
    const day = getDay(dateStr);
    const item = day.weekendChecklist.find((item) => item.id === id);
    if (item) item.done = !item.done;
    notify();
  }

  function setDayCocina(dateStr, cocina) {
    getDay(dateStr).cocina = !!cocina;
    notify();
  }

  // El texto se guarda en la plantilla de ESA semana específica + día de
  // la semana correspondiente a esta fecha: se edita una sola vez y se
  // ve igual en la vista diaria y en la semanal para cualquier fecha con
  // ese mismo día dentro de esa misma semana, pero no se comparte con
  // otras semanas.
  function setBlockText(dateStr, blockId, text) {
    getWeekBlockTemplate(getMondayKey(dateStr), getWeekdayKey(dateStr))[blockId] = text;
    persist();
  }

  // Copia el texto de los bloques FLEXIBLES (bloque libre, bloques
  // personales, comida, etc.) de la semana inmediata anterior hacia la
  // semana indicada. Es una copia única: desde este momento las dos
  // semanas quedan completamente independientes.
  //
  // Gimnasio y corrida quedan afuera a propósito, aunque en la práctica
  // casi nunca tengan texto propio guardado acá (su contenido real sale
  // de la cola+puntero y del plan por fecha, no de este texto libre):
  // si alguna fecha puntual llegó a tener texto manual ahí (antes de que
  // arrancara alguno de esos dos sistemas, o fuera del rango del plan de
  // corrida), ese texto tampoco se replica, para que esos dos bloques
  // sigan siendo 100% automáticos en la semana nueva.
  //
  // "Meta de la semana", "Pendientes de la semana", "Seguimiento de
  // hábitos" y "Revisión del viernes" viven en otra parte del dato
  // (getWeek / data.days[].habits), que esta función ni toca.
  const REPLICATE_EXCLUDED_BLOCK_IDS = ["gimnasio", "correr"];

  function weekHasAnyBlockText(mondayStr) {
    const week = data.weekBlocks && data.weekBlocks[mondayStr];
    if (!week) return false;
    return Object.values(week).some((dayFields) =>
      Object.entries(dayFields || {}).some(
        ([blockId, text]) => !REPLICATE_EXCLUDED_BLOCK_IDS.includes(blockId) && !!text
      )
    );
  }

  const REPLICATE_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];

  function replicatePreviousWeek(mondayStr) {
    const prevMondayStr = ns.dateUtils.toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), -7));
    const prevWeek = (data.weekBlocks && data.weekBlocks[prevMondayStr]) || {};
    const copied = {};
    Object.entries(prevWeek).forEach(([dayKey, dayFields]) => {
      const filtered = {};
      Object.entries(dayFields || {}).forEach(([blockId, text]) => {
        if (!REPLICATE_EXCLUDED_BLOCK_IDS.includes(blockId)) filtered[blockId] = text;
      });
      copied[dayKey] = filtered;
    });

    // Paradas antes de oficina (Sí/No por fecha + la lista de esa
    // semana): se copian con el mismo criterio que el texto libre de
    // arriba — reemplaza lo que hubiera en la semana destino por lo de
    // la semana anterior, sin la casilla de cumplido (igual que el resto
    // de la réplica no copia "hecho", solo contenido).
    const prevParadas = getWeekIfExists(prevMondayStr);
    const copiedParadas = (prevParadas ? prevParadas.paradasAntesOficina : []).map((p) => ({
      id: uid("po"),
      text: p.text,
      done: false,
      dayKeys: p.dayKeys.slice(),
    }));
    const oldRespuestas = {};
    const newRespuestas = {};
    // Comida: la pregunta "¿Se repite la comida de ayer?" (day.
    // comidaRespuesta) no se copia de la semana anterior como tal — se
    // LIMPIA en la semana destino (igual que el resto de la réplica,
    // "reemplaza lo que hubiera") para que la comida recién copiada en
    // data.weekBlocks de más abajo se vea sola vía la compatibilidad de
    // getComidaAnswer, en vez de quedar tapada por un "pending"/
    // "repite"/"cocino" viejo de antes de replicar.
    const oldComidaRespuestas = {};
    REPLICATE_WEEKDAY_KEYS.forEach((dayKey) => {
      const targetDateStr = dateForWeekday(mondayStr, dayKey);
      const prevDateStr = dateForWeekday(prevMondayStr, dayKey);
      oldRespuestas[dayKey] = (data.days[targetDateStr] && data.days[targetDateStr].previoOficinaRespuesta) || null;
      newRespuestas[dayKey] = (data.days[prevDateStr] && data.days[prevDateStr].previoOficinaRespuesta) || null;
      oldComidaRespuestas[dayKey] = (data.days[targetDateStr] && data.days[targetDateStr].comidaRespuesta) || null;
    });

    // Respaldo para "Deshacer réplica" (ver undoReplicateWeek): guarda
    // tal cual estaban, de una sola vez, ANTES de pisarlos, los campos
    // que esta función toca (data.weekBlocks[mondayStr], las paradas de
    // esa semana, la respuesta Sí/No de "paradas antes de oficina" y la
    // de "comida" de cada día). Una réplica nueva sobre la misma semana
    // reemplaza el respaldo anterior — solo se puede deshacer la última.
    if (!data.weekReplicateBackups) data.weekReplicateBackups = {};
    const existing = data.weekBlocks && data.weekBlocks[mondayStr];
    data.weekReplicateBackups[mondayStr] = {
      weekBlocks: existing ? JSON.parse(JSON.stringify(existing)) : null,
      paradas: JSON.parse(JSON.stringify(getWeek(mondayStr).paradasAntesOficina)),
      previoOficinaRespuestas: oldRespuestas,
      comidaRespuestas: oldComidaRespuestas,
      replicatedAt: Date.now(),
    };

    if (!data.weekBlocks) data.weekBlocks = {};
    data.weekBlocks[mondayStr] = copied;
    getWeek(mondayStr).paradasAntesOficina = copiedParadas;
    REPLICATE_WEEKDAY_KEYS.forEach((dayKey) => {
      const targetDateStr = dateForWeekday(mondayStr, dayKey);
      const answer = newRespuestas[dayKey];
      if (answer) getDay(targetDateStr).previoOficinaRespuesta = answer;
      else if (data.days[targetDateStr]) delete data.days[targetDateStr].previoOficinaRespuesta;
      if (data.days[targetDateStr]) delete data.days[targetDateStr].comidaRespuesta;
    });
    notify();
  }

  // true si esa semana tiene un respaldo de la última réplica todavía
  // sin deshacer (controla si el botón "Deshacer réplica" está
  // habilitado).
  function hasReplicateBackup(mondayStr) {
    return !!(data.weekReplicateBackups && data.weekReplicateBackups[mondayStr]);
  }

  // Restituye lo que tocó la última réplica sobre esa semana
  // (data.weekBlocks[mondayStr], las paradas antes de oficina y la
  // respuesta Sí/No de cada día) al estado guardado justo antes de
  // aplicarla, y borra el respaldo para que no se pueda aplicar dos
  // veces. No toca gimnasio, corrida, meta, pendientes de trabajo/vida
  // personal, hábitos ni revisión del viernes: ninguno de esos vive en
  // estos campos, así que la réplica nunca los tocó y deshacer tampoco.
  function undoReplicateWeek(mondayStr) {
    if (!hasReplicateBackup(mondayStr)) return false;
    const backup = data.weekReplicateBackups[mondayStr];
    if (backup.weekBlocks === null) {
      if (data.weekBlocks) delete data.weekBlocks[mondayStr];
    } else {
      if (!data.weekBlocks) data.weekBlocks = {};
      data.weekBlocks[mondayStr] = backup.weekBlocks;
    }
    getWeek(mondayStr).paradasAntesOficina = backup.paradas || [];
    if (backup.previoOficinaRespuestas) {
      REPLICATE_WEEKDAY_KEYS.forEach((dayKey) => {
        const targetDateStr = dateForWeekday(mondayStr, dayKey);
        const answer = backup.previoOficinaRespuestas[dayKey];
        if (answer) getDay(targetDateStr).previoOficinaRespuesta = answer;
        else if (data.days[targetDateStr]) delete data.days[targetDateStr].previoOficinaRespuesta;
      });
    }
    if (backup.comidaRespuestas) {
      REPLICATE_WEEKDAY_KEYS.forEach((dayKey) => {
        const targetDateStr = dateForWeekday(mondayStr, dayKey);
        const answer = backup.comidaRespuestas[dayKey];
        if (answer) getDay(targetDateStr).comidaRespuesta = answer;
        else if (data.days[targetDateStr]) delete data.days[targetDateStr].comidaRespuesta;
      });
    }
    delete data.weekReplicateBackups[mondayStr];
    notify();
    return true;
  }

  function toggleBlockDone(dateStr, blockId) {
    const day = getDay(dateStr);
    if (!day.blocks[blockId]) day.blocks[blockId] = { text: "", done: false };
    day.blocks[blockId].done = !day.blocks[blockId].done;
    notify();
  }

  function toggleDayHabit(dateStr, habitId) {
    const day = getDay(dateStr);
    day.habits[habitId] = !day.habits[habitId];
    notify();
  }

  function isDayHabitDone(dateStr, habitId) {
    return !!getDay(dateStr).habits[habitId];
  }

  // ---------- Semanas ----------
  function defaultWeek() {
    return {
      metaSemana: "",
      revisionViernes: { cumplido: "", ajuste: "" },
      pendientesTrabajo: [],
      pendientesPersonal: [],
      paradasAntesOficina: [],
    };
  }

  // Compatibilidad con semanas guardadas antes de esta sección, antes de
  // poder elegir bloque (antes siempre se mostraban en el de 10:00-14:00)
  // y antes de poder asignar varios días (el día único se convierte en
  // una lista de un solo día). Separado de getWeek para poder aplicarlo
  // también al leer una semana ya existente sin crear una nueva si no la
  // hubiera (ver getWeekIfExists, usado por el panel de no cumplidos de
  // la semana anterior).
  function normalizeWeekCompat(week) {
    if (!week.pendientesTrabajo) week.pendientesTrabajo = [];
    if (!week.pendientesPersonal) week.pendientesPersonal = [];
    if (!week.paradasAntesOficina) week.paradasAntesOficina = [];
    week.pendientesTrabajo.forEach((p) => {
      if (!OFFICE_BLOCK_IDS.includes(p.blockId)) p.blockId = DEFAULT_OFFICE_BLOCK_ID;
      if (!Array.isArray(p.dayKeys)) {
        p.dayKeys = p.dayKey ? [p.dayKey] : [];
        delete p.dayKey;
      }
    });
    return week;
  }

  function getWeek(mondayStr) {
    if (!data.weeks[mondayStr]) {
      data.weeks[mondayStr] = defaultWeek();
    }
    return normalizeWeekCompat(data.weeks[mondayStr]);
  }

  // Lectura pura: a diferencia de getWeek, no crea la semana si no
  // existe todavía (para no dejar semanas vacías guardadas solo por
  // haberlas mirado, p. ej. al calcular los pendientes de la semana
  // anterior de la primera semana que se usó la app).
  function getWeekIfExists(mondayStr) {
    const week = data.weeks[mondayStr];
    return week ? normalizeWeekCompat(week) : null;
  }

  // ---------- Pendientes de la semana: Trabajo ----------
  // Bloques de oficina a los que se puede asignar un pendiente de trabajo.
  const OFFICE_BLOCK_IDS = ["oficina_manana", "tarde_oficina"];
  const DEFAULT_OFFICE_BLOCK_ID = "oficina_manana";

  // Cada pendiente pertenece a una sola semana específica y, de forma
  // opcional, a uno o varios días de esa semana (dayKeys vacío = "sin
  // asignar"), más el bloque de oficina de esos días (10:00-14:00 o
  // 16:30-19:00) donde se debe mostrar. Es el mismo dato en la vista
  // semanal y la diaria, así que marcar cumplido en una se refleja en
  // la otra, y aparece en el bloque de CADA día asignado.
  function getWeekTrabajoPendientes(mondayStr) {
    return getWeek(mondayStr).pendientesTrabajo;
  }

  // Devuelve el id del pendiente creado (ver js/quickCapture.js: lo
  // necesita para poder deshacer la captura rápida desde la Diaria sin
  // tener que volver a buscarlo por texto/fecha). Nadie más usaba el
  // valor de retorno antes de esto, así que agregarlo no cambia nada
  // para los llamadores existentes.
  function addWeekTrabajoPendiente(mondayStr, text, dayKeys, blockId) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const keys = Array.isArray(dayKeys) ? dayKeys.filter(Boolean) : dayKeys ? [dayKeys] : [];
    const item = {
      id: uid("wt"),
      text: trimmed,
      done: false,
      dayKeys: keys,
      blockId: OFFICE_BLOCK_IDS.includes(blockId) ? blockId : DEFAULT_OFFICE_BLOCK_ID,
    };
    getWeek(mondayStr).pendientesTrabajo.push(item);
    notify();
    return item.id;
  }

  function removeWeekTrabajoPendiente(mondayStr, id) {
    const week = getWeek(mondayStr);
    week.pendientesTrabajo = week.pendientesTrabajo.filter((p) => p.id !== id);
    notify();
  }

  function toggleWeekTrabajoPendiente(mondayStr, id) {
    const week = getWeek(mondayStr);
    const p = week.pendientesTrabajo.find((p) => p.id === id);
    if (p) p.done = !p.done;
    notify();
  }

  function toggleWeekTrabajoPendienteDay(mondayStr, id, dayKey) {
    const week = getWeek(mondayStr);
    const p = week.pendientesTrabajo.find((p) => p.id === id);
    if (!p) return;
    const idx = p.dayKeys.indexOf(dayKey);
    if (idx === -1) p.dayKeys.push(dayKey);
    else p.dayKeys.splice(idx, 1);
    notify();
  }

  function setWeekTrabajoPendienteBlock(mondayStr, id, blockId) {
    const week = getWeek(mondayStr);
    const p = week.pendientesTrabajo.find((p) => p.id === id);
    if (p) p.blockId = OFFICE_BLOCK_IDS.includes(blockId) ? blockId : DEFAULT_OFFICE_BLOCK_ID;
    notify();
  }

  // ---------- Pendientes de la semana: Vida personal ----------
  // Mismo criterio que "Trabajo" (día(s) asignados, opcional), pero sin
  // bloque de oficina: un pendiente personal no vive en un horario de
  // oficina específico. getUnfinishedPendientesFromPreviousWeek y
  // movePendienteToWeek ya sabían tratar esta lista de forma genérica
  // (ver PENDIENTE_LIST_KEYS más abajo); lo único que faltaba era poder
  // crear uno — hasta ahora solo llegaban acá reasignados desde la
  // semana anterior. Ver también addInboxItem/assignInboxItem: la
  // Bandeja de entrada de captura rápida usa esta misma función.
  function getWeekPersonalPendientes(mondayStr) {
    return getWeek(mondayStr).pendientesPersonal;
  }

  function addWeekPersonalPendiente(mondayStr, text, dayKeys) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const keys = Array.isArray(dayKeys) ? dayKeys.filter(Boolean) : dayKeys ? [dayKeys] : [];
    getWeek(mondayStr).pendientesPersonal.push({
      id: uid("wp"),
      text: trimmed,
      done: false,
      dayKeys: keys,
    });
    notify();
  }

  function removeWeekPersonalPendiente(mondayStr, id) {
    const week = getWeek(mondayStr);
    week.pendientesPersonal = week.pendientesPersonal.filter((p) => p.id !== id);
    notify();
  }

  function toggleWeekPersonalPendiente(mondayStr, id) {
    const week = getWeek(mondayStr);
    const p = week.pendientesPersonal.find((p) => p.id === id);
    if (p) p.done = !p.done;
    notify();
  }

  function toggleWeekPersonalPendienteDay(mondayStr, id, dayKey) {
    const week = getWeek(mondayStr);
    const p = week.pendientesPersonal.find((p) => p.id === id);
    if (!p) return;
    const idx = p.dayKeys.indexOf(dayKey);
    if (idx === -1) p.dayKeys.push(dayKey);
    else p.dayKeys.splice(idx, 1);
    notify();
  }

  // ---------- Bandeja de entrada (captura rápida) ----------
  // Lista simple de texto sin asignar, pensada para el botón flotante
  // "+" (ver js/quickCapture.js): anotar algo en dos segundos, sin
  // elegir todavía si es de trabajo o personal ni qué día. Vive en el
  // mismo documento de datos (namespaced por UID), así que sincroniza
  // con Firebase igual que el resto — una cuenta existente simplemente
  // no tiene `data.inboxItems` todavía, y arranca como [] sola, sin
  // ningún paso de migración aparte.
  function getInboxItems() {
    return (data.inboxItems || []).slice();
  }

  function addInboxItem(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    if (!data.inboxItems) data.inboxItems = [];
    data.inboxItems.push({ id: uid("inbox"), text: trimmed, createdAt: Date.now() });
    notify();
  }

  function removeInboxItem(id) {
    if (!data.inboxItems) return;
    data.inboxItems = data.inboxItems.filter((it) => it.id !== id);
    notify();
  }

  // Saca el ítem de la Bandeja y lo agrega a los pendientes de la semana
  // indicada, en la lista que corresponda ("trabajo" o "personal"). No
  // es una copia: si por algún motivo no hay texto (ítem ya borrado), no
  // hace nada.
  function assignInboxItem(id, listKey, mondayStr, dayKeys, blockId) {
    const item = (data.inboxItems || []).find((it) => it.id === id);
    if (!item) return;
    if (listKey === "trabajo") addWeekTrabajoPendiente(mondayStr, item.text, dayKeys, blockId);
    else addWeekPersonalPendiente(mondayStr, item.text, dayKeys);
    removeInboxItem(id);
  }

  // Pendientes de trabajo de ESTA fecha específica asignados a su día de
  // la semana y al bloque de oficina indicado, dentro de la semana a la
  // que pertenece esa fecha.
  function getOfficePendientes(dateStr, blockId) {
    const dayKey = getWeekdayKey(dateStr);
    return getWeek(getMondayKey(dateStr)).pendientesTrabajo.filter(
      (p) => p.dayKeys.includes(dayKey) && p.blockId === blockId
    );
  }

  function toggleOfficePendiente(dateStr, id) {
    toggleWeekTrabajoPendiente(getMondayKey(dateStr), id);
  }

  // Opciones para el selector de bloque al agregar un pendiente de
  // trabajo (Diaria y Semanal): en vez de una etiqueta de horario fija
  // en el código, se arma leyendo los bloques de oficina reales de la
  // cuenta (una franja o dos, con sus horas propias), así que muestra
  // el horario que de verdad tenga cada cuenta. No depende de la fecha
  // que se esté viendo (los bloques de oficina son estructurales, no
  // cambian entre semanas) para que siga funcionando igual aunque se
  // esté agregando el pendiente desde un fin de semana.
  function getOfficeBlockOptions() {
    return ns.scheduleDefs
      .getBlocks(true)
      .filter((b) => OFFICE_BLOCK_IDS.includes(b.id))
      .map((b) => ({ value: b.id, label: b.time || b.label }));
  }

  // ---------- Pendientes no cumplidos de la semana anterior ----------
  // Listas de pendientes por semana que soportan este panel: por ahora
  // "Trabajo", "Vida personal" y "Paradas antes de oficina" (ver más
  // abajo) tienen forma de agregar ítems.
  const PENDIENTE_LIST_KEYS = ["pendientesTrabajo", "pendientesPersonal", "paradasAntesOficina"];

  // Todos los pendientes sin marcar de la semana INMEDIATA anterior a
  // `mondayStr` (la que se esté mirando en la vista Semanal, no
  // necesariamente "hoy"). Se recalcula solo con la fecha, sin guardar
  // nada: si esa semana anterior nunca se usó, da una lista vacía.
  function getUnfinishedPendientesFromPreviousWeek(mondayStr) {
    const previousMonday = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), -7));
    const week = getWeekIfExists(previousMonday);
    const items = [];
    if (week) {
      PENDIENTE_LIST_KEYS.forEach((listKey) => {
        (week[listKey] || []).forEach((p) => {
          if (!p.done) items.push({ ...p, listKey });
        });
      });
    }
    return { previousMonday, items };
  }

  // Reasigna (no duplica) un pendiente de una semana vieja a otra: lo
  // saca de la lista de origen y lo agrega a la de destino con el
  // día/bloque nuevos elegidos y la casilla de cumplido reiniciada.
  function movePendienteToWeek(fromMondayStr, listKey, id, toMondayStr, dayKeys, blockId) {
    const fromWeek = data.weeks[fromMondayStr];
    if (!fromWeek || !Array.isArray(fromWeek[listKey])) return;
    const idx = fromWeek[listKey].findIndex((p) => p.id === id);
    if (idx === -1) return;
    const [item] = fromWeek[listKey].splice(idx, 1);
    item.done = false;
    item.dayKeys = Array.isArray(dayKeys) ? dayKeys.filter(Boolean) : [];
    if (listKey === "pendientesTrabajo") {
      item.blockId = OFFICE_BLOCK_IDS.includes(blockId) ? blockId : DEFAULT_OFFICE_BLOCK_ID;
    }
    getWeek(toMondayStr)[listKey].push(item);
    notify();
  }

  // ---------- "Prioridades del trabajo" (vista Diaria) ----------
  // Es la misma lista y el mismo dato que "Pendientes de la semana:
  // Trabajo" de la vista Semanal (pendientesTrabajo), no un sistema
  // aparte: acá solo se combinan los dos bloques de oficina para
  // mostrar/agregar desde la fecha que se está viendo, sin tener que
  // elegir día (se asigna solo al día de la semana de esa fecha).
  function getWorkPriorities(dateStr) {
    return OFFICE_BLOCK_IDS.flatMap((blockId) => getOfficePendientes(dateStr, blockId));
  }

  function addOfficePendienteForDate(dateStr, text, blockId) {
    return addWeekTrabajoPendiente(getMondayKey(dateStr), text, [getWeekdayKey(dateStr)], blockId);
  }

  // "Quitar" acá solo desasigna el día que se está viendo (el mismo
  // pendiente puede seguir apareciendo en otros días si tiene más de
  // uno asignado); borrarlo del todo sigue siendo cosa de la vista
  // Semanal (removeWeekTrabajoPendiente).
  function removeOfficePendienteForDate(dateStr, id) {
    toggleWeekTrabajoPendienteDay(getMondayKey(dateStr), id, getWeekdayKey(dateStr));
  }

  // ---------- Paradas antes de oficina (09:00-10:00, lunes a viernes) ----------
  // Reemplaza el texto libre de siempre del bloque "previo_oficina" por
  // una pregunta Sí/No POR FECHA (day.previoOficinaRespuesta) y, cuando
  // es "Sí", una lista de paradas propia (week.paradasAntesOficina) con
  // el mismo tratamiento visual que "Pendientes de la semana: Trabajo"
  // pero en su propia lista — a propósito NO es parte de
  // pendientesTrabajo ni de OFFICE_BLOCK_IDS, para no mezclarse con
  // "Prioridades del trabajo" ni con el selector de bloque de ese otro
  // sistema (que siguen exactamente igual que antes). Sigue contando
  // como pendiente de semana para el panel de "Pendientes no cumplidos"
  // (ver PENDIENTE_LIST_KEYS más arriba), sin ningún cambio en esa
  // lógica: solo se registró la lista nueva ahí.
  function getPrevioOficinaAnswer(dateStr) {
    const day = data.days[dateStr];
    return (day && day.previoOficinaRespuesta) || undefined;
  }

  function setPrevioOficinaAnswer(dateStr, answer) {
    if (answer !== "si" && answer !== "no") return;
    getDay(dateStr).previoOficinaRespuesta = answer;
    notify();
  }

  // Enlace "Cambiar: habrá paradas"/"Cambiar: no habrá paradas": vuelve
  // a la pregunta sin responder. Las paradas ya cargadas (si las había)
  // quedan guardadas tal cual, por si se vuelve a responder "Sí".
  function clearPrevioOficinaAnswer(dateStr) {
    const day = data.days[dateStr];
    if (day) delete day.previoOficinaRespuesta;
    notify();
  }

  function getParadas(dateStr) {
    const dayKey = getWeekdayKey(dateStr);
    return getWeek(getMondayKey(dateStr)).paradasAntesOficina.filter((p) => p.dayKeys.includes(dayKey));
  }

  function addParada(dateStr, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    getWeek(getMondayKey(dateStr)).paradasAntesOficina.push({
      id: uid("po"),
      text: trimmed,
      done: false,
      dayKeys: [getWeekdayKey(dateStr)],
    });
    notify();
  }

  function toggleParada(dateStr, id) {
    const week = getWeek(getMondayKey(dateStr));
    const p = week.paradasAntesOficina.find((p) => p.id === id);
    if (p) p.done = !p.done;
    notify();
  }

  function editParadaText(dateStr, id, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const week = getWeek(getMondayKey(dateStr));
    const p = week.paradasAntesOficina.find((p) => p.id === id);
    if (p) p.text = trimmed;
    notify();
  }

  function removeParada(dateStr, id) {
    const week = getWeek(getMondayKey(dateStr));
    week.paradasAntesOficina = week.paradasAntesOficina.filter((p) => p.id !== id);
    notify();
  }

  // Todas las paradas de la semana completa (cualquier día), para
  // mostrarlas etiquetadas "Parada" dentro de "Pendientes de la semana:
  // Trabajo" en la vista Semanal (ver js/weeklyView.js) — mismo dato que
  // getParadas/toggleParada de acá arriba (por fecha puntual), expuesto
  // por semana para no tener que traducir cada parada a una fecha.
  // Marcar la casilla en cualquiera de los dos lugares (este o el
  // bloque de las 09:00) cambia el mismo objeto, así que quedan
  // sincronizados solos.
  function getWeekParadas(mondayStr) {
    return getWeek(mondayStr).paradasAntesOficina;
  }

  function toggleParadaInWeek(mondayStr, id) {
    const week = getWeek(mondayStr);
    const p = week.paradasAntesOficina.find((p) => p.id === id);
    if (p) p.done = !p.done;
    notify();
  }

  // true si ese día quedó en "Sí" y tiene alguna parada sin marcar. Hoy
  // este proyecto no tiene ningún sistema de avisos/recordatorios (no
  // hay ningún "Notification" ni aviso programado en todo el código,
  // tampoco uno de las 08:45 ni de ninguna otra hora): esta función
  // queda lista para que, el día que se arme ese sistema, pueda
  // consultarla para decidir si corresponde avisar — ver el mensaje del
  // chat para más detalle.
  function hasUnfinishedParadasToday(dateStr) {
    return getPrevioOficinaAnswer(dateStr) === "si" && getParadas(dateStr).some((p) => !p.done);
  }

  function setWeekMeta(mondayStr, text) {
    getWeek(mondayStr).metaSemana = text;
    persist();
  }

  // La tabla de "Seguimiento de hábitos" de la Semanal marca el mismo
  // dato que la casilla de la Diaria (day.habits[habitId]), no uno
  // propio por semana: solo traduce columna (día de la semana) + semana
  // que se está mirando a la fecha exacta que le corresponde.
  function toggleWeekHabit(mondayStr, habitId, dayKey) {
    const idx = ns.dateUtils.DAY_KEYS.indexOf(dayKey);
    if (idx === -1) return;
    const dateStr = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), idx));
    toggleDayHabit(dateStr, habitId);
  }

  function setRevisionViernes(mondayStr, field, text) {
    getWeek(mondayStr).revisionViernes[field] = text;
    persist();
  }

  // ---------- Eventos (vista mensual) ----------
  function getEvents(dateStr) {
    return data.events[dateStr] || [];
  }

  function addEvent(dateStr, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!data.events[dateStr]) data.events[dateStr] = [];
    data.events[dateStr].push({ id: uid("e"), text: trimmed });
    notify();
  }

  function removeEvent(dateStr, id) {
    if (!data.events[dateStr]) return;
    data.events[dateStr] = data.events[dateStr].filter((e) => e.id !== id);
    notify();
  }

  // Lista plana de todos los eventos, con su fecha, para gestionarlos
  // desde la vista Año. Es el mismo almacén que usa la vista Mensual.
  function getAllEvents() {
    const result = [];
    Object.keys(data.events || {}).forEach((dateStr) => {
      (data.events[dateStr] || []).forEach((ev) => {
        result.push({ id: ev.id, text: ev.text, date: dateStr });
      });
    });
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  function updateEventText(id, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    Object.values(data.events || {}).forEach((list) => {
      const ev = list.find((e) => e.id === id);
      if (ev) ev.text = trimmed;
    });
    persist();
  }

  function moveEvent(id, newDateStr) {
    if (!newDateStr) return;
    let event = null;
    let oldDateStr = null;
    Object.keys(data.events || {}).forEach((dateStr) => {
      const idx = (data.events[dateStr] || []).findIndex((e) => e.id === id);
      if (idx !== -1) {
        event = data.events[dateStr][idx];
        oldDateStr = dateStr;
      }
    });
    if (!event || oldDateStr === newDateStr) return;
    data.events[oldDateStr] = data.events[oldDateStr].filter((e) => e.id !== id);
    if (!data.events[newDateStr]) data.events[newDateStr] = [];
    data.events[newDateStr].push(event);
    notify();
  }

  function dayHasIndicator(dateStr) {
    const hasEvents = (data.events[dateStr] || []).length > 0;
    const hasPendingPriority = getWorkPriorities(dateStr).some((p) => !p.done);
    return hasEvents || hasPendingPriority;
  }

  // ---------- Metas del año (por trimestre, sin fecha) ----------
  function getYearGoals(year) {
    if (!data.yearGoals) data.yearGoals = {};
    const key = String(year);
    if (!data.yearGoals[key]) data.yearGoals[key] = { q1: [], q2: [], q3: [], q4: [] };
    return data.yearGoals[key];
  }

  function addYearGoal(year, quarter, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    getYearGoals(year)[quarter].push({ id: uid("yg"), text: trimmed, done: false });
    notify();
  }

  function removeYearGoal(year, quarter, id) {
    const goals = getYearGoals(year);
    goals[quarter] = goals[quarter].filter((g) => g.id !== id);
    notify();
  }

  function toggleYearGoal(year, quarter, id) {
    const goals = getYearGoals(year);
    const g = goals[quarter].find((g) => g.id === id);
    if (g) g.done = !g.done;
    notify();
  }

  // ---------- Meta(s) del mes (independiente de la meta semanal y anual) ----------
  function getMonthMeta(monthKey) {
    if (!data.monthMeta) data.monthMeta = {};
    return data.monthMeta[monthKey] || "";
  }

  function setMonthMeta(monthKey, text) {
    if (!data.monthMeta) data.monthMeta = {};
    data.monthMeta[monthKey] = text;
    persist();
  }

  ns.state = {
    getHabitsDefs,
    getMealLibrary,
    addMeal,
    getComidaAnswer,
    setComidaCocino,
    repeatYesterdayComida,
    clearComidaAnswer,
    updateMeal,
    removeMeal,
    addHabit,
    removeHabit,
    getQuoteForDay,
    getWordForDay,
    getDay,
    getDayBlocks,
    getBlockText,
    setDayCocina,
    setBlockText,
    weekHasAnyBlockText,
    replicatePreviousWeek,
    hasReplicateBackup,
    undoReplicateWeek,
    toggleBlockDone,
    markGymDone,
    markGymSkipped,
    editGymDay,
    getGymResolution,
    isGymUnavailable,
    setGymUnavailable,
    getGymBlockNumbers,
    getGymBlockMeta,
    getGymSessionLocation,
    getGymRoutineDay,
    getGymWeekDay,
    setGymDayNote,
    setGymExerciseNote,
    addGymSet,
    copyLastGymSet,
    updateGymSet,
    removeGymSet,
    setGymSimpleDone,
    addGymExercise,
    updateGymExercise,
    removeGymExercise,
    reorderGymExercises,
    moveGymExercise,
    getGymPreviousReference,
    GYM_SET_UNITS,
    getRunResolution,
    markRunDone,
    markRunSkipped,
    editRunDay,
    getRunRisk,
    isRunRiskAccepted,
    setRunRiskAccepted,
    getRaceCountdown,
    getRunStreak,
    getMotivationBanner,
    isBlockDone,
    getWeekendChecklist,
    addWeekendItem,
    removeWeekendItem,
    toggleWeekendItem,
    toggleDayHabit,
    isDayHabitDone,
    getWorkPriorities,
    addOfficePendienteForDate,
    removeOfficePendienteForDate,
    getWeek,
    setWeekMeta,
    getWeekTrabajoPendientes,
    addWeekTrabajoPendiente,
    removeWeekTrabajoPendiente,
    toggleWeekTrabajoPendiente,
    toggleWeekTrabajoPendienteDay,
    setWeekTrabajoPendienteBlock,
    getWeekPersonalPendientes,
    addWeekPersonalPendiente,
    removeWeekPersonalPendiente,
    toggleWeekPersonalPendiente,
    toggleWeekPersonalPendienteDay,
    getInboxItems,
    addInboxItem,
    removeInboxItem,
    assignInboxItem,
    getOfficePendientes,
    toggleOfficePendiente,
    getOfficeBlockOptions,
    getPrevioOficinaAnswer,
    setPrevioOficinaAnswer,
    clearPrevioOficinaAnswer,
    getParadas,
    addParada,
    toggleParada,
    editParadaText,
    removeParada,
    getWeekParadas,
    toggleParadaInWeek,
    hasUnfinishedParadasToday,
    getUnfinishedPendientesFromPreviousWeek,
    movePendienteToWeek,
    toggleWeekHabit,
    setRevisionViernes,
    getEvents,
    addEvent,
    removeEvent,
    getAllEvents,
    updateEventText,
    moveEvent,
    dayHasIndicator,
    getYearGoals,
    addYearGoal,
    removeYearGoal,
    toggleYearGoal,
    getMonthMeta,
    setMonthMeta,
    onChange,
    onPersist,
    getRawData,
    replaceAllData,
    switchStorageKey,
  };
})(window.Agenda);
