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

  function persist() {
    storage.save(data);
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

  migrateToWeekdayTemplates();
  migrateWeekdayTemplatesToCurrentWeek();
  purgeFixedBlockText();
  migrateNocheBlockSplit();
  persist();

  function onChange(fn) {
    listeners.push(fn);
  }

  function notify() {
    persist();
    listeners.forEach((fn) => fn());
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
    return { cocina: true, blocks: {}, habits: {}, priorities: [], weekendChecklist: [] };
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
    return day;
  }

  function getBlockText(dateStr, blockId) {
    return getWeekBlockTemplate(getMondayKey(dateStr), getWeekdayKey(dateStr))[blockId] || "";
  }

  // Gimnasio y corrida entre semana: mientras la fecha caiga dentro del
  // rango programado en trainingSchedule.js, el bloque se vuelve de
  // solo lectura con el texto calculado; fuera de rango, se comporta
  // como antes (editable, texto por plantilla semanal).
  function getAutoBlockOverride(def, dateStr) {
    if (def.id === "gimnasio") return ns.trainingSchedule.getGymText(dateStr);
    if (def.id === "correr") return ns.trainingSchedule.getRunText(dateStr);
    return undefined;
  }

  function getDayBlocks(dateStr) {
    const day = getDay(dateStr);
    const defs = isWeekendDate(dateStr) ? ns.scheduleDefs.getWeekendBlocks() : ns.scheduleDefs.getBlocks(day.cocina);
    return defs.map((def) => {
      const done = !!(day.blocks[def.id] && day.blocks[def.id].done);
      if (def.marker) return { ...def, text: "", done };

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
  // dentro del rango de trainingSchedule.js). Es una transformación al
  // vuelo, para no persistir el texto calculado en el propio dato.
  function getWeekendChecklist(dateStr) {
    const items = getDay(dateStr).weekendChecklist;
    const sundayRun = ns.trainingSchedule.getSundayRunText(dateStr);
    if (sundayRun === undefined) return items;
    return items.map((item) => {
      const isCorrerItem = item.key === "correr" || (item.key === undefined && item.text === "Correr");
      return isCorrerItem ? { ...item, text: sundayRun } : item;
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

  function addPriority(dateStr, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    getDay(dateStr).priorities.push({ id: uid("p"), text: trimmed, done: false });
    notify();
  }

  function removePriority(dateStr, id) {
    const day = getDay(dateStr);
    day.priorities = day.priorities.filter((p) => p.id !== id);
    notify();
  }

  function togglePriority(dateStr, id) {
    const day = getDay(dateStr);
    const p = day.priorities.find((p) => p.id === id);
    if (p) p.done = !p.done;
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

  function dayHasIndicator(dateStr) {
    const hasEvents = (data.events[dateStr] || []).length > 0;
    const day = data.days[dateStr];
    const hasPendingPriority = !!(day && day.priorities.some((p) => !p.done));
    return hasEvents || hasPendingPriority;
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
    getWeekendChecklist,
    addWeekendItem,
    removeWeekendItem,
    toggleWeekendItem,
    toggleDayHabit,
    addPriority,
    removePriority,
    togglePriority,
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
    dayHasIndicator,
    onChange,
  };
})(window.Agenda);
