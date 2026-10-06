/*
 * Captura rápida: botón flotante "+" (visible en cualquier pestaña, ver
 * index.html) que abre un panel con un solo campo de texto. Guarda el
 * texto como pendiente SIN ASIGNAR en la Bandeja de entrada
 * (ns.state.addInboxItem) — asignarlo a trabajo/personal y a un día se
 * hace después, desde la Bandeja de la vista Semanal (ver
 * js/weeklyView.js: buildInboxSection).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
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
    function showToast() {
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
    }

    function save() {
      const text = input.value;
      if (!text.trim()) {
        close();
        return;
      }
      ns.state.addInboxItem(text);
      close();
      showToast();
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
})(window.Agenda);
