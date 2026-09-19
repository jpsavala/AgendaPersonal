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

  function getDayBlocks(dateStr) {
    const day = getDay(dateStr);
    return ns.scheduleDefs.getBlocks(day.cocina).map((def) => ({
      ...def,
      text: (day.blocks[def.id] && day.blocks[def.id].text) || "",
      done: !!(day.blocks[def.id] && day.blocks[def.id].done),
    }));
  }

  function setDayCocina(dateStr, cocina) {
    getDay(dateStr).cocina = !!cocina;
    notify();
  }

  function setBlockText(dateStr, blockId, text) {
    const day = getDay(dateStr);
    if (!day.blocks[blockId]) day.blocks[blockId] = { text: "", done: false };
    day.blocks[blockId].text = text;
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
  const WEEKDAY_BLOCKS = ["manana", "gimnasio", "oficina", "comida", "tarde"];
  const WEEKEND_BLOCKS = ["manana", "diplomado", "corrida"];

  function defaultWeek() {
    const blocks = {};
    ns.dateUtils.DAY_KEYS.forEach((key, i) => {
      const fields = i >= 5 ? WEEKEND_BLOCKS : WEEKDAY_BLOCKS;
      blocks[key] = {};
      fields.forEach((f) => (blocks[key][f] = ""));
    });
    return {
      blocks,
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

  function setWeekBlock(mondayStr, dayKey, field, text) {
    const week = getWeek(mondayStr);
    if (!week.blocks[dayKey]) week.blocks[dayKey] = {};
    week.blocks[dayKey][field] = text;
    persist();
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
    setDayCocina,
    setBlockText,
    toggleBlockDone,
    toggleDayHabit,
    addPriority,
    removePriority,
    togglePriority,
    getWeek,
    setWeekBlock,
    setWeekMeta,
    toggleWeekHabit,
    setRevisionViernes,
    getEvents,
    addEvent,
    removeEvent,
    dayHasIndicator,
    onChange,
    WEEKDAY_BLOCKS,
    WEEKEND_BLOCKS,
  };
})(window.Agenda);
