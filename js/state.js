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

  let data = storage.load();
  const listeners = [];

  function persist() {
    storage.save(data);
  }

  function getWeekdayKey(dateStr) {
    const date = ns.dateUtils.fromISO(dateStr);
    return ns.dateUtils.DAY_KEYS[ns.dateUtils.isoWeekday(date)];
  }

  function getWeekdayTemplate(dayKey) {
    if (!data.weekdayTemplates) data.weekdayTemplates = {};
    if (!data.weekdayTemplates[dayKey]) data.weekdayTemplates[dayKey] = {};
    return data.weekdayTemplates[dayKey];
  }

  // Migra el modelo viejo (texto duplicado por fecha en la vista diaria
  // y por semana específica en la vista semanal) a una sola plantilla de
  // texto por día de la semana. Es segura de correr en cada carga: una
  // vez migrado un dato, se elimina de su lugar viejo, así que no vuelve
  // a aplicarse en la siguiente carga. Las casillas de cumplido (blocks
  // .done, hábitos, prioridades) nunca se tocan aquí.
  function migrateToWeekdayTemplates() {
    ns.dateUtils.DAY_KEYS.forEach((k) => getWeekdayTemplate(k));

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
            const template = getWeekdayTemplate(dayKey);
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
        const template = getWeekdayTemplate(getWeekdayKey(dateStr));
        Object.entries(day.blocks).forEach(([blockId, val]) => {
          if (val && val.text) {
            if (!template[blockId]) template[blockId] = val.text;
            delete val.text;
          }
        });
      });
  }

  // Bloques que pasaron a ser fijos ("Oficina", sin texto libre): se
  // descarta cualquier texto que hubiera quedado guardado para ellos.
  function purgeFixedBlockText() {
    const FIXED_BLOCK_IDS = ["oficina_manana", "tarde_oficina", "tarde_personal"];
    ns.dateUtils.DAY_KEYS.forEach((dayKey) => {
      const template = getWeekdayTemplate(dayKey);
      FIXED_BLOCK_IDS.forEach((blockId) => delete template[blockId]);
    });
  }

  migrateToWeekdayTemplates();
  purgeFixedBlockText();
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

  // ---------- Días ----------
  function defaultDay() {
    return { cocina: true, blocks: {}, habits: {}, priorities: [] };
  }

  function getDay(dateStr) {
    if (!data.days[dateStr]) {
      data.days[dateStr] = defaultDay();
    }
    const day = data.days[dateStr];
    // Compatibilidad con días guardados antes del rediseño del horario.
    if (typeof day.cocina !== "boolean") day.cocina = true;
    if (!day.blocks) day.blocks = {};
    delete day.hours;
    return day;
  }

  function getBlockText(dateStr, blockId) {
    return getWeekdayTemplate(getWeekdayKey(dateStr))[blockId] || "";
  }

  function getDayBlocks(dateStr) {
    const day = getDay(dateStr);
    return ns.scheduleDefs.getBlocks(day.cocina).map((def) => ({
      ...def,
      text: def.marker || def.fixed ? "" : getBlockText(dateStr, def.id),
      done: !!(day.blocks[def.id] && day.blocks[def.id].done),
    }));
  }

  function setDayCocina(dateStr, cocina) {
    getDay(dateStr).cocina = !!cocina;
    notify();
  }

  // El texto se guarda en la plantilla del día de la semana (Lunes,
  // Martes, ...) correspondiente a esta fecha, no en la fecha misma:
  // así se edita una sola vez y se ve igual en la vista diaria y en la
  // semanal para cualquier fecha con ese mismo día de la semana.
  function setBlockText(dateStr, blockId, text) {
    getWeekdayTemplate(getWeekdayKey(dateStr))[blockId] = text;
    persist();
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
    };
  }

  function getWeek(mondayStr) {
    if (!data.weeks[mondayStr]) {
      data.weeks[mondayStr] = defaultWeek();
    }
    return data.weeks[mondayStr];
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
    addHabit,
    removeHabit,
    getQuoteForDay,
    getDay,
    getDayBlocks,
    getBlockText,
    setDayCocina,
    setBlockText,
    toggleBlockDone,
    toggleDayHabit,
    addPriority,
    removePriority,
    togglePriority,
    getWeek,
    setWeekMeta,
    toggleWeekHabit,
    setRevisionViernes,
    getEvents,
    addEvent,
    removeEvent,
    dayHasIndicator,
    onChange,
  };
})(window.Agenda);
