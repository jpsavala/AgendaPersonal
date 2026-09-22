/*
 * Utilidades de fecha (semana de lunes a domingo, formato ISO local).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_LABELS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const DAY_LABELS_LONG = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];
  const MONTH_LABELS = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISO(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function fromISO(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  // Índice de lunes=0 ... domingo=6 (getDay() nativo es domingo=0)
  function isoWeekday(date) {
    return (date.getDay() + 6) % 7;
  }

  function getMonday(date) {
    return addDays(date, -isoWeekday(date));
  }

  function getWeekDates(monday) {
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }

  // Diferencia en días de calendario entre dos fechas ISO (toStr - fromStr),
  // comparando a mediodía UTC para no romperse con cambios de horario.
  function daysBetween(fromStr, toStr) {
    const a = fromISO(fromStr);
    const b = fromISO(toStr);
    const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcB - utcA) / 86400000);
  }

  function isWeekend(date) {
    const wd = isoWeekday(date);
    return wd === 5 || wd === 6;
  }

  function isSameDay(a, b) {
    return toISO(a) === toISO(b);
  }

  // Devuelve un arreglo de semanas (cada una de 7 fechas) que cubren
  // el mes completo, empezando en lunes y terminando en domingo.
  function getMonthGrid(year, monthIndex) {
    const firstOfMonth = new Date(year, monthIndex, 1);
    const start = getMonday(firstOfMonth);
    const lastOfMonth = new Date(year, monthIndex + 1, 0);
    const end = addDays(lastOfMonth, (6 - isoWeekday(lastOfMonth)) % 7);

    const weeks = [];
    let cursor = start;
    while (cursor <= end) {
      weeks.push(getWeekDates(cursor));
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }

  function formatLong(date) {
    return `${DAY_LABELS_LONG[isoWeekday(date)]}, ${date.getDate()} de ${MONTH_LABELS[date.getMonth()]} de ${date.getFullYear()}`;
  }

  function formatShortRange(monday) {
    const sunday = addDays(monday, 6);
    const sameMonth = monday.getMonth() === sunday.getMonth();
    const from = `${monday.getDate()}`;
    const to = sameMonth
      ? `${sunday.getDate()} de ${MONTH_LABELS[sunday.getMonth()]}`
      : `${sunday.getDate()} de ${MONTH_LABELS[sunday.getMonth()]}`;
    const fromLabel = sameMonth
      ? from
      : `${from} de ${MONTH_LABELS[monday.getMonth()]}`;
    return `${fromLabel} — ${to} de ${sunday.getFullYear()}`;
  }

  ns.dateUtils = {
    DAY_KEYS,
    DAY_LABELS_SHORT,
    DAY_LABELS_LONG,
    MONTH_LABELS,
    pad2,
    toISO,
    fromISO,
    addDays,
    addMonths,
    isoWeekday,
    getMonday,
    getWeekDates,
    daysBetween,
    isWeekend,
    isSameDay,
    getMonthGrid,
    formatLong,
    formatShortRange,
  };
})(window.Agenda);
