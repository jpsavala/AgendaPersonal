/*
 * Definición de los bloques de la vista diaria (horarios de duración
 * variable, no una cuadrícula de horas). Por defecto usa los bloques
 * fijos de siempre (los de abajo); si hay una configuración de usuario
 * activa (ver js/userConfigSync.js), setUserSchedule() la reemplaza acá
 * y getBlocks()/getWeekendBlocks() devuelven ESA en su lugar — sin
 * sesión iniciada (o mientras la configuración no haya cargado), el
 * comportamiento es exactamente el de siempre, sin ningún cambio.
 *
 * Solo el bloque de comida (14:00–16:00 aprox.) cambia de contenido
 * según el toggle "día que cocino" / "día que no cocino". Los bloques
 * marcados con `fixed: true` no tienen texto editable, solo su casilla
 * de cumplido.
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
    { id: "oficina_manana", time: "10:00–14:00", label: "Oficina", fixed: true },
  ];

  const COOK_MIDDAY = [
    { id: "preparar_comida", time: "14:00–15:00", label: "Comida" },
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

  const AFTERNOON_FIXED = { id: "tarde_oficina", time: "16:30–19:00", label: "Oficina", fixed: true };

  const FIXED_END = [
    { id: "correr", time: "19:00–20:00", label: "Correr" },
    { id: "cena", time: "20:00–21:20", label: "Cenar y bañarme", fixed: true },
    { id: "libre_noche", time: "21:30–22:10", label: "Bloque libre" },
  ];

  // Sábado y domingo no tienen horario rígido: solo 3 franjas sueltas
  // de referencia, sin rango de hora obligatorio.
  const WEEKEND_BLOCKS = [
    { id: "finde_manana", label: "Mañana" },
    { id: "finde_tarde", label: "Tarde" },
    { id: "finde_noche", label: "Noche" },
  ];

  // Configuración de la cuenta con sesión iniciada, si la hay (ver
  // js/userConfig.js por su forma exacta). null = sin sesión, o
  // sesión sin configuración cargada todavía: se usan los bloques de
  // arriba, igual que siempre.
  let userSchedule = null;

  function setUserSchedule(schedule) {
    userSchedule = schedule || null;
  }

  function clearUserSchedule() {
    userSchedule = null;
  }

  function getBlocks(cocina) {
    if (userSchedule) {
      // Horario generado por onboarding: una sola lista ya ordenada,
      // sin variante cocino/no cocino (no es una pregunta genérica).
      if (userSchedule.flat) return userSchedule.flat;
      // Horario migrado de la cuenta dueña: mismo armado de siempre,
      // solo que las piezas vienen de datos en vez de estar fijas acá.
      const midday = cocina ? userSchedule.cookMidday : userSchedule.noCookMidday;
      return [
        ...(userSchedule.fixedStart || []),
        ...(midday || []),
        ...(userSchedule.marker ? [userSchedule.marker] : []),
        ...(userSchedule.afternoonFixed ? [userSchedule.afternoonFixed] : []),
        ...(userSchedule.fixedEnd || []),
      ];
    }
    const midday = cocina ? COOK_MIDDAY : NO_COOK_MIDDAY;
    return [...FIXED_START, ...midday, MARKER, AFTERNOON_FIXED, ...FIXED_END];
  }

  function getWeekendBlocks() {
    if (userSchedule && userSchedule.weekendBlocks) return userSchedule.weekendBlocks;
    return WEEKEND_BLOCKS;
  }

  ns.scheduleDefs = { getBlocks, getWeekendBlocks, setUserSchedule, clearUserSchedule };
})(window.Agenda);
