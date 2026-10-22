window.Agenda = window.Agenda || {};
(function (ns) {
  const views = {
    diaria: ns.dailyView,
    semanal: ns.weeklyView,
    mensual: ns.monthlyView,
    comidas: ns.mealsView,
    gimnasio: ns.gymView,
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

  // Para que otras capas (ver js/quickCapture.js: el botón flotante "+"
  // se comporta distinto solo en la Diaria) sepan en qué pestaña está
  // el usuario ahora mismo, sin tener que llevar su propio seguimiento
  // de pestañas por separado.
  function getActiveTab() {
    return activeTab;
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-button").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
    mountActive();
  }

  // ---------- Captura de paradas desde "¿Habrá paradas antes de la
  // oficina?" ----------
  // Al tocar "Sí" (ver js/dailyView.js y js/weeklyView.js), además de
  // guardar la respuesta, la app lleva al usuario a "Pendientes de la
  // semana: Trabajo" en la Semanal para capturar las paradas ahí. Esta
  // sesión (qué fecha/semana, a qué pestaña y posición volver) es
  // puramente de este momento: no se guarda en los datos (data.*), se
  // pierde al recargar la página, igual que cualquier otro estado
  // transitorio de las vistas (ver editingParadaId/comidaRepeatWarningFor
  // en dailyView.js/weeklyView.js). La vista Semanal la lee en cada
  // render (ver getParadaCaptureSession) para saber si debe ubicarse en
  // esa semana, resaltar la sección, mostrar la nota y mandar ahí lo
  // que se agregue a state.addParada en vez de a un pendiente de
  // oficina normal.
  let paradaCaptureSession = null;
  let backBtn = null;

  function updateBackBtn() {
    if (backBtn) backBtn.hidden = !paradaCaptureSession;
  }

  function startParadaCapture(dateStr) {
    paradaCaptureSession = {
      dateStr,
      mondayStr: ns.dateUtils.toISO(ns.dateUtils.getMonday(ns.dateUtils.fromISO(dateStr))),
      returnTab: activeTab,
      returnScrollY: window.scrollY,
    };
    updateBackBtn();
    if (activeTab === "semanal") refreshActive();
    else switchTab("semanal");
  }

  function getParadaCaptureSession() {
    return paradaCaptureSession;
  }

  // Botón flotante "Volver" (ver setupParadaCaptureBackBtn): sale del
  // modo captura sin borrar nada de lo ya anotado y regresa a la
  // pestaña/posición de donde salió el usuario.
  function endParadaCapture() {
    const session = paradaCaptureSession;
    paradaCaptureSession = null;
    updateBackBtn();
    if (!session) return;
    if (session.returnTab !== activeTab) switchTab(session.returnTab);
    else refreshActive();
    requestAnimationFrame(() => window.scrollTo(0, session.returnScrollY));
  }

  // "Registrar" (ver js/dailyView.js y js/weeklyView.js, bloque de
  // gimnasio): abre esa sesión en la pestaña Gimnasio, en el bloque,
  // semana y día que le corresponden a esa fecha según la cola +
  // puntero (ver state.getGymSessionLocation). No crea ninguna sesión
  // transitoria para "volver" como startParadaCapture — es solo una
  // navegación directa, igual que elegir la pestaña a mano.
  function openGymSession(dateStr) {
    const location = ns.state.getGymSessionLocation(dateStr);
    if (!location || !ns.gymView) return;
    ns.gymView.openSession(location);
    switchTab("gimnasio");
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
        // Cambiar de pestaña a mano (no con "Volver") sale del modo
        // captura de paradas sin restaurar nada: el usuario decidió ir
        // a otro lado por su cuenta.
        if (paradaCaptureSession && btn.dataset.tab !== activeTab) {
          paradaCaptureSession = null;
          updateBackBtn();
        }
        switchTab(btn.dataset.tab);
      });
    });
  }

  function setupParadaCaptureBackBtn() {
    backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.id = "parada-capture-back-btn";
    backBtn.className = "parada-capture-back-btn";
    backBtn.textContent = "Volver";
    backBtn.hidden = true;
    backBtn.addEventListener("click", endParadaCapture);
    document.body.appendChild(backBtn);
  }

  document.addEventListener("DOMContentLoaded", () => {
    viewContainer = document.getElementById("view-container");
    setupTabs();
    setupParadaCaptureBackBtn();
    mountActive();
    ns.state.onChange(refreshActive);
  });

  // Para que otras capas (ver js/userConfigSync.js) puedan pedir un
  // redibujado después de aplicar/quitar la configuración de una
  // cuenta, sin tener que conocer el mecanismo de pestañas.
  ns.app = {
    refreshActive: () => refreshActive(),
    getActiveTab,
    startParadaCapture,
    getParadaCaptureSession,
    endParadaCapture,
    openGymSession,
  };
})(window.Agenda);
