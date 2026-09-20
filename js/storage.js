/*
 * Capa de persistencia: todo se guarda en localStorage del navegador.
 * No hay llamadas de red ni dependencias externas.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const STORAGE_KEY = "agendaPersonal_v1";

  function defaultData() {
    return {
      habitsDefs: [
        { id: "h1", name: "Meditar" },
        { id: "h2", name: "Leer" },
        { id: "h3", name: "Ejercicio" },
      ],
      days: {},
      weeks: {},
      weekBlocks: {},
      mealLibrary: [],
      events: {},
      quoteBag: { order: [], pointer: 0 },
      wordBag: { order: [], pointer: 0 },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultData(), parsed);
    } catch (e) {
      console.error("No se pudieron leer los datos guardados:", e);
      return defaultData();
    }
  }

  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("No se pudieron guardar los datos:", e);
    }
  }

  ns.storage = { load, save, defaultData, STORAGE_KEY };
})(window.Agenda);
