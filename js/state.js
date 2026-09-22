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

  let data = storage.load();
  const listeners = [];
  const persistListeners = [];

  function persist() {
    storage.save(data);
    persistListeners.forEach((fn) => fn());
  }

  function getWeekdayKey(dateStr) {
    const date = ns.dateUtils.fromISO(dateStr);
    return ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(date)];
  }

  function getMondayKey(dateStr) {
    return ns.dateUtils.toISO(ns.dateUtils.getMonday(ns.dateUtils.fromISO(dateStr)));
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
  const GYM_QUEUE_SESSIONS = [
    ...GYM_ROUND,
    ...GYM_ROUND,
    ...GYM_ROUND,
    ...GYM_ROUND.map((s) => `${s} (descarga)`),
  ];

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
  function makeIsValidGymDay() {
    const anchor = ns.scheduleQueue.anchorOf(data.gymQueue);
    const dayBeforeAnchor = toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(anchor), -1));
    const pointerAtSeed = data.gymQueue.pointerAtSeed || 0;
    let weekdaysSoFar = pointerAtSeed + countWeekdaysBetween(data.gymQueue.seedAnchor, dayBeforeAnchor);
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

  function getGymResolution(dateStr) {
    if (!data.gymQueue) return null;
    const todayStr = toISO(new Date());
    return ns.scheduleQueue.resolve(data.gymQueue, GYM_QUEUE_SESSIONS, dateStr, todayStr, makeIsValidGymDay());
  }

  function markGymDone(dateStr) {
    if (!data.gymQueue) return;
    const todayStr = toISO(new Date());
    if (ns.scheduleQueue.markDone(data.gymQueue, GYM_QUEUE_SESSIONS, dateStr, todayStr, makeIsValidGymDay())) notify();
  }

  function markGymSkipped(dateStr) {
    if (!data.gymQueue) return;
    const todayStr = toISO(new Date());
    if (ns.scheduleQueue.markSkipped(data.gymQueue, GYM_QUEUE_SESSIONS, dateStr, todayStr, makeIsValidGymDay())) notify();
  }

  // Corrige una respuesta de "¿Entrenaste hoy?" ya guardada (de
  // cualquier fecha pasada, no solo la más reciente; incluye una fecha
  // que se haya congelado sola sin marcar nunca). Si el cambio entra en
  // conflicto con una fecha posterior que ya tiene su propia respuesta
  // guardada, no cambia nada: devuelve el conflicto para que la UI lo
  // muestre antes de decidir.
  function editGymDay(dateStr, done) {
    if (!data.gymQueue) return { ok: false, reason: "not-resolved" };
    const todayStr = toISO(new Date());
    const result = ns.scheduleQueue.editResolution(
      data.gymQueue,
      GYM_QUEUE_SESSIONS,
      dateStr,
      todayStr,
      makeIsValidGymDay(),
      done ? "done" : "skipped"
    );
    if (result.ok && result.changed) notify();
    return result;
  }

  function isGymUnavailable(dateStr) {
    return !!(data.gymQueue && data.gymQueue.unavailable[dateStr]);
  }

  // Solo tiene sentido marcar fechas futuras (ver UI): no valida acá para
  // no acoplar esta capa de datos con "hoy" más de lo necesario.
  function setGymUnavailable(dateStr, unavailable) {
    if (!data.gymQueue) return;
    ns.scheduleQueue.setUnavailable(data.gymQueue, dateStr, unavailable);
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

  // ---------- Corrida: contador a la carrera y racha ----------
  function getRaceCountdown() {
    return ns.trainingSchedule.getRaceCountdownInfo(toISO(new Date()));
  }

  // "Hecho" de un día con corrida programada: entre semana usa la
  // casilla simple del bloque (day.blocks.correr.done); el domingo de
  // carrera larga usa el pendiente "Correr" del checklist de fin de
  // semana (es un dato distinto porque vive en una lista aparte).
  function isRunDayDone(dateStr) {
    const day = data.days[dateStr];
    if (!day) return false;
    if (getWeekdayKey(dateStr) === "sun") {
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
            habits: {},
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

  migrateToWeekdayTemplates();
  migrateWeekdayTemplatesToCurrentWeek();
  purgeFixedBlockText();
  migrateNocheBlockSplit();
  migrateGymQueue();
  migrateGymQueueCorrection();
  migratePrioritiesToWeekTrabajo();
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

  function getDayBlocks(dateStr) {
    const day = getDay(dateStr);
    const defs = isWeekendDate(dateStr) ? ns.scheduleDefs.getWeekendBlocks() : ns.scheduleDefs.getBlocks(day.cocina);
    return defs.map((def) => {
      const done = !!(day.blocks[def.id] && day.blocks[def.id].done);
      if (def.marker) return { ...def, text: "", done };

      if (def.id === "gimnasio") {
        if (isGymUnavailable(dateStr)) {
          return { ...def, fixed: true, text: "No disponible", done: false, gymStatus: "unavailable" };
        }
        const r = getGymResolution(dateStr);
        if (r) {
          return { ...def, fixed: true, text: r.session, done: r.status === "done", gymStatus: r.status };
        }
        // Sin datos (antes de que arrancara este sistema, o cola ya
        // agotada): sigue igual que antes, editable manual.
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
  }

  // El ítem "Correr" del checklist de fin de semana refleja, de solo
  // lectura, la distancia programada de ese domingo (si la fecha cae
  // dentro del rango de trainingSchedule.js). El ítem "Gimnasio" refleja,
  // igual de solo lectura, la sesión atrasada que le toca a ese sábado
  // (si hay alguna pendiente de recuperar). Son transformaciones al
  // vuelo, para no persistir el texto calculado en el propio dato.
  function getWeekendChecklist(dateStr) {
    const items = getDay(dateStr).weekendChecklist;
    const sundayRun = ns.trainingSchedule.getSundayRunText(dateStr);
    const saturdayGym = getSaturdayGymResolution(dateStr);
    return items.map((item) => {
      const isCorrerItem = item.key === "correr" || (item.key === undefined && item.text === "Correr");
      if (isCorrerItem && sundayRun !== undefined) return { ...item, text: sundayRun };

      const isGymItem = item.text && item.text.indexOf("Gimnasio") === 0;
      if (isGymItem && saturdayGym) {
        const suffix = saturdayGym.status === "done" ? " — hecho" : saturdayGym.status === "skipped" ? " — no realizada" : "";
        return { ...item, text: `Gimnasio (atrasado): ${saturdayGym.session}${suffix}`, gymStatus: saturdayGym.status };
      }
      return item;
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

  // Copia el texto de todos los bloques de la semana inmediata anterior
  // hacia la semana indicada. Es una copia única: desde este momento las
  // dos semanas quedan completamente independientes.
  function weekHasAnyBlockText(mondayStr) {
    const week = data.weekBlocks && data.weekBlocks[mondayStr];
    if (!week) return false;
    return Object.values(week).some((dayFields) => Object.values(dayFields || {}).some((text) => !!text));
  }

  function replicatePreviousWeek(mondayStr) {
    const prevMondayStr = ns.dateUtils.toISO(ns.dateUtils.addDays(ns.dateUtils.fromISO(mondayStr), -7));
    const prevWeek = (data.weekBlocks && data.weekBlocks[prevMondayStr]) || {};
    if (!data.weekBlocks) data.weekBlocks = {};
    data.weekBlocks[mondayStr] = JSON.parse(JSON.stringify(prevWeek));
    notify();
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

  // ---------- Semanas ----------
  function defaultWeek() {
    return {
      metaSemana: "",
      habits: {},
      revisionViernes: { cumplido: "", ajuste: "" },
      pendientesTrabajo: [],
      pendientesPersonal: [],
    };
  }

  function getWeek(mondayStr) {
    if (!data.weeks[mondayStr]) {
      data.weeks[mondayStr] = defaultWeek();
    }
    const week = data.weeks[mondayStr];
    // Compatibilidad con semanas guardadas antes de esta sección.
    if (!week.pendientesTrabajo) week.pendientesTrabajo = [];
    if (!week.pendientesPersonal) week.pendientesPersonal = [];
    // Compatibilidad con pendientes guardados antes de poder elegir
    // bloque: antes siempre se mostraban en el de 10:00-14:00.
    // Compatibilidad con pendientes guardados antes de poder asignar
    // varios días: el día único se convierte en una lista de un solo día.
    week.pendientesTrabajo.forEach((p) => {
      if (!OFFICE_BLOCK_IDS.includes(p.blockId)) p.blockId = DEFAULT_OFFICE_BLOCK_ID;
      if (!Array.isArray(p.dayKeys)) {
        p.dayKeys = p.dayKey ? [p.dayKey] : [];
        delete p.dayKey;
      }
    });
    return week;
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

  function addWeekTrabajoPendiente(mondayStr, text, dayKeys, blockId) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const keys = Array.isArray(dayKeys) ? dayKeys.filter(Boolean) : dayKeys ? [dayKeys] : [];
    getWeek(mondayStr).pendientesTrabajo.push({
      id: uid("wt"),
      text: trimmed,
      done: false,
      dayKeys: keys,
      blockId: OFFICE_BLOCK_IDS.includes(blockId) ? blockId : DEFAULT_OFFICE_BLOCK_ID,
    });
    notify();
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
    addWeekTrabajoPendiente(getMondayKey(dateStr), text, [getWeekdayKey(dateStr)], blockId);
  }

  // "Quitar" acá solo desasigna el día que se está viendo (el mismo
  // pendiente puede seguir apareciendo en otros días si tiene más de
  // uno asignado); borrarlo del todo sigue siendo cosa de la vista
  // Semanal (removeWeekTrabajoPendiente).
  function removeOfficePendienteForDate(dateStr, id) {
    toggleWeekTrabajoPendienteDay(getMondayKey(dateStr), id, getWeekdayKey(dateStr));
  }

  function setWeekMeta(mondayStr, text) {
    getWeek(mondayStr).metaSemana = text;
    persist();
  }

  function toggleWeekHabit(mondayStr, habitId, dayKey) {
    const week = getWeek(mondayStr);
    if (!week.habits[habitId]) week.habits[habitId] = {};
    week.habits[habitId][dayKey] = !week.habits[habitId][dayKey];
    notify();
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
    toggleBlockDone,
    markGymDone,
    markGymSkipped,
    editGymDay,
    isGymUnavailable,
    setGymUnavailable,
    getRaceCountdown,
    getRunStreak,
    getWeekendChecklist,
    addWeekendItem,
    removeWeekendItem,
    toggleWeekendItem,
    toggleDayHabit,
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
    getOfficePendientes,
    toggleOfficePendiente,
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
  };
})(window.Agenda);
