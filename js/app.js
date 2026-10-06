window.Agenda = window.Agenda || {};
(function (ns) {
  const views = {
    diaria: ns.dailyView,
    semanal: ns.weeklyView,
    mensual: ns.monthlyView,
    comidas: ns.mealsView,
    anio: ns.yearView,
  };
  let activeTab = "diaria";
  let viewContainer;

  function mountActive() {
    viewContainer.innerHTML = "";
    views[activeTab].mount(viewContainer);
  }

  function refreshActive() {
    views[activeTab].refresh();
  }

  function setupTabs() {
    // Dos juegos de botones con la misma clase/data-tab: la nav de
    // arriba (escritorio) y la barra inferior (mobile, ver index.html).
    // Solo una de las dos se ve en cada ancho de pantalla (CSS), pero
    // ambas quedan sincronizadas igual — si no, cambiar de pestaña con
    // una y después angostar/ensanchar la ventana mostraría la otra con
    // la pestaña vieja marcada como activa.
    const buttons = document.querySelectorAll(".tab-button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
        mountActive();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    viewContainer = document.getElementById("view-container");
    setupTabs();
    mountActive();
    ns.state.onChange(refreshActive);
  });

  // Para que otras capas (ver js/userConfigSync.js) puedan pedir un
  // redibujado después de aplicar/quitar la configuración de una
  // cuenta, sin tener que conocer el mecanismo de pestañas.
  ns.app = { refreshActive: () => refreshActive() };
})(window.Agenda);
