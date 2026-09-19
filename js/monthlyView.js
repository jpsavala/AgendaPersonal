window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();
  let containerRef = null;
  let selectedDateStr = null;

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function render(container) {
    container.innerHTML = "";
    const today = new Date();

    const header = el(
      "div",
      { class: "view-header" },
      el("button", { class: "btn-icon", onclick: () => go(-1) }, "◀"),
      el("span", { class: "week-range" }, `${dateUtils.MONTH_LABELS[currentMonth]} ${currentYear}`),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentYear = today.getFullYear(); currentMonth = today.getMonth(); render(container); },
      }, "Este mes")
    );

    const weeks = dateUtils.getMonthGrid(currentYear, currentMonth);
    const calendar = el("div", { class: "calendar" });

    const headRow = el("div", { class: "calendar-row calendar-head" });
    dateUtils.DAY_LABELS_SHORT.forEach((lbl, i) => {
      headRow.appendChild(el("div", { class: "calendar-head-cell" + (i >= 5 ? " weekend" : "") }, lbl));
    });
    calendar.appendChild(headRow);

    weeks.forEach((week) => {
      const row = el("div", { class: "calendar-row" });
      week.forEach((date, i) => {
        const dateStr = dateUtils.toISO(date);
        const inMonth = date.getMonth() === currentMonth;
        const isWeekend = i >= 5;
        const isToday = dateUtils.isSameDay(date, today);
        const hasIndicator = state.dayHasIndicator(dateStr);

        const cell = el(
          "button",
          {
            class:
              "calendar-cell" +
              (inMonth ? "" : " outside") +
              (isWeekend ? " weekend" : "") +
              (isToday ? " today" : ""),
            onclick: () => openDayModal(dateStr, container),
          },
          el("span", { class: "calendar-day-num" }, String(date.getDate())),
          hasIndicator ? el("span", { class: "calendar-dot" }) : null
        );
        row.appendChild(cell);
      });
      calendar.appendChild(row);
    });

    container.append(header, calendar);
  }

  function openDayModal(dateStr, container) {
    selectedDateStr = dateStr;
    const overlay = el("div", { class: "modal-overlay", onclick: (e) => { if (e.target === overlay) closeModal(overlay); } });
    const events = state.getEvents(dateStr);

    const list = el("div", { class: "check-list" });
    events.forEach((ev) => {
      list.appendChild(
        el(
          "div",
          { class: "check-row" },
          el("span", null, ev.text),
          el("button", { class: "btn-remove", onclick: () => { state.removeEvent(dateStr, ev.id); openDayModal(dateStr, container); closeModal(overlay); } }, "×")
        )
      );
    });

    const input = el("input", { type: "text", class: "add-input", placeholder: "Nuevo evento o pendiente importante..." });
    const commit = () => {
      if (input.value.trim()) {
        state.addEvent(dateStr, input.value);
        input.value = "";
        closeModal(overlay);
        openDayModal(dateStr, container);
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });

    const modal = el(
      "div",
      { class: "modal" },
      el("h3", null, dateUtils.formatLong(dateUtils.fromISO(dateStr))),
      list.childElementCount ? list : el("p", { class: "muted" }, "Sin eventos para este día."),
      el("div", { class: "add-row" }, input, el("button", { class: "btn-secondary", onclick: commit }, "Agregar")),
      el("div", { class: "modal-actions" },
        el("button", { class: "btn-secondary", onclick: () => closeModal(overlay) }, "Cerrar")
      )
    );
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function closeModal(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function go(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear += 1; }
    if (currentMonth < 0) { currentMonth = 11; currentYear -= 1; }
    if (containerRef) render(containerRef);
  }

  ns.monthlyView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
