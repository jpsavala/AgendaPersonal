/*
 * Definición fija de los bloques de la vista diaria (horarios de
 * duración variable, no una cuadrícula de horas). Los bloques 5 y 7
 * cambian de contenido según el toggle "día que cocino" / "día que
 * no cocino"; cada variante guarda su propio texto para no perder
 * información al alternar el toggle en el mismo día.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const FIXED_START = [
    { id: "meditar", time: "04:00–05:40", label: "Meditar / leer" },
    { id: "gimnasio", time: "06:00–07:15 / 07:30", label: "Gimnasio" },
    {
      id: "previo_oficina",
      time: "09:00–10:00",
      label: "Bloque libre / paradas antes de oficina",
      highlight: true,
    },
    { id: "oficina_manana", time: "10:00–14:00", label: "Oficina" },
  ];

  const COOK_MIDDAY = [
    { id: "preparar_comida", time: "14:00–15:00", label: "Preparar comida" },
    {
      id: "comer_personal",
      time: "15:00–16:00",
      label: "Comer, lavar platos y bloque personal (lectura, guiones)",
    },
  ];

  const NO_COOK_MIDDAY = [
    { id: "comer_sobras", time: "14:00–16:00", label: "Como (sobras) y descanso corto" },
  ];

  const MARKER = { id: "salida_oficina", time: "16:10", label: "Salir a la oficina", marker: true };

  const AFTERNOON_COOK = { id: "tarde_personal", time: "16:30–19:00", label: "Trabajo en cosas personales" };
  const AFTERNOON_NO_COOK = { id: "tarde_oficina", time: "16:30–19:00", label: "Oficina" };

  const FIXED_END = [
    { id: "correr", time: "Después de 19:00", label: "Correr" },
    {
      id: "noche",
      time: "20:00 en adelante",
      label: "Cenar, bañarme y bloque libre (trabajo / lectura / ocio)",
    },
  ];

  function getBlocks(cocina) {
    const midday = cocina ? COOK_MIDDAY : NO_COOK_MIDDAY;
    const afternoon = cocina ? AFTERNOON_COOK : AFTERNOON_NO_COOK;
    return [...FIXED_START, ...midday, MARKER, afternoon, ...FIXED_END];
  }

  ns.scheduleDefs = { getBlocks };
})(window.Agenda);
