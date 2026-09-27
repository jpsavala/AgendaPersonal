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
      yearGoals: {},
      monthMeta: {},
      quoteBag: { order: [], pointer: 0 },
      wordBag: { order: [], pointer: 0 },
      gymQueue: null,
    };
  }

  // Cada cuenta (uid de Firebase) tiene su propio respaldo local, en una
  // clave separada de STORAGE_KEY (el modo sin sesión iniciada) y de la
  // de cualquier otra cuenta que haya usado este mismo dispositivo. Sin
  // esto, una cuenta nueva que inicia sesión en un aparato donde ya
  // había datos guardados (propios de otra cuenta, o del modo sin
  // sesión) podría terminar subiéndolos a Firebase como si fueran suyos
  // (ver js/firebaseSync.js, que llama a state.switchStorageKey en cada
  // inicio/cierre de sesión).
  function keyForUid(uid) {
    return "agenda_data_" + uid;
  }

  function load(key) {
    try {
      const raw = localStorage.getItem(key || STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultData(), parsed);
    } catch (e) {
      console.error("No se pudieron leer los datos guardados:", e);
      return defaultData();
    }
  }

  function save(data, key) {
    try {
      localStorage.setItem(key || STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("No se pudieron guardar los datos:", e);
    }
  }

  ns.storage = { load, save, defaultData, keyForUid, STORAGE_KEY };
})(window.Agenda);
