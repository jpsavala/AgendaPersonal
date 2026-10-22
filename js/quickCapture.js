/*
 * Captura rápida: botón flotante "+" (visible en cualquier pestaña, ver
 * index.html) que abre un panel con un solo campo de texto.
 *
 * En cualquier pestaña que NO sea la Diaria, se comporta igual que
 * siempre: guarda el texto como pendiente SIN ASIGNAR en la Bandeja de
 * entrada (ns.state.addInboxItem) — asignarlo a trabajo/personal y a un
 * día se hace después, desde la Bandeja de la vista Semanal (ver
 * js/weeklyView.js: buildInboxSection).
 *
 * Desde la Diaria, en cambio, no pregunta nada ni pasa por la Bandeja:
 * crea directamente un pendiente de "Prioridades del trabajo" (mismo
 * dato que "Pendientes de la semana: Trabajo", ver
 * state.addOfficePendienteForDate), asignado a una fecha y a un bloque
 * de oficina según la hora local del dispositivo AHORA MISMO (ver
 * resolveQuickCaptureTarget) — no una zona horaria fija.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { dateUtils } = ns;

  // Minutos desde medianoche, hora local del dispositivo.
  function minutesNow(now) {
    return now.getHours() * 60 + now.getMinutes();
  }

  // A qué fecha y bloque de oficina se asigna un pendiente capturado
  // desde la Diaria en este momento (ver el pedido original, reglas
  // 1-2). Función pura (no toca datos) para poder probarla aparte:
  // - 00:00 a 10:00 (inclusive): hoy, oficina_manana.
  // - 10:01 a 17:00 (inclusive): hoy, tarde_oficina.
  // - 17:01 a 23:59: mañana, oficina_manana.
  // Si la fecha que resulta cae en sábado o domingo (el día siguiente
  // de un viernes tarde, o "hoy" mismo si hoy ya es fin de semana),
  // se corre al próximo lunes, siempre en oficina_manana: no se
  // trabaja fines de semana.
  //
  // dayLabel para el aviso de confirmación: "hoy" o "mañana" cuando la
  // fecha no se corrió (son literalmente hoy o el día siguiente); si se
  // corrió por caer en fin de semana, el nombre del día ("lunes") en
  // vez de "mañana" — decir "mañana, mañana" (día siguiente + bloque de
  // la mañana) sería ambiguo en español, así que ahí se nombra el día.
  function resolveQuickCaptureTarget(now) {
    const todayISO = dateUtils.toISO(now);
    let targetDate = dateUtils.fromISO(todayISO);
    let blockId = "oficina_manana";
    const mins = minutesNow(now);
    if (mins <= 10 * 60) {
      // hoy, oficina_manana (ya seteado arriba)
    } else if (mins <= 17 * 60) {
      blockId = "tarde_oficina";
    } else {
      targetDate = dateUtils.addDays(targetDate, 1);
      blockId = "oficina_manana";
    }

    let rolled = false;
    while (dateUtils.isWeekend(targetDate)) {
      rolled = true;
      targetDate = dateUtils.addDays(targetDate, 1);
      blockId = "oficina_manana";
    }

    const targetISO = dateUtils.toISO(targetDate);
    let dayLabel;
    if (rolled) {
      dayLabel = dateUtils.DAY_LABELS_LONG[dateUtils.isoWeekday(targetDate)].toLowerCase();
    } else if (targetISO === todayISO) {
      dayLabel = "hoy";
    } else {
      dayLabel = "mañana";
    }

    return { dateStr: targetISO, blockId, dayLabel };
  }

  // Texto del horario real de ese bloque en esa fecha (puede variar si
  // ese día tiene paradas antes de oficina, ver getPrevioOficinaAnswer/
  // getDayBlocks): se lee en vivo en vez de asumir un horario fijo, así
  // el aviso de confirmación siempre coincide con lo que se ve en la
  // Diaria para esa fecha puntual.
  function blockTimeLabel(dateStr, blockId) {
    const block = ns.state.getDayBlocks(dateStr).find((b) => b.id === blockId);
    return (block && block.time) || "";
  }

  function init() {
    const fab = document.getElementById("quick-capture-fab");
    const overlay = document.getElementById("quick-capture-overlay");
    const input = document.getElementById("quick-capture-input");
    const saveBtn = document.getElementById("quick-capture-save");
    const cancelBtn = document.getElementById("quick-capture-cancel");
    const toast = document.getElementById("quick-capture-toast");
    if (!fab || !overlay || !input || !saveBtn) return;

    function open() {
      overlay.classList.add("open");
      input.value = "";
      // El foco recién puede entrar una vez que el panel ya es visible
      // (display/opacity vía la clase .open); sin el setTimeout, Safari
      // a veces ignora el focus() porque todavía lo trata como oculto.
      setTimeout(() => input.focus(), 50);
    }

    function close() {
      overlay.classList.remove("open");
    }

    let toastTimer = null;

    // Toast simple (captura a la Bandeja, igual que siempre): solo
    // texto, se oculta sola, sin nada que tocar.
    function showToast(text, ms) {
      toast.classList.remove("has-action");
      toast.textContent = text;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), ms || 1600);
    }

    // Toast con "Deshacer" (captura a Prioridades del trabajo desde la
    // Diaria): queda unos segundos más, con el enlace clickeable (el
    // toast simple tiene pointer-events: none a propósito, para no
    // interceptar toques de la pantalla por accidente).
    function showUndoToast(text, onUndo) {
      toast.classList.add("has-action");
      toast.textContent = "";
      toast.appendChild(document.createTextNode(text + " · "));
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "quick-capture-toast-undo";
      undoBtn.textContent = "Deshacer";
      undoBtn.addEventListener("click", () => {
        onUndo();
        toast.classList.remove("show");
      });
      toast.appendChild(undoBtn);
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 6000);
    }

    // Captura desde la Diaria: crea directamente el pendiente de
    // "Prioridades del trabajo" (ver el comentario de arriba del
    // archivo) y avisa dónde quedó, con "Deshacer" por unos segundos.
    function saveToDiariaPriority(text) {
      const now = new Date();
      const { dateStr, blockId, dayLabel } = resolveQuickCaptureTarget(now);
      const id = ns.state.addOfficePendienteForDate(dateStr, text, blockId);
      close();
      if (!id) return;
      const timeLabel = blockId === "tarde_oficina" ? "tarde" : blockTimeLabel(dateStr, blockId);
      const mondayStr = dateUtils.toISO(dateUtils.getMonday(dateUtils.fromISO(dateStr)));
      showUndoToast(`Anotado: ${dayLabel}, ${timeLabel}`, () => {
        ns.state.removeWeekTrabajoPendiente(mondayStr, id);
      });
    }

    function save() {
      const text = input.value;
      if (!text.trim()) {
        close();
        return;
      }
      if (ns.app && ns.app.getActiveTab && ns.app.getActiveTab() === "diaria") {
        saveToDiariaPriority(text);
        return;
      }
      ns.state.addInboxItem(text);
      close();
      showToast("Anotado");
    }

    fab.addEventListener("click", open);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    if (cancelBtn) cancelBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") close();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  // Expuesto solo para pruebas (ver scratchpad): la lógica de fecha/
  // hora es pura y vale la pena poder llamarla directo sin simular
  // toda la interfaz.
  ns.quickCapture = { resolveQuickCaptureTarget };
})(window.Agenda);
