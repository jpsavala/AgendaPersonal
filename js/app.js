window.Agenda = window.Agenda || {};
(function (ns) {
  const views = {
    diaria: ns.dailyView,
    semanal: ns.weeklyView,
    mensual: ns.monthlyView,
    comidas: ns.mealsView,
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
    const buttons = document.querySelectorAll(".tab-button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeTab = btn.dataset.tab;
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
})(window.Agenda);
